"""
NCUA 5300 Call Report Ingestion
================================
Downloads and loads the last 5 years (20 quarters) of NCUA call report data
directly from ncua.gov into the local SQLite database.

URL pattern:
  https://www.ncua.gov/files/publications/analysis/call-report-data-{YYYY}-{MM}.zip

Months: 03=Q1, 06=Q2, 09=Q3, 12=Q4

Key source files inside each ZIP:
  FOICU.txt   — institution identifiers (name, state, charter type)
  FS220.txt   — balance sheet + delinquency + income (all CUs)
  FS220A.txt  — net worth, NWR, interest income/expense (CUs >$10M assets)

Usage:
  python ncua_ingest.py                  # load all 20 quarters
  python ncua_ingest.py --quarters 4     # most recent 4 quarters only
  python ncua_ingest.py --start 2023-Q1  # from a specific quarter
  python ncua_ingest.py --no-cache       # force re-download even if cached
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sqlite3
import sys
import time
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ncua_ingest")

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
DATA_DIR   = BASE_DIR / "data"
CACHE_DIR  = DATA_DIR / "ncua_cache"
DB_PATH    = DATA_DIR / "ncua_callreports.db"

DATA_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

# ── Quarter catalogue (Q1 2020 → Q4 2024 = 20 quarters) ─────────────────────
def build_quarter_list(start_label: str | None = None, n: int | None = None) -> list[dict]:
    quarters = []
    for year in range(2020, 2026):
        for q_num, month in enumerate([3, 6, 9, 12], 1):
            label = f"{year}-Q{q_num}"
            cycle_date = f"{year}-{month:02d}-{'31' if month in (3,12) else '30' if month in (6,9) else '28'}"
            quarters.append({
                "label":      label,
                "year":       year,
                "quarter":    q_num,
                "month":      month,
                "cycle_date": cycle_date,
                "url":        f"https://www.ncua.gov/files/publications/analysis/call-report-data-{year}-{month:02d}.zip",
                "cache_file": CACHE_DIR / f"ncua_{year}_{month:02d}.zip",
            })

    # Trim to those that have likely been published (NCUA lags ~4-5 weeks after quarter-end)
    cutoff = datetime.now()
    quarters = [q for q in quarters if datetime.strptime(q["cycle_date"], "%Y-%m-%d") < cutoff]

    if start_label:
        start_label = start_label.upper().replace(" ", "-")
        for i, q in enumerate(quarters):
            if q["label"] == start_label:
                quarters = quarters[i:]
                break

    if n:
        quarters = quarters[-n:]

    return quarters


# ── NCUA account → DB column mapping ─────────────────────────────────────────
#
# FS220.txt columns we care about
FS220_MAP = {
    "CU_NUMBER": "cu_number",            # Charter number (join key)
    "ACCT_010":  "total_assets",         # Total Assets ($)
    "ACCT_018":  "total_shares",         # Total Shares & Deposits ($)
    "ACCT_013":  "total_member_shares",  # Total Member Shares (excl. non-member deposits)
    "ACCT_025B": "total_loans",          # Total Loans & Leases amount ($)
    "ACCT_083":  "member_count",         # Number of current members
    # Delinquency buckets ($ amount)
    "ACCT_020B": "delinq_1_2mo",         # 1 to <2 months past due
    "ACCT_021B": "delinq_2_6mo",         # 2 to <6 months past due
    "ACCT_022B": "delinq_6_12mo",        # 6 to <12 months past due
    "ACCT_023B": "delinq_12mo_plus",     # 12+ months past due
    # YTD income/expense
    "ACCT_671":  "noninterest_expense_ytd",  # Total Non-Interest Expense (YTD)
    "ACCT_730":  "cash",                     # Cash & Cash Equivalents
    "ACCT_940":  "undivided_earnings",       # Undivided Earnings (retained surplus)
}

# FS220A.txt columns we care about
FS220A_MAP = {
    "CU_NUMBER": "cu_number",            # Charter number (join key)
    "ACCT_997":   "net_worth",                # Total Net Worth ($)
    "ACCT_998":   "net_worth_ratio_reported", # NWR in basis points (e.g. 1162 = 11.62%)
    "ACCT_115":   "interest_income_ytd",      # Total Interest Income (YTD)
    "ACCT_350":   "interest_expense_ytd",     # Total Interest Expense (YTD)
    "ACCT_661A":  "net_income_ytd",           # Net Income/Loss (YTD)
    "ACCT_117":   "noninterest_income_ytd",   # Total Non-Interest Income (YTD)
}

# FOICU.txt columns
FOICU_MAP = {
    "CU_NUMBER":    "cu_number",
    "CU_NAME":      "cu_name",
    "CITY":         "city",
    "STATE":        "state",
    "CU_TYPE":      "cu_type",           # 1=Federal, 2=State
    "CHARTERSTATE": "charter_state",     # uppercase after normalisation
    "REGION":       "region",
    "YEAR_OPENED":  "year_opened",
}

# CU_TYPE codes → label
CU_TYPE_LABELS = {
    "1": "Federal Credit Union",
    "2": "State-chartered Credit Union",
}

# Net Worth Classification text → short label (from ACCT_700 in FS220D)
NWR_CLASS_MAP = {
    "well capitalized":           "Well Capitalized",
    "adequately capitalized":     "Adequately Capitalized",
    "undercapitalized":           "Undercapitalized",
    "significantly undercapitalized": "Significantly Undercapitalized",
    "critically undercapitalized":    "Critically Undercapitalized",
    "new - not subject":              "New CU",
}


# ── Download helpers ──────────────────────────────────────────────────────────

def download_zip(url: str, cache_path: Path, force: bool = False) -> bytes:
    """Download a ZIP, using disk cache unless force=True."""
    if cache_path.exists() and not force:
        log.debug(f"  Cache hit: {cache_path.name}")
        return cache_path.read_bytes()

    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "CallRptAI-Ingest/1.0 (contact@callrptai.io)"},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            cache_path.write_bytes(data)
            log.debug(f"  Downloaded {len(data):,} bytes → {cache_path.name}")
            return data
        except Exception as exc:
            log.warning(f"  Attempt {attempt}/3 failed for {url}: {exc}")
            if attempt < 3:
                time.sleep(3 * attempt)
    raise RuntimeError(f"Failed to download {url} after 3 attempts")


def read_csv_from_zip(z: zipfile.ZipFile, filename: str) -> pd.DataFrame | None:
    """Read a CSV file from an open ZipFile, return DataFrame or None."""
    try:
        with z.open(filename) as f:
            df = pd.read_csv(f, encoding="latin-1", low_memory=False, dtype=str)
        # Normalise column names: strip whitespace
        df.columns = [c.strip().upper() for c in df.columns]
        return df
    except KeyError:
        log.warning(f"  '{filename}' not found in ZIP — skipping")
        return None
    except Exception as exc:
        log.warning(f"  Failed to read '{filename}': {exc}")
        return None


# ── Parsing helpers ───────────────────────────────────────────────────────────

def safe_float(series: pd.Series) -> pd.Series:
    """Convert a string series to float, coercing errors to NaN."""
    return pd.to_numeric(series, errors="coerce")


def extract_columns(df: pd.DataFrame, col_map: dict) -> pd.DataFrame:
    """Select and rename columns that exist in df according to col_map."""
    available = {src: dst for src, dst in col_map.items() if src in df.columns}
    missing = set(col_map.keys()) - set(available.keys())
    if missing:
        log.debug(f"  Missing columns (normal for older quarters): {sorted(missing)}")
    result = df[list(available.keys())].rename(columns=available).copy()
    return result


def parse_quarter(zip_bytes: bytes, quarter: dict) -> pd.DataFrame | None:
    """
    Parse a quarterly ZIP and return a merged DataFrame with one row per CU,
    containing all DB-relevant metrics.
    """
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    # ── FOICU: institution identifiers ────────────────────────────────────────
    foicu = read_csv_from_zip(z, "FOICU.txt")
    if foicu is None:
        log.error("  FOICU.txt missing — cannot process quarter")
        return None
    foicu = extract_columns(foicu, FOICU_MAP)
    foicu["cu_number"] = foicu["cu_number"].astype(str).str.strip()

    # ── FS220: main financials ────────────────────────────────────────────────
    fs220 = read_csv_from_zip(z, "FS220.txt")
    if fs220 is None:
        log.error("  FS220.txt missing — cannot process quarter")
        return None
    fs220 = extract_columns(fs220, FS220_MAP)
    fs220["cu_number"] = fs220["cu_number"].astype(str).str.strip()

    for col in fs220.columns:
        if col != "cu_number":
            fs220[col] = safe_float(fs220[col])

    # ── FS220A: net worth + interest income ───────────────────────────────────
    fs220a = read_csv_from_zip(z, "FS220A.txt")
    if fs220a is not None:
        fs220a = extract_columns(fs220a, FS220A_MAP)
        fs220a["cu_number"] = fs220a["cu_number"].astype(str).str.strip()
        for col in fs220a.columns:
            if col != "cu_number":
                fs220a[col] = safe_float(fs220a[col])
    else:
        # Create empty placeholder with correct columns
        fs220a = pd.DataFrame(columns=["cu_number"] + list(FS220A_MAP.values()))

    # ── FS220D: CAMEL / Net Worth Classification ──────────────────────────────
    fs220d = read_csv_from_zip(z, "FS220D.txt")
    nw_class = pd.DataFrame(columns=["cu_number", "camel_class"])
    if fs220d is not None and "ACCT_700" in fs220d.columns:
        nw_class = fs220d[["CU_NUMBER", "ACCT_700"]].copy()
        nw_class.columns = ["cu_number", "camel_class"]
        nw_class["cu_number"] = nw_class["cu_number"].astype(str).str.strip()
        nw_class["camel_class"] = nw_class["camel_class"].str.strip()

    # ── Merge all sources ─────────────────────────────────────────────────────
    df = foicu.merge(fs220, on="cu_number", how="left")
    df = df.merge(fs220a, on="cu_number", how="left")
    df = df.merge(nw_class, on="cu_number", how="left")

    if df.empty:
        log.warning("  Merge produced empty DataFrame")
        return None

    # ── Derived metrics ───────────────────────────────────────────────────────
    q_num = quarter["quarter"]   # 1-4
    annualise = 12 / (q_num * 3)  # Q1→4, Q2→2, Q3→4/3, Q4→1

    df["total_assets_n"]  = df["total_assets"].fillna(0)
    df["total_loans_n"]   = df["total_loans"].fillna(0)
    df["total_shares_n"]  = df["total_shares"].fillna(0)

    # ROA (annualised)
    with pd.option_context("mode.use_inf_as_na", True):
        df["roa"] = (
            df["net_income_ytd"].fillna(0) * annualise
            / df["total_assets_n"].replace(0, pd.NA)
        )

    # NWR — ACCT_998 is reported in basis points (e.g. 1162 = 11.62% = 0.1162)
    # Divide by 10000 to get decimal ratio. Fall back to computed if missing.
    nwr_bp = df.get("net_worth_ratio_reported", pd.Series(dtype=float))
    if nwr_bp is not None and nwr_bp.notna().any():
        df["net_worth_ratio"] = nwr_bp / 10000
    else:
        df["net_worth_ratio"] = (
            df.get("net_worth", pd.Series(dtype=float)).fillna(0)
            / df["total_assets_n"].replace(0, pd.NA)
        )

    # Loan-to-share ratio
    df["loan_to_share_ratio"] = (
        df["total_loans_n"]
        / df["total_shares_n"].replace(0, pd.NA)
    )

    # Delinquency rate: loans 2+ months past due / total loans
    delinq_cols = ["delinq_2_6mo", "delinq_6_12mo", "delinq_12mo_plus"]
    delinq_sum = sum(
        df[c].fillna(0) for c in delinq_cols if c in df.columns
    )
    df["delinquency_ratio"] = delinq_sum / df["total_loans_n"].replace(0, pd.NA)

    # Net Interest Margin (annualised)
    interest_income = df.get("interest_income_ytd", pd.Series(dtype=float)).fillna(0)
    interest_expense = df.get("interest_expense_ytd", pd.Series(dtype=float)).fillna(0)
    df["net_interest_income"] = interest_income - interest_expense
    df["net_interest_margin"] = (
        (interest_income - interest_expense) * annualise
        / df["total_assets_n"].replace(0, pd.NA)
    )

    # Efficiency ratio: non-interest expense / (interest income + non-interest income)
    nonint_income = df.get("noninterest_income_ytd", pd.Series(dtype=float)).fillna(0)
    opex = df.get("noninterest_expense_ytd", pd.Series(dtype=float)).fillna(0)
    total_revenue = (interest_income - interest_expense + nonint_income)
    df["efficiency_ratio"] = opex / total_revenue.replace(0, pd.NA)

    # Charter type label
    df["charter_type"] = df.get("cu_type", pd.Series(dtype=str)).map(CU_TYPE_LABELS).fillna("Credit Union")

    # Report date
    df["report_date"] = quarter["cycle_date"]
    df["quarter_label"] = quarter["label"]

    log.info(f"  Parsed {len(df):,} credit unions for {quarter['label']}")
    return df


# ── Database helpers ──────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS institutions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cu_number           TEXT UNIQUE NOT NULL,
    name                TEXT,
    city                TEXT,
    state               TEXT,
    charter_type        TEXT,
    charter_state       TEXT,
    institution_type    TEXT DEFAULT 'credit_union',
    active              INTEGER DEFAULT 1,
    total_assets_latest REAL,
    region              TEXT,
    year_opened         INTEGER
);

CREATE TABLE IF NOT EXISTS financial_data (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id      INTEGER NOT NULL REFERENCES institutions(id),
    report_date         TEXT NOT NULL,
    quarter_label       TEXT,
    -- Balance sheet
    total_assets        REAL,
    total_loans         REAL,
    total_shares        REAL,
    total_equity        REAL,
    cash                REAL,
    -- Members
    member_count        INTEGER,
    -- Income statement (YTD, annualised in derived cols)
    interest_income     REAL,
    interest_expense    REAL,
    net_interest_income REAL,
    noninterest_expense REAL,
    net_income          REAL,
    -- Ratios
    roa                 REAL,
    net_interest_margin REAL,
    net_worth_ratio     REAL,
    loan_to_share_ratio REAL,
    delinquency_ratio   REAL,
    efficiency_ratio    REAL,
    -- Classification
    camel_class         TEXT,
    UNIQUE(institution_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_fin_institution ON financial_data(institution_id);
CREATE INDEX IF NOT EXISTS idx_fin_date        ON financial_data(report_date);
CREATE INDEX IF NOT EXISTS idx_inst_state      ON institutions(state);
CREATE INDEX IF NOT EXISTS idx_inst_cu_number  ON institutions(cu_number);
"""


