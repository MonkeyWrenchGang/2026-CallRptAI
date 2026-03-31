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

import json
import os
import sqlite3
import time
import urllib.request
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
    if len(ids) > 8:
        raise HTTPException(400, "Max 8 CUs for compare")

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

        median_eff = median([r.get("efficiency_ratio") for r in all_list if r.get("efficiency_ratio")])

        summary = {
            "quarter":          latest_q,
            "prev_quarter":     prev_q,
            "cu_count":         n,
            "median_roa":       median(roa_vals),
            "median_nwr":       median(nwr_vals),
            "median_delinquency": median(delinq_vals),
            "median_loan_to_share": median(lts_vals),
            "median_efficiency": median_eff,
            "total_assets":     sum(v for v in assets_vals if v),
            "total_members":    sum(members_vals),
            "below_7pct_nwr":   below_7,
            "below_10pct_nwr":  below_10,
        }

        # Previous quarter summary for QoQ changes
        prev_rows = conn.execute("""
            SELECT f.roa, f.net_worth_ratio, f.delinquency_ratio,
                   f.loan_to_share_ratio, f.efficiency_ratio,
                   f.total_assets, f.member_count
            FROM financial_data f
            WHERE f.quarter_label = ? AND f.roa IS NOT NULL
        """, (prev_q,)).fetchall()
        prev_list = rows_as_dicts(prev_rows)

        prev_summary = {
            "median_roa": median([r["roa"] for r in prev_list]),
            "median_nwr": median([r["net_worth_ratio"] for r in prev_list]),
            "median_delinquency": median([r["delinquency_ratio"] for r in prev_list]),
            "median_loan_to_share": median([r["loan_to_share_ratio"] for r in prev_list]),
            "median_efficiency": median([r.get("efficiency_ratio") for r in prev_list if r.get("efficiency_ratio")]),
            "total_assets": sum(v for v in [r["total_assets"] for r in prev_list] if v),
            "total_members": sum(r["member_count"] for r in prev_list if r.get("member_count")),
        }

        # Industry distribution percentiles (for gauge visualization)
        def percentile_at(vals, pct):
            s = sorted(v for v in vals if v is not None)
            if not s:
                return None
            idx = int(len(s) * pct / 100)
            idx = min(idx, len(s) - 1)
            return round(s[idx], 6)

        distributions = {}
        for metric, vals in [
            ("roa", roa_vals), ("nwr", nwr_vals),
            ("delinquency", delinq_vals), ("loan_to_share", lts_vals),
        ]:
            distributions[metric] = {
                "p10": percentile_at(vals, 10),
                "p25": percentile_at(vals, 25),
                "p50": percentile_at(vals, 50),
                "p75": percentile_at(vals, 75),
                "p90": percentile_at(vals, 90),
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
            "summary":        summary,
            "prev_summary":   prev_summary,
            "distributions":  distributions,
            "nwr_dist":       nwr_dist,
            "top_movers":     top_movers,
            "risk_radar":     risk_radar,
            "market_trend":   market_trend,
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


# ── /quick-access (bulk lookup for sidebar) ───────────────────────────────

@router.get("/quick-access")
def quick_access(
    cu_numbers: str = Query(..., description="Comma-separated CU numbers"),
):
    """Return key metrics for a set of CU numbers (sidebar quick access)."""
    nums = [n.strip() for n in cu_numbers.split(",") if n.strip()]
    if not nums:
        return {"results": []}

    placeholders = ",".join("?" for _ in nums)
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)
        rows = conn.execute(f"""
            SELECT i.cu_number, i.name, i.state, i.city,
                   ROUND(f.total_assets, 0)        AS total_assets,
                   f.member_count,
                   ROUND(f.roa, 6)                  AS roa,
                   ROUND(f.net_worth_ratio, 6)      AS net_worth_ratio,
                   ROUND(f.delinquency_ratio, 6)    AS delinquency_ratio,
                   f.camel_class
            FROM institutions i
            LEFT JOIN financial_data f
                   ON f.institution_id = i.id AND f.quarter_label = ?
            WHERE i.cu_number IN ({placeholders})
            ORDER BY f.total_assets DESC NULLS LAST
        """, (latest_q, *nums)).fetchall()
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

        # Get subject CU's metrics for similarity scoring
        subject_metrics_row = conn.execute("""
            SELECT f.roa, f.net_worth_ratio, f.delinquency_ratio,
                   f.loan_to_share_ratio, f.efficiency_ratio, f.member_count
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE i.cu_number = ? AND f.quarter_label = ?
        """, (cu_number, quarter_label)).fetchone()
        subject_metrics = dict(subject_metrics_row) if subject_metrics_row else {}

        # Compute similarity score (0-100) based on multiple dimensions
        def _similarity(peer):
            score = 100.0
            # Asset size distance (log scale, weighted 30%)
            ta = peer.get("total_assets") or 0
            if subject_log_assets and ta > 0:
                asset_dist = abs(_math.log10(ta) - subject_log_assets)
                score -= min(asset_dist * 15, 30)  # max 30pt penalty
            else:
                score -= 30

            # ROA distance (weighted 20%)
            if subject_metrics.get("roa") is not None and peer.get("roa") is not None:
                roa_dist = abs(peer["roa"] - subject_metrics["roa"])
                score -= min(roa_dist * 2000, 20)
            # NWR distance (weighted 20%)
            if subject_metrics.get("net_worth_ratio") is not None and peer.get("net_worth_ratio") is not None:
                nwr_dist = abs(peer["net_worth_ratio"] - subject_metrics["net_worth_ratio"])
                score -= min(nwr_dist * 500, 20)
            # Delinquency distance (weighted 15%)
            if subject_metrics.get("delinquency_ratio") is not None and peer.get("delinquency_ratio") is not None:
                del_dist = abs(peer["delinquency_ratio"] - subject_metrics["delinquency_ratio"])
                score -= min(del_dist * 1500, 15)
            # L/S ratio distance (weighted 15%)
            if subject_metrics.get("loan_to_share_ratio") is not None and peer.get("loan_to_share_ratio") is not None:
                ls_dist = abs(peer["loan_to_share_ratio"] - subject_metrics["loan_to_share_ratio"])
                score -= min(ls_dist * 100, 15)

            return max(round(score, 1), 0)

        for p in peers_list:
            p["similarity_score"] = _similarity(p)

        peers_list.sort(key=lambda p: -p["similarity_score"])

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


