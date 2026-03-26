"""
peer_clustering.py — K-means peer group clustering for NCUA credit unions.

Segments credit unions into 8 peer groups primarily by asset size using
K-means clustering on log-transformed financial features.

Usage:
    python3 peer_clustering.py [--db PATH] [--k 8] [--quarter 2025-Q4]

The results are written to the `peer_groups` table in the database and
are consumed by the API endpoints in ncua_api.py.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

# ── Default DB path ──────────────────────────────────────────────────────
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(_THIS_DIR, "data", "ncua_callreports.db")

# ── Cluster labels by rank (0=smallest → 7=largest) ──────────────────────
# Used when k=8; falls back to "Tier N" for other k values.
RANK_LABELS = [
    "Micro CU",       # 0 — smallest
    "Small CU",       # 1
    "Small-Mid CU",   # 2
    "Mid-size CU",    # 3
    "Large CU",       # 4
    "Super CU",       # 5
    "Mega CU",        # 6
    "Top-tier CU",    # 7 — largest
]

# kept for reference only
LABEL_THRESHOLDS = [
    (10_000_000,    "Micro CU"),
    (50_000_000,    "Small CU"),
    (100_000_000,   "Small-Mid CU"),
    (500_000_000,   "Mid-size CU"),
    (1_000_000_000, "Large CU"),
    (5_000_000_000, "Super CU"),
    (20_000_000_000,"Mega CU"),
]
LABEL_TOP = "Top-tier CU"


def asset_label(median_assets: float) -> str:
    """Return a human-readable label based on median asset size."""
    for threshold, label in LABEL_THRESHOLDS:
        if median_assets < threshold:
            return label
    return LABEL_TOP


# ── DB helpers ───────────────────────────────────────────────────────────

def get_latest_quarter(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        "SELECT quarter_label FROM financial_data ORDER BY report_date DESC LIMIT 1"
    ).fetchone()
    return row[0] if row else "2025-Q4"


def ensure_peer_groups_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS peer_groups (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            cu_number             TEXT NOT NULL,
            cluster_id            INTEGER NOT NULL,
            cluster_label         TEXT,
            cluster_median_assets REAL,
            cluster_size          INTEGER,
            computed_at           TEXT,
            quarter_label         TEXT,
            UNIQUE(cu_number)
        )
    """)
    conn.commit()


# ── Data loading ─────────────────────────────────────────────────────────

def load_latest_quarter_data(conn: sqlite3.Connection, quarter: str) -> pd.DataFrame:
    """
    Pull the latest quarter's data joined with institution info.
    Returns a DataFrame with cu_number and the clustering features.
    """
    sql = """
        SELECT
            i.cu_number,
            i.name,
            i.state,
            f.total_assets,
            f.member_count,
            f.loan_to_share_ratio,
            f.net_worth_ratio,
            f.roa
        FROM financial_data f
        JOIN institutions i ON i.id = f.institution_id
        WHERE f.quarter_label = ?
          AND f.total_assets IS NOT NULL
          AND f.total_assets > 0
          AND f.member_count IS NOT NULL
          AND f.member_count >= 0
    """
    rows = conn.execute(sql, (quarter,)).fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    return df


# ── Feature engineering ──────────────────────────────────────────────────