def init_db(conn: sqlite3.Connection) -> None:
    """Create tables if they don't exist."""
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    log.info("Database schema ready")


def upsert_institutions(conn: sqlite3.Connection, df: pd.DataFrame) -> dict[str, int]:
    """
    Insert or update institutions; return mapping cu_number → institution.id.
    """
    cu_to_id: dict[str, int] = {}

    for _, row in df[["cu_number", "cu_name", "city", "state",
                       "charter_type", "charter_state", "total_assets",
                       "region", "year_opened"]].drop_duplicates("cu_number").iterrows():
        cu_num  = str(row.get("cu_number", "")).strip()
        name    = str(row.get("cu_name", "")).strip()
        city    = str(row.get("city", "")).strip()
        state   = str(row.get("state", "")).strip()
        charter = str(row.get("charter_type", "Credit Union")).strip()
        ch_st   = str(row.get("charter_state", "")).strip()
        assets  = float(row.get("total_assets", 0) or 0)
        region  = str(row.get("region", "")).strip()
        yr_open = row.get("year_opened")
        try:
            yr_open = int(float(yr_open)) if yr_open and str(yr_open) not in ("nan", "") else None
        except (ValueError, TypeError):
            yr_open = None

        if not cu_num:
            continue

        conn.execute("""
            INSERT INTO institutions
                (cu_number, name, city, state, charter_type, charter_state,
                 institution_type, total_assets_latest, region, year_opened)
            VALUES (?, ?, ?, ?, ?, ?, 'credit_union', ?, ?, ?)
            ON CONFLICT(cu_number) DO UPDATE SET
                name                = excluded.name,
                city                = excluded.city,
                state               = excluded.state,
                charter_type        = excluded.charter_type,
                charter_state       = excluded.charter_state,
                total_assets_latest = excluded.total_assets_latest,
                region              = excluded.region,
                year_opened         = coalesce(excluded.year_opened, institutions.year_opened)
        """, (cu_num, name, city, state, charter, ch_st, assets, region, yr_open))

        row_id = conn.execute(
            "SELECT id FROM institutions WHERE cu_number = ?", (cu_num,)
        ).fetchone()
        if row_id:
            cu_to_id[cu_num] = row_id[0]

    conn.commit()
    return cu_to_id