# ── /peer-group-stats ─────────────────────────────────────────────────────

@router.get("/peer-group-stats")
def peer_group_stats(
    state: str = Query("", description="2-letter state code"),
    charter_type: str = Query(""),
    min_assets: Optional[float] = Query(None),
    max_assets: Optional[float] = Query(None),
):
    """Return aggregate stats for CUs matching filter criteria."""
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)
        filters = ["f.quarter_label = ?", "f.roa IS NOT NULL"]
        params: list = [latest_q]
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

        rows = conn.execute(f"""
            SELECT i.cu_number, i.name, i.state,
                   ROUND(f.total_assets, 0) AS total_assets,
                   ROUND(f.roa, 6) AS roa,
                   ROUND(f.net_worth_ratio, 6) AS net_worth_ratio,
                   ROUND(f.delinquency_ratio, 6) AS delinquency_ratio,
                   f.member_count
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE {where}
            ORDER BY f.total_assets DESC
            LIMIT 200
        """, params).fetchall()
        results = rows_as_dicts(rows)

        roa_vals = [r["roa"] for r in results if r["roa"] is not None]
        nwr_vals = [r["net_worth_ratio"] for r in results if r["net_worth_ratio"] is not None]

        return {
            "quarter": latest_q,
            "count": len(results),
            "cu_numbers": [r["cu_number"] for r in results],
            "institutions": results[:50],
            "avg_roa": round(sum(roa_vals) / len(roa_vals), 6) if roa_vals else None,
            "avg_nwr": round(sum(nwr_vals) / len(nwr_vals), 6) if nwr_vals else None,
            "total_assets": sum(r["total_assets"] or 0 for r in results),
        }


# ── /institutions/{cu_number}/market-share ────────────────────────────────

@router.get("/institutions/{cu_number}/market-share")
def market_share(cu_number: str):
    """CU's share of assets, loans, members within its state over 8 quarters."""
    with get_conn() as conn:
        inst = conn.execute(
            "SELECT id, state FROM institutions WHERE cu_number = ?", (cu_number,)
        ).fetchone()
        if not inst:
            raise HTTPException(404, f"CU {cu_number} not found")
        inst_id, state = inst["id"], inst["state"]

        rows = conn.execute("""
            SELECT
                f.quarter_label,
                f.total_assets   AS cu_assets,
                f.total_loans    AS cu_loans,
                f.member_count   AS cu_members,
                state_agg.state_assets,
                state_agg.state_loans,
                state_agg.state_members
            FROM financial_data f
            INNER JOIN (
                SELECT f2.quarter_label AS ql,
                       SUM(f2.total_assets)  AS state_assets,
                       SUM(f2.total_loans)   AS state_loans,
                       SUM(f2.member_count)  AS state_members
                FROM financial_data f2
                JOIN institutions i2 ON i2.id = f2.institution_id
                WHERE i2.state = ?
                GROUP BY f2.quarter_label
            ) state_agg ON state_agg.ql = f.quarter_label
            WHERE f.institution_id = ?
            ORDER BY f.report_date DESC
            LIMIT 8
        """, (state, inst_id)).fetchall()

        result = []
        for r in reversed(rows_as_dicts(rows)):
            sa = r["state_assets"] or 1
            sl = r["state_loans"] or 1
            sm = r["state_members"] or 1
            result.append({
                "quarter": r["quarter_label"],
                "asset_share": round((r["cu_assets"] or 0) / sa, 6),
                "loan_share": round((r["cu_loans"] or 0) / sl, 6),
                "member_share": round((r["cu_members"] or 0) / sm, 6),
                "cu_assets": r["cu_assets"],
                "state_assets": r["state_assets"],
            })

        return {"cu_number": cu_number, "state": state, "trend": result}


# ── /ma-radar ─────────────────────────────────────────────────────────────