def build_feature_matrix(df: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    """
    Build the weighted feature matrix for clustering.

    Features (all normalized after construction):
      - log10(total_assets)        — weight 3x (primary dimension)
      - log10(member_count + 1)    — correlated but not identical
      - loan_to_share_ratio
      - net_worth_ratio
      - roa

    Returns:
        X: ndarray of shape (n_samples, n_weighted_features)
        df_clean: cleaned DataFrame aligned with X rows
    """
    # Drop rows with null values for the two required dimensions
    df_clean = df.dropna(subset=["total_assets", "member_count"]).copy()

    # Clamp extreme outliers in ratios (clip to 3 IQR from median)
    for col in ["loan_to_share_ratio", "net_worth_ratio", "roa"]:
        if col in df_clean.columns:
            df_clean[col] = df_clean[col].fillna(df_clean[col].median())
            q1, q3 = df_clean[col].quantile(0.01), df_clean[col].quantile(0.99)
            df_clean[col] = df_clean[col].clip(lower=q1, upper=q3)

    # Log transforms
    df_clean["log_assets"]  = np.log10(df_clean["total_assets"].clip(lower=1))
    df_clean["log_members"] = np.log10(df_clean["member_count"].clip(lower=0) + 1)

    raw_features = df_clean[[
        "log_assets",
        "log_members",
        "loan_to_share_ratio",
        "net_worth_ratio",
        "roa",
    ]].values

    # StandardScaler normalize
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(raw_features)

    # Apply 3x weight to log_assets by scaling that column
    X_final = np.column_stack([
        X_scaled[:, 0] * 3,   # log_assets with 3x weight
        X_scaled[:, 1],        # log_members
        X_scaled[:, 2],        # loan_to_share_ratio
        X_scaled[:, 3],        # net_worth_ratio
        X_scaled[:, 4],        # roa
    ])

    return X_final, df_clean


# ── Clustering ───────────────────────────────────────────────────────────

def run_kmeans(X: np.ndarray, k: int = 8, random_state: int = 42) -> np.ndarray:
    """Run K-means and return cluster assignments."""
    km = KMeans(n_clusters=k, n_init=20, random_state=random_state)
    labels = km.fit_predict(X)
    return labels


def sort_clusters_by_assets(df_clean: pd.DataFrame, raw_labels: np.ndarray, k: int) -> np.ndarray:
    """
    Re-map cluster IDs so that cluster 0 = smallest (by median log_assets),
    cluster k-1 = largest.

    Returns array of sorted cluster IDs aligned with df_clean rows.
    """
    df_clean = df_clean.copy()
    df_clean["_raw_cluster"] = raw_labels

    # Compute median log_assets per raw cluster
    medians = (
        df_clean.groupby("_raw_cluster")["log_assets"]
        .median()
        .sort_values()
    )
    # medians.index[0] = raw cluster with smallest median → new id 0
    raw_to_sorted = {raw_id: sorted_id for sorted_id, raw_id in enumerate(medians.index)}

    sorted_labels = np.array([raw_to_sorted[lbl] for lbl in raw_labels])
    return sorted_labels


def compute_cluster_stats(df_clean: pd.DataFrame, sorted_labels: np.ndarray) -> dict:
    """
    Compute per-cluster statistics needed for labels and the DB write.
    Returns dict keyed by sorted cluster_id.
    """
    df_clean = df_clean.copy()
    df_clean["cluster_id"] = sorted_labels

    stats = {}
    for cid, grp in df_clean.groupby("cluster_id"):
        median_assets = grp["total_assets"].median()
        label = RANK_LABELS[int(cid)] if int(cid) < len(RANK_LABELS) else f"Tier {cid}"
        stats[cid] = {
            "cluster_id":            int(cid),
            "cluster_label":         label,
            "cluster_median_assets": float(median_assets),
            "cluster_size":          len(grp),
            "min_assets":            float(grp["total_assets"].min()),
            "max_assets":            float(grp["total_assets"].max()),
            "median_roa":            float(grp["roa"].median()),
            "median_nwr":            float(grp["net_worth_ratio"].median()),
        }
    return stats


# ── DB write ─────────────────────────────────────────────────────────────

def write_peer_groups(
    conn: sqlite3.Connection,
    df_clean: pd.DataFrame,
    sorted_labels: np.ndarray,
    cluster_stats: dict,
    quarter: str,
) -> None:
    """
    Write/replace peer group assignments into the peer_groups table.
    Uses INSERT OR REPLACE so the script is safely re-runnable.
    """
    ensure_peer_groups_table(conn)

    computed_at = datetime.now(timezone.utc).isoformat()
    df_clean = df_clean.copy()
    df_clean["cluster_id"] = sorted_labels

    rows = []
    for _, row in df_clean.iterrows():
        cid = int(row["cluster_id"])
        cs  = cluster_stats[cid]
        rows.append((
            row["cu_number"],
            cid,
            cs["cluster_label"],
            cs["cluster_median_assets"],
            cs["cluster_size"],
            computed_at,
            quarter,
        ))

    conn.executemany("""
        INSERT OR REPLACE INTO peer_groups
            (cu_number, cluster_id, cluster_label, cluster_median_assets,
             cluster_size, computed_at, quarter_label)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()
    print(f"  Wrote {len(rows)} rows to peer_groups table.")


# ── Summary print ────────────────────────────────────────────────────────

def print_summary(cluster_stats: dict) -> None:
    """Print a formatted summary table of cluster statistics."""
    print()
    print("=" * 90)
    print(f"  K-Means Peer Group Clustering Summary")
    print("=" * 90)
    header = f"{'ID':>3}  {'Label':<20}  {'Count':>6}  {'Median Assets':>16}  "
    header += f"{'Min Assets':>16}  {'Max Assets':>16}  {'Med ROA':>8}  {'Med NWR':>8}"
    print(header)
    print("-" * 90)

    for cid in sorted(cluster_stats.keys()):
        cs = cluster_stats[cid]
        med_a   = cs["cluster_median_assets"]
        min_a   = cs["min_assets"]
        max_a   = cs["max_assets"]
        med_roa = cs["median_roa"]
        med_nwr = cs["median_nwr"]

        def fmt_dollars(v: float) -> str:
            if v >= 1e9:
                return f"${v/1e9:.2f}B"
            elif v >= 1e6:
                return f"${v/1e6:.1f}M"
            else:
                return f"${v/1e3:.0f}K"

        row = (
            f"{cid:>3}  "
            f"{cs['cluster_label']:<20}  "
            f"{cs['cluster_size']:>6}  "
            f"{fmt_dollars(med_a):>16}  "
            f"{fmt_dollars(min_a):>16}  "
            f"{fmt_dollars(max_a):>16}  "
            f"{med_roa*100:>7.3f}%  "
            f"{med_nwr*100:>7.3f}%"
        )
        print(row)

    print("=" * 90)
    print()


# ── Main ─────────────────────────────────────────────────────────────────

def run(db_path: str, k: int, quarter: Optional[str]) -> None:
    print(f"Connecting to: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    if quarter is None:
        quarter = get_latest_quarter(conn)
    print(f"Using quarter: {quarter}")

    # Step 1: Load data
    print("Loading data...")
    df = load_latest_quarter_data(conn, quarter)
    print(f"  Loaded {len(df):,} CUs with non-null assets and member_count.")

    if len(df) < k:
        print(f"ERROR: Not enough data ({len(df)} rows) for {k} clusters.")
        conn.close()
        sys.exit(1)

    # Step 2: Build feature matrix
    print("Building feature matrix...")
    X, df_clean = build_feature_matrix(df)
    print(f"  Feature matrix shape: {X.shape}")

    # Step 3: Run K-means
    print(f"Running K-means (k={k}, n_init=20)...")
    raw_labels = run_kmeans(X, k=k)

    # Step 4: Sort clusters by asset size (0 = smallest)
    print("Sorting clusters by median assets...")
    sorted_labels = sort_clusters_by_assets(df_clean, raw_labels, k)

    # Step 5: Compute cluster stats
    cluster_stats = compute_cluster_stats(df_clean, sorted_labels)

    # Step 6: Print summary
    print_summary(cluster_stats)

    # Step 7: Write to DB
    print("Writing results to peer_groups table...")
    write_peer_groups(conn, df_clean, sorted_labels, cluster_stats, quarter)

    conn.close()
    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="K-means peer group clustering for NCUA credit unions."
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB,
        help=f"Path to ncua_callreports.db (default: {DEFAULT_DB})",
    )
    parser.add_argument(
        "--k",
        type=int,
        default=8,
        help="Number of clusters (default: 8)",
    )
    parser.add_argument(
        "--quarter",
        default=None,
        help="Quarter label to cluster on (e.g. 2025-Q4). Defaults to latest in DB.",
    )
    args = parser.parse_args()
    run(db_path=args.db, k=args.k, quarter=args.quarter)