def upsert_financials(conn: sqlite3.Connection, df: pd.DataFrame,
                      cu_to_id: dict[str, int]) -> int:
    """Insert or replace financial data rows. Returns count inserted."""
    rows_written = 0

    for _, row in df.iterrows():
        cu_num = str(row.get("cu_number", "")).strip()
        inst_id = cu_to_id.get(cu_num)
        if not inst_id:
            continue

        def g(col, default=None):
            v = row.get(col)
            if v is None:
                return default
            try:
                if pd.isna(v):
                    return default
            except (TypeError, ValueError):
                pass
            # convert numpy scalars → Python native types for sqlite3
            if hasattr(v, "item"):
                v = v.item()
            return v

        conn.execute("""
            INSERT INTO financial_data (
                institution_id, report_date, quarter_label,
                total_assets, total_loans, total_shares, total_equity, cash,
                member_count,
                interest_income, interest_expense, net_interest_income,
                noninterest_expense, net_income,
                roa, net_interest_margin, net_worth_ratio,
                loan_to_share_ratio, delinquency_ratio, efficiency_ratio,
                camel_class
            ) VALUES (
                ?,?,?,  ?,?,?,?,?,  ?,  ?,?,?,  ?,?,  ?,?,?,  ?,?,?,  ?
            )
            ON CONFLICT(institution_id, report_date) DO UPDATE SET
                quarter_label       = excluded.quarter_label,
                total_assets        = excluded.total_assets,
                total_loans         = excluded.total_loans,
                total_shares        = excluded.total_shares,
                total_equity        = excluded.total_equity,
                cash                = excluded.cash,
                member_count        = excluded.member_count,
                interest_income     = excluded.interest_income,
                interest_expense    = excluded.interest_expense,
                net_interest_income = excluded.net_interest_income,
                noninterest_expense = excluded.noninterest_expense,
                net_income          = excluded.net_income,
                roa                 = excluded.roa,
                net_interest_margin = excluded.net_interest_margin,
                net_worth_ratio     = excluded.net_worth_ratio,
                loan_to_share_ratio = excluded.loan_to_share_ratio,
                delinquency_ratio   = excluded.delinquency_ratio,
                efficiency_ratio    = excluded.efficiency_ratio,
                camel_class         = excluded.camel_class
        """, (
            inst_id,
            g("report_date"),
            g("quarter_label"),
            g("total_assets"),
            g("total_loans"),
            g("total_shares"),
            g("net_worth"),       # total_equity = net worth
            g("cash"),
            int(g("member_count", 0) or 0),
            g("interest_income_ytd"),
            g("interest_expense_ytd"),
            g("net_interest_income"),
            g("noninterest_expense_ytd"),
            g("net_income_ytd"),
            g("roa"),
            g("net_interest_margin"),
            g("net_worth_ratio"),
            g("loan_to_share_ratio"),
            g("delinquency_ratio"),
            g("efficiency_ratio"),
            g("camel_class"),
        ))
        rows_written += 1

    conn.commit()
    return rows_written