@router.get("/ma-radar")
def ma_radar(
    state: str = Query("", description="Filter by state"),
    limit: int = Query(100, ge=1, le=200),
):
    """Flag CUs matching acquisition profiles."""
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)
        prev_q = _prev_quarter_label(latest_q)
        prev2_q = _prev_quarter_label(prev_q)

        state_filter = ""
        params: list = [prev_q, prev2_q, latest_q]
        if state:
            state_filter = "AND i.state = ?"
            params.append(state.upper())
        params.append(limit)

        rows = conn.execute(f"""
            SELECT
                i.cu_number, i.name, i.state, i.city, i.charter_type,
                curr.total_assets,
                curr.member_count  AS members_curr,
                prev1.member_count AS members_prev1,
                prev2.member_count AS members_prev2,
                curr.net_worth_ratio  AS nwr_curr,
                prev1.net_worth_ratio AS nwr_prev1,
                prev2.net_worth_ratio AS nwr_prev2,
                curr.efficiency_ratio,
                curr.roa,
                curr.delinquency_ratio,
                curr.camel_class
            FROM financial_data curr
            JOIN institutions i ON i.id = curr.institution_id
            LEFT JOIN financial_data prev1
                ON prev1.institution_id = curr.institution_id
                AND prev1.quarter_label = ?
            LEFT JOIN financial_data prev2
                ON prev2.institution_id = curr.institution_id
                AND prev2.quarter_label = ?
            WHERE curr.quarter_label = ?
              AND curr.total_assets < 100000000
              AND curr.total_assets > 1000000
              AND curr.net_worth_ratio < 0.09
              {state_filter}
            ORDER BY curr.net_worth_ratio ASC
            LIMIT ?
        """, params).fetchall()

        results = []
        for r in rows_as_dicts(rows):
            flags = []
            score = 0

            flags.append("small_assets")
            score += 1

            nwr_c = r.get("nwr_curr")
            nwr_p1 = r.get("nwr_prev1")
            if nwr_c is not None and nwr_c < 0.07:
                flags.append("nwr_critical")
                score += 2
            elif nwr_c is not None and nwr_p1 is not None and nwr_c < nwr_p1:
                flags.append("nwr_declining")
                score += 1

            mc = r.get("members_curr")
            mp1 = r.get("members_prev1")
            if mc and mp1 and mc < mp1:
                flags.append("membership_declining")
                score += 1

            eff = r.get("efficiency_ratio")
            if eff and eff > 0.85:
                flags.append("high_efficiency")
                score += 1

            delinq = r.get("delinquency_ratio")
            if delinq and delinq > 0.02:
                flags.append("high_delinquency")
                score += 1

            if score >= 2:
                r["flags"] = flags
                r["risk_score"] = score
                results.append(r)

        results.sort(key=lambda x: -x["risk_score"])
        return {"quarter": latest_q, "count": len(results), "candidates": results}


# ── /landscape ────────────────────────────────────────────────────────────

@router.get("/landscape")
def landscape():
    """State-level aggregates for competitive landscape view."""
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)
        rows = conn.execute("""
            SELECT
                i.state,
                COUNT(*)                          AS cu_count,
                ROUND(SUM(f.total_assets), 0)     AS total_assets,
                SUM(f.member_count)               AS total_members,
                AVG(f.roa)                        AS avg_roa,
                AVG(f.net_worth_ratio)            AS avg_nwr,
                AVG(f.delinquency_ratio)          AS avg_delinquency,
                AVG(f.efficiency_ratio)           AS avg_efficiency,
                AVG(f.loan_to_share_ratio)        AS avg_loan_to_share,
                SUM(CASE WHEN f.net_worth_ratio < 0.07 THEN 1 ELSE 0 END) AS below_7pct
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE f.quarter_label = ? AND f.roa IS NOT NULL
            GROUP BY i.state
            ORDER BY total_assets DESC
        """, (latest_q,)).fetchall()

        results = []
        for r in rows_as_dicts(rows):
            avg_roa = r.get("avg_roa") or 0
            avg_nwr = r.get("avg_nwr") or 0
            avg_del = r.get("avg_delinquency") or 0
            hs = 50 + (avg_roa - 0.005) * 3000 + (avg_nwr - 0.08) * 500 - (avg_del - 0.01) * 2000
            r["health_score"] = max(0, min(100, round(hs)))
            r["avg_roa"] = round(avg_roa, 6)
            r["avg_nwr"] = round(avg_nwr, 6)
            r["avg_delinquency"] = round(avg_del, 6)
            r["avg_efficiency"] = round(r.get("avg_efficiency") or 0, 4)
            r["avg_loan_to_share"] = round(r.get("avg_loan_to_share") or 0, 4)
            results.append(r)

        return {"quarter": latest_q, "states": results}


# ── /market-share-analysis ─────────────────────────────────────────────

