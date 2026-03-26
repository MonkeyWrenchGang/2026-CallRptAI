"""
CallRpt AI — NCUA 5300 API Router
Real data from ncua_callreports.db (populated by ncua_ingest.py).

Routes:
  GET /api/ncua/institutions          — search / list
  GET /api/ncua/institutions/{id}     — detail + 8Q trend
  GET /api/ncua/compare               — multi-CU comparison grid
  GET /api/ncua/pulse                 — market-wide stats + movers
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

# ── DB path ──────────────────────────────────────────────────────────────
_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
NCUA_DB = os.environ.get("NCUA_DB_PATH") or os.path.join(_DATA_DIR, "ncua_callreports.db")

router = APIRouter(prefix="/api/ncua", tags=["ncua"])


# ── helpers ──────────────────────────────────────────────────────────────

@contextmanager
def get_conn():
    conn = sqlite3.connect(NCUA_DB)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def rows_as_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]


def _latest_quarter(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        "SELECT quarter_label FROM financial_data ORDER BY report_date DESC LIMIT 1"
    ).fetchone()
    return row[0] if row else "2025-Q4"


def _prev_quarter_label(label: str) -> str:
    """Return the label one quarter before the given one."""
    year, q = label.split("-Q")
    year, q = int(year), int(q)
    if q == 1:
        return f"{year - 1}-Q4"
    return f"{year}-Q{q - 1}"


# ── /institutions ─────────────────────────────────────────────────────────

@router.get("/institutions")
def search_institutions(
    q: str = Query("", description="Name search substring"),
    state: str = Query("", description="2-letter state code"),
    charter_type: str = Query("", description="Federal Credit Union | State-chartered Credit Union"),
    min_assets: Optional[float] = Query(None, description="Minimum total assets ($)"),
    max_assets: Optional[float] = Query(None, description="Maximum total assets ($)"),
    limit: int = Query(50, ge=1, le=500),
):
    """Search institutions, returns latest-quarter KPIs."""
    with get_conn() as conn:
        latest = _latest_quarter(conn)

        filters = ["f.quarter_label = ?"]
        params: list = [latest]

        if q:
            filters.append("i.name LIKE ?")
            params.append(f"%{q}%")
        if state:
            filters.append("i.state = ?")
            params.append(state.upper())
        if charter_type:
            filters.append("i.charter_type = ?")
            params.append(charter_type)
        if min_assets is not None:
            filters.append("f.total_assets >= ?")
            params.append(min_assets)
        if max_assets is not None:
            filters.append("f.total_assets <= ?")
            params.append(max_assets)

        where = " AND ".join(filters)
        params.append(limit)

        rows = conn.execute(f"""
            SELECT
                i.id, i.cu_number, i.name, i.city, i.state,
                i.charter_type, i.year_opened,
                f.quarter_label,
                ROUND(f.total_assets, 0)        AS total_assets,
                ROUND(f.total_loans, 0)          AS total_loans,
                ROUND(f.total_shares, 0)         AS total_shares,
                f.member_count,
                ROUND(f.roa, 6)                  AS roa,
                ROUND(f.net_worth_ratio, 6)      AS net_worth_ratio,
                ROUND(f.loan_to_share_ratio, 4)  AS loan_to_share_ratio,
                ROUND(f.delinquency_ratio, 6)    AS delinquency_ratio,
                ROUND(f.net_interest_margin, 6)  AS net_interest_margin,
                ROUND(f.efficiency_ratio, 4)     AS efficiency_ratio,
                f.camel_class
            FROM institutions i
            JOIN financial_data f ON f.institution_id = i.id
            WHERE {where}
            ORDER BY f.total_assets DESC
            LIMIT ?
        """, params).fetchall()

        return {
            "quarter": latest,
            "count": len(rows),
            "institutions": rows_as_dicts(rows),
        }


# ── /institutions/{cu_number} ────────────────────────────────────────────

@router.get("/institutions/{cu_number}")
def get_institution(cu_number: str):
    """
    Returns institution details plus:
      - latest KPIs
      - 8-quarter trend (for sparklines)
      - peer percentile ranks (vs same asset-band CUs)
    """
    with get_conn() as conn:
        inst = conn.execute(
            "SELECT * FROM institutions WHERE cu_number = ?", (cu_number,)
        ).fetchone()
        if not inst:
            raise HTTPException(404, f"CU {cu_number} not found")
        inst_dict = dict(inst)
        inst_id = inst_dict["id"]

        # 8-quarter trend (most recent 8 quarters)
        trend = conn.execute("""
            SELECT
                quarter_label, report_date,
                ROUND(total_assets, 0)        AS total_assets,
                ROUND(total_loans, 0)          AS total_loans,
                ROUND(total_shares, 0)         AS total_shares,
                member_count,
                ROUND(net_income, 0)           AS net_income,
                ROUND(roa, 6)                  AS roa,
                ROUND(net_worth_ratio, 6)      AS net_worth_ratio,
                ROUND(loan_to_share_ratio, 4)  AS loan_to_share_ratio,
                ROUND(delinquency_ratio, 6)    AS delinquency_ratio,
                ROUND(net_interest_margin, 6)  AS net_interest_margin,
                ROUND(efficiency_ratio, 4)     AS efficiency_ratio,
                camel_class
            FROM financial_data
            WHERE institution_id = ?
            ORDER BY report_date DESC
            LIMIT 8
        """, (inst_id,)).fetchall()

        trend_list = rows_as_dicts(trend)
        trend_list.reverse()          # chronological for charts
        latest = trend_list[-1] if trend_list else {}

        # Peer percentile: rank this CU vs asset-band peers (latest quarter)
        latest_q = latest.get("quarter_label", _latest_quarter(conn))
        assets = latest.get("total_assets", 0) or 0
        lo, hi = assets * 0.5, assets * 2.0

        peers = conn.execute("""
            SELECT roa, net_worth_ratio, delinquency_ratio,
                   loan_to_share_ratio, efficiency_ratio
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE f.quarter_label = ?
              AND f.total_assets BETWEEN ? AND ?
              AND roa IS NOT NULL
        """, (latest_q, lo, hi)).fetchall()

        peer_list = rows_as_dicts(peers)
        n = len(peer_list)

        def pctile(metric: str, val, higher_is_better=True) -> Optional[float]:
            if val is None or n == 0:
                return None
            vals = [p[metric] for p in peer_list if p[metric] is not None]
            if not vals:
                return None
            below = sum(1 for v in vals if v < val)
            pct = round(below / len(vals) * 100, 1)
            return pct if higher_is_better else round(100 - pct, 1)

        roa_val = latest.get("roa")
        nwr_val = latest.get("net_worth_ratio")
        delinq_val = latest.get("delinquency_ratio")
        lts_val = latest.get("loan_to_share_ratio")
        eff_val = latest.get("efficiency_ratio")

        percentiles = {
            "roa":               pctile("roa", roa_val, True),
            "net_worth_ratio":   pctile("net_worth_ratio", nwr_val, True),
            "delinquency_ratio": pctile("delinquency_ratio", delinq_val, False),
            "loan_to_share":     pctile("loan_to_share_ratio", lts_val, True),
            "efficiency_ratio":  pctile("efficiency_ratio", eff_val, False),
            "peer_count":        n,
        }

        # Peer group info (graceful degradation if table doesn't exist)
        peer_group = None
        try:
            pg_row = conn.execute("""
                SELECT cluster_id, cluster_label, cluster_size, cluster_median_assets
                FROM peer_groups
                WHERE cu_number = ?
            """, (cu_number,)).fetchone()
            if pg_row:
                peer_group = dict(pg_row)
        except Exception:
            pass  # peer_groups table may not exist yet

        return {
            "institution": inst_dict,
            "latest": latest,
            "trend": trend_list,
            "percentiles": percentiles,
            "peer_group": peer_group,
        }


# ── /compare ─────────────────────────────────────────────────────────────

@router.get("/compare")
def compare(
    cu_numbers: str = Query(..., description="Comma-separated CU charter numbers"),
    quarters: int = Query(8, ge=2, le=24, description="Quarters of history to return"),
):
    """
    Multi-CU comparison: returns latest KPIs + sparkline trend for each CU.
    Also returns national percentile ranks for each metric.
    """
    ids = [x.strip() for x in cu_numbers.split(",") if x.strip()]
    if not ids:
        raise HTTPException(400, "Provide at least one cu_number")
    if len(ids) > 6:
        raise HTTPException(400, "Max 6 CUs for compare")

    with get_conn() as conn:
        latest_q = _latest_quarter(conn)

        result = []
        for cu_num in ids:
            inst = conn.execute(
                "SELECT * FROM institutions WHERE cu_number = ?", (cu_num,)
            ).fetchone()
            if not inst:
                continue
            inst_dict = dict(inst)
            inst_id = inst_dict["id"]

            # Latest KPIs
            latest_row = conn.execute("""
                SELECT
                    quarter_label, report_date,
                    ROUND(total_assets, 0)       AS total_assets,
                    ROUND(total_loans, 0)         AS total_loans,
                    ROUND(total_shares, 0)        AS total_shares,
                    member_count,
                    ROUND(net_income, 0)          AS net_income,
                    ROUND(roa, 6)                 AS roa,
                    ROUND(net_worth_ratio, 6)     AS net_worth_ratio,
                    ROUND(loan_to_share_ratio, 4) AS loan_to_share_ratio,
                    ROUND(delinquency_ratio, 6)   AS delinquency_ratio,
                    ROUND(net_interest_margin, 6) AS net_interest_margin,
                    ROUND(efficiency_ratio, 4)    AS efficiency_ratio,
                    camel_class
                FROM financial_data
                WHERE institution_id = ?
                ORDER BY report_date DESC
                LIMIT 1
            """, (inst_id,)).fetchone()

            # Trend (N most recent quarters)
            trend_rows = conn.execute(f"""
                SELECT
                    quarter_label,
                    ROUND(roa, 6)                 AS roa,
                    ROUND(net_worth_ratio, 6)     AS net_worth_ratio,
                    ROUND(loan_to_share_ratio, 4) AS loan_to_share_ratio,
                    ROUND(delinquency_ratio, 6)   AS delinquency_ratio,
                    ROUND(net_interest_margin, 6) AS net_interest_margin,
                    ROUND(total_assets, 0)        AS total_assets,
                    member_count
                FROM financial_data
                WHERE institution_id = ?
                ORDER BY report_date DESC
                LIMIT {quarters}
            """, (inst_id,)).fetchall()

            trend = list(reversed(rows_as_dicts(trend_rows)))

            result.append({
                "institution": inst_dict,
                "latest": dict(latest_row) if latest_row else {},
                "trend": trend,
            })

        if not result:
            raise HTTPException(404, "No matching CUs found")

        # National percentiles for each metric (latest quarter, all CUs)
        nat_rows = conn.execute("""
            SELECT roa, net_worth_ratio, delinquency_ratio,
                   loan_to_share_ratio, efficiency_ratio, net_interest_margin
            FROM financial_data
            WHERE quarter_label = ? AND roa IS NOT NULL
        """, (latest_q,)).fetchall()
        nat = rows_as_dicts(nat_rows)
        n_nat = len(nat)

        def nat_pctile(metric: str, val, higher_is_better=True) -> Optional[float]:
            if val is None or n_nat == 0:
                return None
            vals = [p[metric] for p in nat if p[metric] is not None]
            if not vals:
                return None
            below = sum(1 for v in vals if v < val)
            pct = round(below / len(vals) * 100, 1)
            return pct if higher_is_better else round(100 - pct, 1)

        for item in result:
            lat = item["latest"]
            item["national_percentiles"] = {
                "roa":               nat_pctile("roa", lat.get("roa"), True),
                "net_worth_ratio":   nat_pctile("net_worth_ratio", lat.get("net_worth_ratio"), True),
                "delinquency_ratio": nat_pctile("delinquency_ratio", lat.get("delinquency_ratio"), False),
                "loan_to_share":     nat_pctile("loan_to_share_ratio", lat.get("loan_to_share_ratio"), True),
                "efficiency_ratio":  nat_pctile("efficiency_ratio", lat.get("efficiency_ratio"), False),
                "nim":               nat_pctile("net_interest_margin", lat.get("net_interest_margin"), True),
            }

        return {
            "quarter": latest_q,
            "national_cu_count": n_nat,
            "cus": result,
        }


# ── /pulse ───────────────────────────────────────────────────────────────

@router.get("/pulse")
def pulse(
    state: str = Query("", description="Filter by state"),
    min_assets: Optional[float] = Query(None),
    max_assets: Optional[float] = Query(None),
):
    """
    Market-wide credit union stats:
      - Summary cards (count, median ROA, median NWR, # below 7% NWR)
      - Top movers: biggest QoQ ROA improvement
      - NWR distribution by band
      - Risk radar: high delinquency + low NWR
    """
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)
        prev_q = _prev_quarter_label(latest_q)

        # Build asset/state filter
        filters = ["f.quarter_label = ?"]
        params: list = [latest_q]
        if state:
            filters.append("i.state = ?")
            params.append(state.upper())
        if min_assets is not None:
            filters.append("f.total_assets >= ?")
            params.append(min_assets)
        if max_assets is not None:
            filters.append("f.total_assets <= ?")
            params.append(max_assets)
        where = " AND ".join(filters)

        # All latest-quarter rows for summary
        all_rows = conn.execute(f"""
            SELECT
                f.roa, f.net_worth_ratio, f.delinquency_ratio,
                f.loan_to_share_ratio, f.efficiency_ratio,
                f.total_assets, f.member_count
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE {where}
              AND f.roa IS NOT NULL
        """, params).fetchall()
        all_list = rows_as_dicts(all_rows)
        n = len(all_list)

        def median(vals):
            s = sorted(v for v in vals if v is not None)
            if not s:
                return None
            mid = len(s) // 2
            return round(s[mid], 6) if len(s) % 2 else round((s[mid - 1] + s[mid]) / 2, 6)

        roa_vals   = [r["roa"] for r in all_list]
        nwr_vals   = [r["net_worth_ratio"] for r in all_list]
        delinq_vals = [r["delinquency_ratio"] for r in all_list]
        lts_vals   = [r["loan_to_share_ratio"] for r in all_list]
        assets_vals = [r["total_assets"] for r in all_list]
        members_vals = [r["member_count"] for r in all_list if r["member_count"]]

        below_7 = sum(1 for v in nwr_vals if v is not None and v < 0.07)
        below_10 = sum(1 for v in nwr_vals if v is not None and v < 0.10)

        summary = {
            "quarter":          latest_q,
            "cu_count":         n,
            "median_roa":       median(roa_vals),
            "median_nwr":       median(nwr_vals),
            "median_delinquency": median(delinq_vals),
            "median_loan_to_share": median(lts_vals),
            "total_assets":     sum(v for v in assets_vals if v),
            "total_members":    sum(members_vals),
            "below_7pct_nwr":   below_7,
            "below_10pct_nwr":  below_10,
        }

        # NWR distribution bands
        bands = [
            ("<7%",   lambda v: v < 0.07),
            ("7–8%",  lambda v: 0.07 <= v < 0.08),
            ("8–9%",  lambda v: 0.08 <= v < 0.09),
            ("9–10%", lambda v: 0.09 <= v < 0.10),
            ("≥10%",  lambda v: v >= 0.10),
        ]
        nwr_dist = []
        for label, fn in bands:
            count = sum(1 for v in nwr_vals if v is not None and fn(v))
            nwr_dist.append({"band": label, "count": count,
                              "pct": round(count / n * 100, 1) if n else 0})

        # Top movers: biggest QoQ ROA improvement
        prev_params: list = [prev_q]
        if state:
            prev_params.append(state.upper())
        prev_where_extra = " AND i.state = ?" if state else ""

        movers_rows = conn.execute(f"""
            SELECT
                i.cu_number, i.name, i.state, i.charter_type,
                curr.total_assets,
                curr.roa        AS roa_curr,
                prev.roa        AS roa_prev,
                ROUND(curr.roa - prev.roa, 6) AS roa_delta,
                curr.net_worth_ratio,
                curr.delinquency_ratio
            FROM financial_data curr
            JOIN financial_data prev ON prev.institution_id = curr.institution_id
                                     AND prev.quarter_label = ?
            JOIN institutions i ON i.id = curr.institution_id
            WHERE curr.quarter_label = ?
              AND curr.roa IS NOT NULL AND prev.roa IS NOT NULL
              AND curr.total_assets > 10000000   -- exclude tiny CUs < $10M
              {prev_where_extra}
            ORDER BY roa_delta DESC
            LIMIT 20
        """, [prev_q, latest_q] + ([state.upper()] if state else [])).fetchall()

        top_movers = rows_as_dicts(movers_rows)

        # Risk radar: delinquency > 2% AND NWR < 8%
        risk_filters = list(filters) + [
            "f.delinquency_ratio > 0.02",
            "f.net_worth_ratio < 0.08",
            "f.total_assets > 5000000",
        ]
        risk_where = " AND ".join(risk_filters)
        risk_rows = conn.execute(f"""
            SELECT
                i.cu_number, i.name, i.state, i.charter_type,
                ROUND(f.total_assets, 0)        AS total_assets,
                ROUND(f.roa, 6)                 AS roa,
                ROUND(f.net_worth_ratio, 6)     AS net_worth_ratio,
                ROUND(f.delinquency_ratio, 6)   AS delinquency_ratio,
                ROUND(f.loan_to_share_ratio, 4) AS loan_to_share_ratio,
                f.camel_class
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE {risk_where}
            ORDER BY f.net_worth_ratio ASC
            LIMIT 50
        """, params).fetchall()

        risk_radar = rows_as_dicts(risk_rows)

        # Historical median trend (8 quarters, for market trend chart)
        hist_rows = conn.execute("""
            SELECT
                quarter_label,
                AVG(roa)                AS median_roa,
                AVG(net_worth_ratio)    AS median_nwr,
                AVG(delinquency_ratio)  AS median_delinquency,
                COUNT(*)                AS cu_count
            FROM financial_data
            WHERE roa IS NOT NULL
            GROUP BY quarter_label
            ORDER BY MIN(report_date) DESC
            LIMIT 8
        """).fetchall()
        market_trend = list(reversed(rows_as_dicts(hist_rows)))

        return {
            "summary":      summary,
            "nwr_dist":     nwr_dist,
            "top_movers":   top_movers,
            "risk_radar":   risk_radar,
            "market_trend": market_trend,
        }


# ── /search-suggest ───────────────────────────────────────────────────────

@router.get("/search")
def search_suggest(
    q: str = Query(..., min_length=2),
    limit: int = Query(10, ge=1, le=30),
):
    """Fast typeahead: returns name + cu_number + state + latest assets."""
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)
        rows = conn.execute("""
            SELECT i.cu_number, i.name, i.state, i.charter_type,
                   ROUND(f.total_assets, 0) AS total_assets
            FROM institutions i
            LEFT JOIN financial_data f
                   ON f.institution_id = i.id AND f.quarter_label = ?
            WHERE i.name LIKE ?
            ORDER BY f.total_assets DESC NULLS LAST
            LIMIT ?
        """, (latest_q, f"%{q}%", limit)).fetchall()
        return {"results": rows_as_dicts(rows)}


# ── /institutions/{cu_number}/peers ───────────────────────────────────────

@router.get("/institutions/{cu_number}/peers")
def get_institution_peers(cu_number: str):
    """
    Returns the CU's cluster assignment and the 10 closest peers within
    the same cluster, ranked by |log10(assets) difference| from the subject CU.

    Each peer includes: cu_number, name, state, charter_type, total_assets,
    roa, net_worth_ratio, delinquency_ratio, loan_to_share_ratio.

    Returns 404 if the CU is not found, or 503 if peer groups haven't been
    computed yet.
    """
    with get_conn() as conn:
        # Verify CU exists
        inst = conn.execute(
            "SELECT * FROM institutions WHERE cu_number = ?", (cu_number,)
        ).fetchone()
        if not inst:
            raise HTTPException(404, f"CU {cu_number} not found")

        # Check peer_groups table exists
        tbl_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='peer_groups'"
        ).fetchone()
        if not tbl_check:
            raise HTTPException(
                503,
                "Peer groups have not been computed yet. "
                "Run backend/peer_clustering.py first.",
            )

        # Get this CU's cluster assignment
        pg_row = conn.execute("""
            SELECT cluster_id, cluster_label, cluster_size, cluster_median_assets,
                   quarter_label
            FROM peer_groups
            WHERE cu_number = ?
        """, (cu_number,)).fetchone()

        if not pg_row:
            raise HTTPException(
                404,
                f"CU {cu_number} has no peer group assignment. "
                "Re-run peer_clustering.py to include this CU.",
            )

        pg = dict(pg_row)
        cluster_id = pg["cluster_id"]
        quarter_label = pg["quarter_label"]

        # Get subject CU's latest assets for distance ranking
        subject_assets_row = conn.execute("""
            SELECT f.total_assets
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE i.cu_number = ? AND f.quarter_label = ?
        """, (cu_number, quarter_label)).fetchone()

        subject_assets = subject_assets_row["total_assets"] if subject_assets_row else None
        import math as _math
        subject_log_assets = (
            _math.log10(subject_assets) if subject_assets and subject_assets > 0 else None
        )

        # Get all peers in same cluster (excluding the subject CU itself)
        peers_rows = conn.execute("""
            SELECT
                i.cu_number, i.name, i.state, i.charter_type,
                ROUND(f.total_assets, 0)        AS total_assets,
                ROUND(f.roa, 6)                 AS roa,
                ROUND(f.net_worth_ratio, 6)     AS net_worth_ratio,
                ROUND(f.delinquency_ratio, 6)   AS delinquency_ratio,
                ROUND(f.loan_to_share_ratio, 4) AS loan_to_share_ratio
            FROM peer_groups pg
            JOIN institutions i ON i.cu_number = pg.cu_number
            JOIN financial_data f
                ON f.institution_id = i.id AND f.quarter_label = ?
            WHERE pg.cluster_id = ?
              AND pg.cu_number != ?
              AND f.total_assets IS NOT NULL
        """, (quarter_label, cluster_id, cu_number)).fetchall()

        peers_list = rows_as_dicts(peers_rows)

        # Rank by |log_assets difference| from subject CU
        if subject_log_assets is not None:
            for p in peers_list:
                ta = p.get("total_assets") or 0
                if ta > 0:
                    p["_log_dist"] = abs(_math.log10(ta) - subject_log_assets)
                else:
                    p["_log_dist"] = float("inf")
            peers_list.sort(key=lambda p: p["_log_dist"])
            for p in peers_list:
                p.pop("_log_dist", None)

        top_peers = peers_list[:10]

        return {
            "cu_number": cu_number,
            "cluster_id": pg["cluster_id"],
            "cluster_label": pg["cluster_label"],
            "cluster_size": pg["cluster_size"],
            "cluster_median_assets": pg["cluster_median_assets"],
            "quarter_label": quarter_label,
            "peers": top_peers,
        }


# ── /peer-groups ──────────────────────────────────────────────────────────

@router.get("/peer-groups")
def get_peer_groups():
    """
    Returns summary of all 8 K-means clusters:
    cluster_id, cluster_label, count, median_assets, median_roa, median_nwr,
    median_delinquency, asset_range (min/max assets).

    Returns 503 if peer groups haven't been computed yet.
    """
    with get_conn() as conn:
        # Check peer_groups table exists
        tbl_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='peer_groups'"
        ).fetchone()
        if not tbl_check:
            raise HTTPException(
                503,
                "Peer groups have not been computed yet. "
                "Run backend/peer_clustering.py first.",
            )

        # Get quarter used for clustering
        q_row = conn.execute(
            "SELECT quarter_label FROM peer_groups LIMIT 1"
        ).fetchone()
        if not q_row:
            raise HTTPException(
                503,
                "Peer groups table is empty. Run backend/peer_clustering.py first.",
            )
        quarter_label = q_row["quarter_label"]

        # Aggregate per cluster: join peer_groups with financial_data
        rows = conn.execute("""
            SELECT
                pg.cluster_id,
                pg.cluster_label,
                pg.cluster_size,
                pg.cluster_median_assets,
                MIN(f.total_assets)              AS min_assets,
                MAX(f.total_assets)              AS max_assets,
                AVG(f.roa)                       AS avg_roa,
                AVG(f.net_worth_ratio)           AS avg_nwr,
                AVG(f.delinquency_ratio)         AS avg_delinquency,
                AVG(f.loan_to_share_ratio)       AS avg_loan_to_share
            FROM peer_groups pg
            JOIN institutions i ON i.cu_number = pg.cu_number
            JOIN financial_data f
                ON f.institution_id = i.id AND f.quarter_label = ?
            GROUP BY pg.cluster_id, pg.cluster_label, pg.cluster_size,
                     pg.cluster_median_assets
            ORDER BY pg.cluster_id
        """, (quarter_label,)).fetchall()

        clusters = []
        for r in rows:
            d = dict(r)
            # Round for cleaner output
            d["avg_roa"]          = round(d["avg_roa"], 6)          if d["avg_roa"] is not None else None
            d["avg_nwr"]          = round(d["avg_nwr"], 6)          if d["avg_nwr"] is not None else None
            d["avg_delinquency"]  = round(d["avg_delinquency"], 6)  if d["avg_delinquency"] is not None else None
            d["avg_loan_to_share"]= round(d["avg_loan_to_share"], 4)if d["avg_loan_to_share"] is not None else None
            clusters.append(d)

        return {
            "quarter_label": quarter_label,
            "cluster_count": len(clusters),
            "clusters": clusters,
        }