# ── Main ──────────────────────────────────────────────────────────────────────

def run(quarters: list[dict], force_download: bool = False, db_path: Path = DB_PATH) -> None:
    log.info(f"Starting NCUA 5300 ingest: {len(quarters)} quarters")
    log.info(f"  Range : {quarters[0]['label']} → {quarters[-1]['label']}")
    log.info(f"  DB    : {db_path}")
    log.info(f"  Cache : {CACHE_DIR}")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    init_db(conn)

    total_institutions = 0
    total_rows = 0
    failed_quarters = []

    for i, qtr in enumerate(quarters, 1):
        log.info(f"[{i:02d}/{len(quarters):02d}] {qtr['label']}  {qtr['url']}")

        try:
            # 1. Download (or read cache)
            zip_bytes = download_zip(qtr["url"], qtr["cache_file"], force=force_download)

            # 2. Parse
            df = parse_quarter(zip_bytes, qtr)
            if df is None or df.empty:
                log.warning(f"  No data extracted for {qtr['label']}")
                failed_quarters.append(qtr["label"])
                continue

            # 3. Upsert institutions
            cu_to_id = upsert_institutions(conn, df)
            total_institutions = max(total_institutions, len(cu_to_id))

            # 4. Upsert financials
            written = upsert_financials(conn, df, cu_to_id)
            total_rows += written
            log.info(f"  ✓  {written:,} financial rows upserted")

        except Exception as exc:
            log.error(f"  ✗  Quarter {qtr['label']} failed: {exc}", exc_info=True)
            failed_quarters.append(qtr["label"])

        # Brief pause to be polite to NCUA servers
        if i < len(quarters):
            time.sleep(0.5)

    conn.close()

    log.info("")
    log.info("══════════════════════════════════════")
    log.info("  NCUA ingest complete")
    log.info(f"  Institutions : {total_institutions:,}")
    log.info(f"  Financial rows: {total_rows:,}")
    if failed_quarters:
        log.warning(f"  Failed quarters: {failed_quarters}")
    log.info("══════════════════════════════════════")