@router.get("/market-share-analysis")
def market_share_analysis(
    state: str = Query("", description="2-letter state code (required)"),
    cu_number: str = Query("", description="Optional CU to highlight"),
    metric: str = Query("total_shares", description="total_shares | total_loans | member_count"),
):
    """
    State-level market share analysis:
      - Top 15 CUs by share of deposits/loans/members in a state
      - 8-quarter trend for each top CU
      - State totals over time
      - Concentration metrics (HHI, top-5 share)
    """
    allowed_metrics = {"total_shares", "total_loans", "member_count"}
    if metric not in allowed_metrics:
        metric = "total_shares"

    metric_labels = {
        "total_shares": "Deposits",
        "total_loans": "Loans",
        "member_count": "Members",
    }

    with get_conn() as conn:
        latest_q = _latest_quarter(conn)

        if not state:
            # Return list of states for picker
            states = conn.execute("""
                SELECT DISTINCT i.state, COUNT(*) as cu_count
                FROM institutions i
                JOIN financial_data f ON f.institution_id = i.id
                WHERE f.quarter_label = ? AND i.state IS NOT NULL AND i.state != ''
                GROUP BY i.state
                ORDER BY cu_count DESC
            """, (latest_q,)).fetchall()
            return {"states": [{"state": r["state"], "cu_count": r["cu_count"]} for r in states]}

        state = state.upper()

        # ── State totals over last 8 quarters ──
        state_totals = conn.execute("""
            SELECT
                f.quarter_label,
                SUM(f.total_shares)  AS total_deposits,
                SUM(f.total_loans)   AS total_loans,
                SUM(f.member_count)  AS total_members,
                COUNT(*)             AS cu_count
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE i.state = ?
            GROUP BY f.quarter_label
            ORDER BY f.report_date DESC
            LIMIT 8
        """, (state,)).fetchall()
        state_trend = list(reversed(rows_as_dicts(state_totals)))

        # ── Top 15 CUs by selected metric (latest quarter) ──
        top_cus = conn.execute(f"""
            SELECT
                i.cu_number,
                i.name,
                i.city,
                f.total_shares,
                f.total_loans,
                f.member_count,
                f.total_assets,
                f.roa,
                f.net_worth_ratio
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE f.quarter_label = ? AND i.state = ?
                AND f.{metric} IS NOT NULL AND f.{metric} > 0
            ORDER BY f.{metric} DESC
            LIMIT 15
        """, (latest_q, state)).fetchall()
        top_cus = rows_as_dicts(top_cus)

        # Get state total for latest quarter to compute shares
        latest_state = next((t for t in state_trend if t["quarter_label"] == latest_q), None)
        state_total_metric = 0
        if latest_state:
            metric_map = {
                "total_shares": "total_deposits",
                "total_loans": "total_loans",
                "member_count": "total_members",
            }
            state_total_metric = latest_state.get(metric_map[metric]) or 1

        # Compute shares + build rankings
        rankings = []
        top_cu_numbers = []
        for rank, cu in enumerate(top_cus, 1):
            cu_val = cu.get(metric) or 0
            share = cu_val / state_total_metric if state_total_metric else 0
            rankings.append({
                "rank": rank,
                "cu_number": cu["cu_number"],
                "name": cu["name"],
                "city": cu["city"],
                "value": cu_val,
                "share": round(share, 6),
                "total_assets": cu["total_assets"],
                "roa": cu["roa"],
                "net_worth_ratio": cu["net_worth_ratio"],
            })
            top_cu_numbers.append(cu["cu_number"])

        # ── 8-quarter trend for top CUs ──
        if top_cu_numbers:
            placeholders = ",".join("?" * len(top_cu_numbers))
            trend_rows = conn.execute(f"""
                SELECT
                    i.cu_number,
                    f.quarter_label,
                    f.{metric} AS value
                FROM financial_data f
                JOIN institutions i ON i.id = f.institution_id
                WHERE i.cu_number IN ({placeholders}) AND i.state = ?
                ORDER BY f.report_date
            """, (*top_cu_numbers, state)).fetchall()

            # Group by cu_number
            cu_trends: dict[str, list] = {}
            for r in trend_rows:
                cn = r["cu_number"]
                if cn not in cu_trends:
                    cu_trends[cn] = []
                cu_trends[cn].append({
                    "quarter": r["quarter_label"],
                    "value": r["value"],
                })

            # Compute share trends using state totals
            state_total_by_q: dict[str, float] = {}
            metric_key = {"total_shares": "total_deposits", "total_loans": "total_loans", "member_count": "total_members"}[metric]
            for st in state_trend:
                state_total_by_q[st["quarter_label"]] = st.get(metric_key) or 1

            cu_share_trends: dict[str, list] = {}
            for cn, pts in cu_trends.items():
                cu_share_trends[cn] = []
                for pt in pts:
                    st_total = state_total_by_q.get(pt["quarter"])
                    if st_total is None:
                        continue  # skip quarters without state totals
                    cu_share_trends[cn].append({
                        "quarter": pt["quarter"],
                        "value": pt["value"],
                        "share": round((pt["value"] or 0) / st_total, 6) if st_total else 0,
                    })
        else:
            cu_share_trends = {}

        # ── Concentration metrics ──
        all_vals = conn.execute(f"""
            SELECT f.{metric} AS val
            FROM financial_data f
            JOIN institutions i ON i.id = f.institution_id
            WHERE f.quarter_label = ? AND i.state = ?
                AND f.{metric} IS NOT NULL AND f.{metric} > 0
            ORDER BY f.{metric} DESC
        """, (latest_q, state)).fetchall()

        total_val = sum(r["val"] for r in all_vals) or 1
        shares = [(r["val"] / total_val) for r in all_vals]
        hhi = round(sum(s * s for s in shares) * 10000, 1)  # HHI on 10,000 scale
        top5_share = round(sum(shares[:5]), 6) if len(shares) >= 5 else round(sum(shares), 6)
        top10_share = round(sum(shares[:10]), 6) if len(shares) >= 10 else round(sum(shares), 6)

        # ── If a specific CU is requested, include its data even if not in top 15 ──
        highlight = None
        if cu_number:
            existing = next((r for r in rankings if r["cu_number"] == cu_number), None)
            if existing:
                highlight = existing
                highlight["trend"] = cu_share_trends.get(cu_number, [])
            else:
                # Fetch this CU's data
                cu_row = conn.execute(f"""
                    SELECT
                        i.cu_number, i.name, i.city,
                        f.total_shares, f.total_loans, f.member_count,
                        f.total_assets, f.roa, f.net_worth_ratio
                    FROM financial_data f
                    JOIN institutions i ON i.id = f.institution_id
                    WHERE i.cu_number = ? AND f.quarter_label = ?
                """, (cu_number, latest_q)).fetchone()
                if cu_row:
                    cu_row = dict(cu_row)
                    cu_val = cu_row.get(metric) or 0
                    # Find rank
                    cu_rank = sum(1 for r in all_vals if r["val"] > cu_val) + 1
                    highlight = {
                        "rank": cu_rank,
                        "cu_number": cu_row["cu_number"],
                        "name": cu_row["name"],
                        "city": cu_row["city"],
                        "value": cu_val,
                        "share": round(cu_val / total_val, 6),
                        "total_assets": cu_row["total_assets"],
                        "roa": cu_row["roa"],
                        "net_worth_ratio": cu_row["net_worth_ratio"],
                    }
                    # Fetch trend for this CU
                    hl_trend = conn.execute(f"""
                        SELECT f.quarter_label, f.{metric} AS value
                        FROM financial_data f
                        JOIN institutions i ON i.id = f.institution_id
                        WHERE i.cu_number = ?
                        ORDER BY f.report_date
                    """, (cu_number,)).fetchall()
                    highlight["trend"] = [{
                        "quarter": r["quarter_label"],
                        "value": r["value"],
                        "share": round((r["value"] or 0) / state_total_by_q[r["quarter_label"]], 6),
                    } for r in hl_trend if r["quarter_label"] in state_total_by_q]

        return {
            "state": state,
            "quarter": latest_q,
            "metric": metric,
            "metric_label": metric_labels[metric],
            "state_trend": state_trend,
            "rankings": rankings,
            "cu_trends": {cn: pts for cn, pts in cu_share_trends.items()},
            "concentration": {
                "hhi": hhi,
                "top5_share": top5_share,
                "top10_share": top10_share,
                "total_cus": len(all_vals),
            },
            "highlight": highlight,
        }


# ── /fred — FRED macro overlay ────────────────────────────────────────────

FRED_API_KEY = os.environ.get("FRED_API_KEY", "")

# Series relevant to credit union analysis
FRED_SERIES = {
    "FEDFUNDS":    {"label": "Fed Funds Rate",      "unit": "%",  "category": "rates"},
    "DGS10":       {"label": "10-Yr Treasury",       "unit": "%",  "category": "rates"},
    "MORTGAGE30US": {"label": "30-Yr Mortgage",      "unit": "%",  "category": "rates"},
    "UNRATE":      {"label": "Unemployment",          "unit": "%",  "category": "labor"},
    "CPIAUCSL":    {"label": "CPI (All Urban)",       "unit": "index", "category": "inflation"},
    "CPILFESL":    {"label": "Core CPI (ex Food/Energy)", "unit": "index", "category": "inflation"},
    "TOTALSL":     {"label": "Consumer Credit",       "unit": "$B", "category": "credit"},
    "DRCCLACBS":   {"label": "CC Delinquency Rate",   "unit": "%",  "category": "credit"},
    "GDP":         {"label": "Real GDP",               "unit": "$B", "category": "growth"},
    "UMCSENT":     {"label": "Consumer Sentiment",     "unit": "index", "category": "sentiment"},
}

# Simple in-memory cache: {series_id: {"data": [...], "fetched_at": timestamp}}
_fred_cache: dict[str, dict] = {}
_FRED_CACHE_TTL = 3600 * 6  # 6 hours


def _fetch_fred_series(series_id: str, limit: int = 36) -> list[dict]:
    """Fetch observations from FRED API with caching."""
    now = time.time()
    cached = _fred_cache.get(series_id)
    if cached and (now - cached["fetched_at"]) < _FRED_CACHE_TTL:
        return cached["data"][:limit]

    if not FRED_API_KEY:
        return []

    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_API_KEY}"
        f"&file_type=json&sort_order=desc&limit={limit}"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CallRptAI/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
        observations = body.get("observations", [])
        parsed = []
        for obs in observations:
            val = obs.get("value", ".")
            if val == ".":
                continue
            parsed.append({
                "date": obs["date"],
                "value": round(float(val), 4),
            })
        _fred_cache[series_id] = {"data": parsed, "fetched_at": now}
        return parsed[:limit]
    except Exception:
        return cached["data"][:limit] if cached else []