def print_summary(db_path: Path = DB_PATH) -> None:
    """Print a quick summary of what's in the database."""
    if not db_path.exists():
        print("Database not found.")
        return
    conn = sqlite3.connect(db_path)
    inst_count = conn.execute("SELECT COUNT(*) FROM institutions").fetchone()[0]
    fin_count  = conn.execute("SELECT COUNT(*) FROM financial_data").fetchone()[0]
    quarters   = conn.execute(
        "SELECT DISTINCT quarter_label FROM financial_data ORDER BY report_date"
    ).fetchall()
    conn.close()

    print(f"\n{'═'*50}")
    print(f"  CallRpt AI — NCUA 5300 Database Summary")
    print(f"{'─'*50}")
    print(f"  Institutions   : {inst_count:,}")
    print(f"  Financial rows : {fin_count:,}")
    print(f"  Quarters loaded: {len(quarters)}")
    if quarters:
        labels = [q[0] for q in quarters]
        print(f"    First : {labels[0]}")
        print(f"    Last  : {labels[-1]}")
    print(f"{'═'*50}\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NCUA 5300 call report ingestion")
    parser.add_argument(
        "--quarters", "-n", type=int, default=None,
        help="Only load the most recent N quarters (default: all 20)"
    )
    parser.add_argument(
        "--start", type=str, default=None,
        help="Start from a specific quarter label, e.g. 2023-Q1"
    )
    parser.add_argument(
        "--no-cache", action="store_true",
        help="Force re-download even if cached ZIPs exist"
    )
    parser.add_argument(
        "--summary", action="store_true",
        help="Print database summary and exit"
    )
    parser.add_argument(
        "--db", type=str, default=str(DB_PATH),
        help=f"Path to SQLite database (default: {DB_PATH})"
    )
    args = parser.parse_args()

    db_path = Path(args.db)

    if args.summary:
        print_summary(db_path)
        sys.exit(0)

    quarters = build_quarter_list(start_label=args.start, n=args.quarters)

    if not quarters:
        log.error("No quarters matched — check --start or --quarters arguments")
        sys.exit(1)

    run(quarters, force_download=args.no_cache, db_path=db_path)
    print_summary(db_path)