@router.get("/fred")
def fred_overview():
    """
    Return latest values + recent trend for key macro indicators.
    Groups by category (rates, labor, inflation, credit, growth, sentiment).
    """
    if not FRED_API_KEY:
        return {
            "error": "FRED_API_KEY not configured",
            "configured": False,
            "series": {},
            "categories": {},
        }

    series_data = {}
    categories: dict[str, list] = {}

    for sid, meta in FRED_SERIES.items():
        obs = _fetch_fred_series(sid, limit=36)
        current = obs[0] if obs else None
        prev = obs[1] if len(obs) > 1 else None

        change = None
        if current and prev:
            change = round(current["value"] - prev["value"], 4)

        entry = {
            "series_id": sid,
            "label": meta["label"],
            "unit": meta["unit"],
            "category": meta["category"],
            "current": current,
            "change": change,
            "trend": list(reversed(obs[:12])),  # last 12 observations, chronological
        }
        series_data[sid] = entry

        cat = meta["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(entry)

    return {
        "configured": True,
        "series": series_data,
        "categories": categories,
    }


@router.get("/fred/{series_id}")
def fred_series_detail(series_id: str, limit: int = Query(36, ge=1, le=120)):
    """Return detailed observations for a single FRED series."""
    sid = series_id.upper()
    if sid not in FRED_SERIES:
        raise HTTPException(404, f"Unknown series: {series_id}")

    if not FRED_API_KEY:
        return {"error": "FRED_API_KEY not configured", "configured": False}

    obs = _fetch_fred_series(sid, limit=limit)
    meta = FRED_SERIES[sid]

    return {
        "configured": True,
        "series_id": sid,
        "label": meta["label"],
        "unit": meta["unit"],
        "category": meta["category"],
        "observations": list(reversed(obs)),  # chronological order
    }


# ── /anomalies ────────────────────────────────────────────────────────────

@router.get("/anomalies")
def anomalies(limit: int = Query(50, ge=1, le=500)):
    """Flag CUs with metrics that moved >2 std dev from their own 8-quarter trend."""
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)

        # For each CU, compute mean/stddev over their last 8 quarters,
        # then flag where the latest value deviates > 2 stddev.
        rows = conn.execute("""
            WITH ranked AS (
                SELECT
                    f.institution_id,
                    f.quarter_label,
                    f.roa,
                    f.net_worth_ratio,
                    f.delinquency_ratio,
                    ROW_NUMBER() OVER (
                        PARTITION BY f.institution_id
                        ORDER BY f.report_date DESC
                    ) AS rn
                FROM financial_data f
                WHERE f.roa IS NOT NULL
            ),
            stats AS (
                SELECT
                    institution_id,
                    AVG(roa) AS mean_roa,
                    AVG(
                        (roa - (SELECT AVG(r2.roa) FROM ranked r2
                                WHERE r2.institution_id = ranked.institution_id AND r2.rn <= 8))
                        * (roa - (SELECT AVG(r2.roa) FROM ranked r2
                                  WHERE r2.institution_id = ranked.institution_id AND r2.rn <= 8))
                    ) AS var_roa,
                    AVG(net_worth_ratio) AS mean_nwr,
                    AVG(
                        (net_worth_ratio - (SELECT AVG(r2.net_worth_ratio) FROM ranked r2
                                            WHERE r2.institution_id = ranked.institution_id AND r2.rn <= 8))
                        * (net_worth_ratio - (SELECT AVG(r2.net_worth_ratio) FROM ranked r2
                                              WHERE r2.institution_id = ranked.institution_id AND r2.rn <= 8))
                    ) AS var_nwr,
                    AVG(delinquency_ratio) AS mean_delinq,
                    AVG(
                        (delinquency_ratio - (SELECT AVG(r2.delinquency_ratio) FROM ranked r2
                                              WHERE r2.institution_id = ranked.institution_id AND r2.rn <= 8))
                        * (delinquency_ratio - (SELECT AVG(r2.delinquency_ratio) FROM ranked r2
                                                WHERE r2.institution_id = ranked.institution_id AND r2.rn <= 8))
                    ) AS var_delinq
                FROM ranked
                WHERE rn <= 8
                GROUP BY institution_id
                HAVING COUNT(*) >= 4
            ),
            latest AS (
                SELECT institution_id, roa, net_worth_ratio, delinquency_ratio
                FROM ranked
                WHERE rn = 1
            )
            SELECT
                i.cu_number,
                i.name,
                i.state,
                l.roa AS latest_roa,
                s.mean_roa,
                s.var_roa,
                l.net_worth_ratio AS latest_nwr,
                s.mean_nwr,
                s.var_nwr,
                l.delinquency_ratio AS latest_delinq,
                s.mean_delinq,
                s.var_delinq
            FROM stats s
            JOIN latest l ON l.institution_id = s.institution_id
            JOIN institutions i ON i.id = s.institution_id
        """).fetchall()

        import math as _math

        results = []
        for row in rows:
            r = dict(row)
            checks = [
                ("ROA", r["latest_roa"], r["mean_roa"], r["var_roa"]),
                ("Net Worth Ratio", r["latest_nwr"], r["mean_nwr"], r["var_nwr"]),
                ("Delinquency", r["latest_delinq"], r["mean_delinq"], r["var_delinq"]),
            ]
            for metric_name, current, mean, variance in checks:
                if current is None or mean is None or variance is None:
                    continue
                stddev = _math.sqrt(variance) if variance > 0 else 0
                if stddev < 1e-8:
                    continue
                z_score = (current - mean) / stddev
                if abs(z_score) > 2.0:
                    direction = "spike" if z_score > 0 else "drop"
                    results.append({
                        "cu_number": r["cu_number"],
                        "name": r["name"],
                        "state": r["state"],
                        "metric_name": metric_name,
                        "current_value": round(current, 6),
                        "mean": round(mean, 6),
                        "stddev": round(stddev, 6),
                        "z_score": round(z_score, 2),
                        "direction": direction,
                    })

        # Sort by absolute z-score descending
        results.sort(key=lambda x: abs(x["z_score"]), reverse=True)
        results = results[:limit]

        # Summary counts
        roa_count = sum(1 for r in results if r["metric_name"] == "ROA")
        nwr_count = sum(1 for r in results if r["metric_name"] == "Net Worth Ratio")
        delinq_count = sum(1 for r in results if r["metric_name"] == "Delinquency")

        return {
            "quarter": latest_q,
            "total": len(results),
            "roa_anomalies": roa_count,
            "nwr_anomalies": nwr_count,
            "delinquency_anomalies": delinq_count,
            "anomalies": results,
        }


# ── /regulatory-alerts ────────────────────────────────────────────────────

@router.get("/regulatory-alerts")
def regulatory_alerts():
    """Flag CUs approaching NCUA thresholds with projected crossing quarter."""
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)

        # Get latest 4 quarters of NWR and delinquency for each CU
        rows = conn.execute("""
            WITH ranked AS (
                SELECT
                    f.institution_id,
                    f.quarter_label,
                    f.report_date,
                    f.net_worth_ratio,
                    f.delinquency_ratio,
                    ROW_NUMBER() OVER (
                        PARTITION BY f.institution_id
                        ORDER BY f.report_date DESC
                    ) AS rn
                FROM financial_data f
                WHERE f.net_worth_ratio IS NOT NULL
            )
            SELECT
                i.cu_number,
                i.name,
                i.state,
                r1.net_worth_ratio AS nwr_q1,
                r2.net_worth_ratio AS nwr_q2,
                r3.net_worth_ratio AS nwr_q3,
                r4.net_worth_ratio AS nwr_q4,
                r1.delinquency_ratio AS delinq_q1,
                r2.delinquency_ratio AS delinq_q2,
                r3.delinquency_ratio AS delinq_q3,
                r4.delinquency_ratio AS delinq_q4
            FROM ranked r1
            JOIN ranked r2 ON r2.institution_id = r1.institution_id AND r2.rn = 2
            JOIN ranked r3 ON r3.institution_id = r1.institution_id AND r3.rn = 3
            JOIN ranked r4 ON r4.institution_id = r1.institution_id AND r4.rn = 4
            JOIN institutions i ON i.id = r1.institution_id
            WHERE r1.rn = 1
        """).fetchall()

        def _linear_slope(vals):
            """Compute slope of linear fit over equally-spaced points (quarters)."""
            n = len(vals)
            if n < 2:
                return 0
            x_mean = (n - 1) / 2.0
            y_mean = sum(vals) / n
            num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(vals))
            den = sum((i - x_mean) ** 2 for i in range(n))
            return num / den if den != 0 else 0

        def _project_crossing(current, slope, threshold):
            """How many quarters until current + slope*q crosses threshold."""
            if slope == 0:
                return None
            quarters = (threshold - current) / slope
            if quarters <= 0:
                return None
            return quarters

        def _future_quarter(label, q_ahead):
            """Compute the quarter label q_ahead quarters in the future."""
            year, q = label.split("-Q")
            year, q = int(year), int(q)
            total_q = (year * 4 + q) + int(q_ahead)
            new_year = (total_q - 1) // 4
            new_q = ((total_q - 1) % 4) + 1
            return f"{new_year}-Q{new_q}"

        alerts = []
        for row in rows:
            r = dict(row)

            # NWR alert: declining and currently between 7-10%
            nwr_vals = [r["nwr_q4"], r["nwr_q3"], r["nwr_q2"], r["nwr_q1"]]
            if all(v is not None for v in nwr_vals):
                nwr_current = r["nwr_q1"]
                nwr_slope = _linear_slope(nwr_vals)
                if nwr_slope < 0 and 0.07 <= nwr_current <= 0.10:
                    quarters_until = _project_crossing(nwr_current, nwr_slope, 0.07)
                    if quarters_until is not None and quarters_until <= 12:
                        alerts.append({
                            "cu_number": r["cu_number"],
                            "name": r["name"],
                            "state": r["state"],
                            "alert_type": "nwr_approaching",
                            "current_value": round(nwr_current, 6),
                            "trend_slope": round(nwr_slope, 6),
                            "quarters_until_crossing": round(quarters_until, 1),
                            "projected_crossing_quarter": _future_quarter(
                                latest_q, quarters_until
                            ),
                        })

            # Delinquency alert: trending above 2%
            delinq_vals = [r["delinq_q4"], r["delinq_q3"], r["delinq_q2"], r["delinq_q1"]]
            if all(v is not None for v in delinq_vals):
                delinq_current = r["delinq_q1"]
                delinq_slope = _linear_slope(delinq_vals)
                if delinq_slope > 0 and 0.01 <= delinq_current <= 0.02:
                    quarters_until = _project_crossing(
                        delinq_current, delinq_slope, 0.02
                    )
                    if quarters_until is not None and quarters_until <= 12:
                        alerts.append({
                            "cu_number": r["cu_number"],
                            "name": r["name"],
                            "state": r["state"],
                            "alert_type": "delinquency_rising",
                            "current_value": round(delinq_current, 6),
                            "trend_slope": round(delinq_slope, 6),
                            "quarters_until_crossing": round(quarters_until, 1),
                            "projected_crossing_quarter": _future_quarter(
                                latest_q, quarters_until
                            ),
                        })

        # Sort by quarters_until_crossing ascending (most urgent first)
        alerts.sort(key=lambda x: x["quarters_until_crossing"])

        nwr_alerts = sum(1 for a in alerts if a["alert_type"] == "nwr_approaching")
        delinq_alerts = sum(1 for a in alerts if a["alert_type"] == "delinquency_rising")
        critical = sum(1 for a in alerts if a["quarters_until_crossing"] < 2)

        return {
            "quarter": latest_q,
            "total": len(alerts),
            "nwr_alerts": nwr_alerts,
            "delinquency_alerts": delinq_alerts,
            "critical": critical,
            "alerts": alerts,
        }


# ── /cohort-analysis ──────────────────────────────────────────────────────

@router.get("/cohort-analysis")
def cohort_analysis(
    group_by: str = Query("asset_band", description="asset_band|state|charter_type|decade_opened"),
):
    """
    Aggregate CU metrics grouped by asset band, state, charter type, or decade opened.
    Returns count, avg ROA, avg NWR, avg delinquency, avg efficiency, total assets, total members
    for each cohort.
    """
    with get_conn() as conn:
        latest_q = _latest_quarter(conn)

        if group_by == "asset_band":
            rows = conn.execute("""
                SELECT
                    CASE
                        WHEN f.total_assets < 50000000   THEN 'Under $50M'
                        WHEN f.total_assets < 250000000  THEN '$50M-$250M'
                        WHEN f.total_assets < 1000000000 THEN '$250M-$1B'
                        WHEN f.total_assets < 10000000000 THEN '$1B-$10B'
                        ELSE 'Over $10B'
                    END AS grp,
                    COUNT(*)                          AS cnt,
                    AVG(f.roa)                        AS avg_roa,
                    AVG(f.net_worth_ratio)            AS avg_nwr,
                    AVG(f.delinquency_ratio)          AS avg_delinquency,
                    AVG(f.efficiency_ratio)           AS avg_efficiency,
                    SUM(f.total_assets)               AS total_assets,
                    SUM(f.member_count)               AS total_members
                FROM financial_data f
                JOIN institutions i ON i.id = f.institution_id
                WHERE f.quarter_label = ? AND f.roa IS NOT NULL
                GROUP BY grp
                ORDER BY MIN(f.total_assets)
            """, (latest_q,)).fetchall()

        elif group_by == "state":
            rows = conn.execute("""
                SELECT
                    i.state AS grp,
                    COUNT(*)                          AS cnt,
                    AVG(f.roa)                        AS avg_roa,
                    AVG(f.net_worth_ratio)            AS avg_nwr,
                    AVG(f.delinquency_ratio)          AS avg_delinquency,
                    AVG(f.efficiency_ratio)           AS avg_efficiency,
                    SUM(f.total_assets)               AS total_assets,
                    SUM(f.member_count)               AS total_members
                FROM financial_data f
                JOIN institutions i ON i.id = f.institution_id
                WHERE f.quarter_label = ? AND f.roa IS NOT NULL
                GROUP BY i.state
                ORDER BY i.state
            """, (latest_q,)).fetchall()

        elif group_by == "charter_type":
            rows = conn.execute("""
                SELECT
                    CASE
                        WHEN i.charter_type LIKE '%Federal%' THEN 'Federal'
                        ELSE 'State-chartered'
                    END AS grp,
                    COUNT(*)                          AS cnt,
                    AVG(f.roa)                        AS avg_roa,
                    AVG(f.net_worth_ratio)            AS avg_nwr,
                    AVG(f.delinquency_ratio)          AS avg_delinquency,
                    AVG(f.efficiency_ratio)           AS avg_efficiency,
                    SUM(f.total_assets)               AS total_assets,
                    SUM(f.member_count)               AS total_members
                FROM financial_data f
                JOIN institutions i ON i.id = f.institution_id
                WHERE f.quarter_label = ? AND f.roa IS NOT NULL
                GROUP BY grp
                ORDER BY grp
            """, (latest_q,)).fetchall()

        elif group_by == "decade_opened":
            rows = conn.execute("""
                SELECT
                    (CAST(i.year_opened / 10 AS INT) * 10) || 's' AS grp,
                    COUNT(*)                          AS cnt,
                    AVG(f.roa)                        AS avg_roa,
                    AVG(f.net_worth_ratio)            AS avg_nwr,
                    AVG(f.delinquency_ratio)          AS avg_delinquency,
                    AVG(f.efficiency_ratio)           AS avg_efficiency,
                    SUM(f.total_assets)               AS total_assets,
                    SUM(f.member_count)               AS total_members
                FROM financial_data f
                JOIN institutions i ON i.id = f.institution_id
                WHERE f.quarter_label = ? AND f.roa IS NOT NULL
                  AND i.year_opened IS NOT NULL AND i.year_opened > 1900
                GROUP BY grp
                ORDER BY grp DESC
            """, (latest_q,)).fetchall()

        else:
            raise HTTPException(400, f"Invalid group_by: {group_by}. Use asset_band|state|charter_type|decade_opened")

        cohorts = []
        for r in rows_as_dicts(rows):
            cohorts.append({
                "group":           r["grp"],
                "count":           r["cnt"],
                "avg_roa":         round(r["avg_roa"], 6) if r["avg_roa"] is not None else None,
                "avg_nwr":         round(r["avg_nwr"], 6) if r["avg_nwr"] is not None else None,
                "avg_delinquency": round(r["avg_delinquency"], 6) if r["avg_delinquency"] is not None else None,
                "avg_efficiency":  round(r["avg_efficiency"], 4) if r["avg_efficiency"] is not None else None,
                "total_assets":    r["total_assets"],
                "total_members":   r["total_members"],
            })

        return {
            "quarter": latest_q,
            "group_by": group_by,
            "cohorts": cohorts,
        }


# ── /seasonal-patterns ────────────────────────────────────────────────────

@router.get("/seasonal-patterns")
def seasonal_patterns():
    """
    Group all financial_data by quarter number (Q1, Q2, Q3, Q4) across all years.
    Compute median ROA, NWR, delinquency, loan_to_share for each quarter.
    """
    with get_conn() as conn:
        # Get all distinct quarter labels to count years
        all_quarters = conn.execute("""
            SELECT DISTINCT quarter_label FROM financial_data ORDER BY quarter_label
        """).fetchall()
        quarter_labels = [r["quarter_label"] for r in all_quarters]
        years = set()
        for ql in quarter_labels:
            try:
                years.add(int(ql.split("-Q")[0]))
            except (ValueError, IndexError):
                pass
        years_covered = len(years)

        # For each Q1-Q4, gather all rows across all years and compute medians
        def median(vals):
            s = sorted(v for v in vals if v is not None)
            if not s:
                return None
            mid = len(s) // 2
            return round(s[mid], 6) if len(s) % 2 else round((s[mid - 1] + s[mid]) / 2, 6)

        results = []
        for qn in [1, 2, 3, 4]:
            pattern = f"%-Q{qn}"
            rows = conn.execute("""
                SELECT roa, net_worth_ratio, delinquency_ratio, loan_to_share_ratio
                FROM financial_data
                WHERE quarter_label LIKE ? AND roa IS NOT NULL
            """, (pattern,)).fetchall()
            data_list = rows_as_dicts(rows)

            results.append({
                "quarter": f"Q{qn}",
                "data_points": len(data_list),
                "median_roa": median([r["roa"] for r in data_list]),
                "median_nwr": median([r["net_worth_ratio"] for r in data_list]),
                "median_delinquency": median([r["delinquency_ratio"] for r in data_list]),
                "median_loan_to_share": median([r["loan_to_share_ratio"] for r in data_list]),
            })

        return {
            "years_covered": years_covered,
            "quarters": results,
        }
