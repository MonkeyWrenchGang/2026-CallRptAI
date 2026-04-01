"""
NCUA Query Engine — translates natural language into SQL via Claude,
executes queries against the real NCUA 5300 call report database,
and returns structured results.

This module mirrors query_engine.py but is purpose-built for the NCUA
5300 database with credit-union-specific terminology and thresholds.

Pipeline:
  1. Receives a user question + optional CU context (cu_number)
  2. Asks Claude to generate SQL against the NCUA schema
  3. Executes the SQL safely (read-only) against ncua_callreports.db
  4. Asks Claude to interpret the results for a CU executive audience
"""

import json
import os
import re
import sqlite3
from typing import Optional

# ── Database path ────────────────────────────────────────────────────────
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
NCUA_DB_PATH = os.path.join(_THIS_DIR, "data", "ncua_callreports.db")

# ── Schema context for Claude ────────────────────────────────────────────
NCUA_SCHEMA_CONTEXT = """
You have access to a SQLite database containing NCUA 5300 Call Report data for
U.S. credit unions (5,404 CUs, 24 quarters from 2020-Q1 through 2025-Q4,
116,486 rows of financial data).

## Tables

### institutions
- id (INTEGER PK) — internal row ID
- cu_number (TEXT UNIQUE) — NCUA charter number (the official CU identifier)
- name (TEXT) — credit union name
- city (TEXT)
- state (TEXT) — 2-letter abbreviation
- charter_type (TEXT) — "Federal Credit Union" or "State-chartered Credit Union"
- charter_state (TEXT) — state of charter for state-chartered CUs
- institution_type (TEXT) — always 'credit_union'
- active (INTEGER) — 1 = active
- total_assets_latest (REAL) — most recent total assets in ACTUAL dollars
- region (TEXT) — NCUA regional office
- year_opened (INTEGER)

### financial_data
- id (INTEGER PK)
- institution_id (INTEGER FK → institutions.id)
- report_date (TEXT) — ISO date, quarter-end: e.g. "2025-12-31", "2025-09-30"
- quarter_label (TEXT) — e.g. "2025-Q4", "2025-Q3"

**Balance Sheet** (all values in ACTUAL dollars, NOT thousands):
- total_assets (REAL)
- total_loans (REAL)
- total_shares (REAL) — the credit union equivalent of deposits; members' share accounts
- total_equity (REAL) — net worth / retained earnings
- cash (REAL)
- first_mortgage_re (REAL) — First mortgage real estate loans/LOCs
- other_re_loans (REAL) — Other real estate loans/LOCs
- member_business_loans (REAL) — Net member business loan balance
- land_building (REAL) — Land and building assets
- other_fixed_assets (REAL) — Other fixed assets
- other_assets (REAL) — Other assets
- borrowings_total (REAL) — Total borrowings/repurchase transactions
- notes_payable (REAL) — Notes, promissory notes and interest payable
- regular_shares (REAL) — Regular share accounts
- other_shares (REAL) — All other share accounts
- allowance_ll (REAL) — Allowance for loan and lease losses
- leases_receivable (REAL) — Leases receivable
- subordinated_debt_in_nw (REAL) — Subordinated debt included in net worth
- loans_in_liquidation (REAL) — Loans in process of liquidation
- foreclosed_assets (REAL) — Foreclosed and repossessed assets

**Membership**:
- member_count (INTEGER) — number of members (credit unions have members, not customers)

**Income Statement** (YTD figures in ACTUAL dollars):
- interest_income (REAL) — year-to-date interest income
- interest_expense (REAL) — year-to-date interest expense (cost of shares/borrowings)
- net_interest_income (REAL) — YTD net interest income
- noninterest_expense (REAL) — YTD operating expenses (overhead)
- net_income (REAL) — YTD net income (annualised in this dataset)
- interest_on_loans (REAL) — Interest on loans (gross, annualized)
- investment_income (REAL) — Income from investments (annualized)
- fee_income (REAL) — Fee income (annualized)
- dividends_on_shares (REAL) — Dividends paid on shares
- gross_income (REAL) — Total gross income
- provision_ll (REAL) — Provision for loan and lease losses
- chargeoffs_ytd (REAL) — Total loans charged off year-to-date
- recoveries_ytd (REAL) — Total recoveries on charged-off loans year-to-date
- net_chargeoffs_ytd (REAL) — Net charge-offs (chargeoffs minus recoveries)

**Key Ratios** (all stored as DECIMALS — multiply by 100 to display as %):
- roa (REAL) — Return on Assets; e.g. 0.0097 = 0.97%
- net_interest_margin (REAL) — Net Interest Margin (NIM); e.g. 0.0312 = 3.12%
- net_worth_ratio (REAL) — Net Worth Ratio (NWR); the CU capital adequacy metric
  * ≥ 0.10 (10%) = Well Capitalized
  * 0.07–0.10 (7–10%) = Adequately Capitalized
  * < 0.07 (7%) = Undercapitalized
- loan_to_share_ratio (REAL) — Loan-to-Share ratio (CU equivalent of loan-to-deposit);
  e.g. 0.75 = 75%
- delinquency_ratio (REAL) — Delinquency rate (CU equivalent of NPL ratio);
  < 1% (0.01) = healthy, 1–2% = watch, > 2% = concern
- efficiency_ratio (REAL) — Operating efficiency; < 0.70 (70%) is good, > 0.80 (80%) is concern
- camel_class (TEXT) — NCUA CAMEL classification string, e.g. "Well Capitalized",
  "Adequately Capitalized", "Undercapitalized"

## Important Notes
- Dollar amounts are in ACTUAL dollars (not thousands). Convert to millions (÷1,000,000)
  or billions (÷1,000,000,000) when presenting to executives.
- Ratios are stored as decimals; multiply by 100 for percentages.
- report_date is TEXT in 'YYYY-MM-DD' format. The most recent data is 2025-12-31.
- quarter_label format is 'YYYY-QN', e.g. '2025-Q4'.
- Credit unions use "shares" not "deposits", "members" not "customers",
  "net worth ratio" not "Tier 1 capital ratio", "delinquency rate" not "NPL ratio",
  "loan-to-share ratio" not "loan-to-deposit ratio".
- YTD income figures accumulate through the year; Q4 figures represent the full year.
- To join tables: financial_data.institution_id = institutions.id
"""

# ── System prompts ────────────────────────────────────────────────────────
NCUA_SYSTEM_PROMPT_SQL = """You are an expert NCUA 5300 Call Report data analyst. You translate natural language questions into SQLite-compatible SELECT queries against the NCUA credit union database.

Rules:
1. ONLY generate SELECT statements. Never INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, or EXEC.
2. Always LIMIT results to 50 rows max unless the user explicitly asks for more.
3. Dollar values are stored in ACTUAL dollars (not thousands). When computing ratios or aggregates involving dollars, be mindful of scale.
4. Ratios (roa, net_worth_ratio, loan_to_share_ratio, delinquency_ratio, net_interest_margin, efficiency_ratio) are stored as decimals.
5. When comparing credit unions, always include the institution name.
6. For trend questions, ORDER BY report_date ASC.
7. For peer comparisons, JOIN financial_data with institutions and filter on appropriate asset-size bands.
8. Use credit union terminology: "shares" not "deposits", "members" not "customers", "NWR" for net_worth_ratio, "delinquency_ratio" not "NPL".
9. When the user says "well capitalized", they mean net_worth_ratio >= 0.10.
10. Use parameterized placeholders (?) only when constructing dynamic queries in Python — for the SQL text itself, inline constant values are fine.
11. Return ONLY the SQL query, no explanation. Wrap it in ```sql``` code fences.
12. If the question cannot be answered from this schema, return: CANNOT_ANSWER: <reason>
13. Reference NCUA 5300 report schedule concepts naturally (e.g., Schedule A for balance sheet items, Schedule B for income).
"""

NCUA_SYSTEM_PROMPT_INTERPRET = """You are an expert NCUA 5300 Call Report analyst presenting insights to a credit union CEO or CFO.

Style guidelines:
- Use credit union terminology throughout: "members" not "customers", "shares" not "deposits", "net worth ratio (NWR)" not "Tier 1 capital ratio", "delinquency rate" not "NPL ratio", "loan-to-share ratio" not "loan-to-deposit ratio".
- Be concise but insightful — credit union executives want the "so what", not raw numbers.
- Lead with the key finding, then supporting detail.
- Express dollar amounts in millions (M) or billions (B); raw data is in actual dollars.
- Express ratios as percentages with 2 decimal places (e.g., "NWR of 11.36%").
- Flag anything that looks like a risk or opportunity.
- Reference NCUA regulatory thresholds where appropriate:
  * NWR: ≥10% = Well Capitalized, 7–10% = Adequately Capitalized, <7% = Undercapitalized
  * ROA: credit union peer average is typically 0.70–1.00%
  * NIM: typically 2.50–3.50% for credit unions
  * Efficiency ratio: <70% is good, 70–80% is adequate, >80% needs attention
  * Delinquency rate: <1.0% is healthy, 1–2% is watch, >2% is concern
  * Loan-to-share ratio: 70–85% is typical for credit unions
- Use bullet points sparingly; prefer flowing analytical narrative.
- If you spot a trend (improving or deteriorating), call it out explicitly.
- Reference NCUA 5300 report schedules when relevant (e.g., Schedule B for income, Schedule F for delinquency).
- End with a brief strategic implication or question to consider.
"""


# ── SQL execution ─────────────────────────────────────────────────────────
def execute_ncua_sql(sql: str) -> dict:
    """
    Safely execute a read-only SQL query against the NCUA call reports DB.

    Returns:
        {"columns": [...], "rows": [...], "row_count": N}  on success
        {"error": "...", "columns": [], "rows": []}        on failure
    """
    # Reject any mutating keywords
    sql_upper = sql.upper().strip()
    dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "EXEC", "ATTACH", "PRAGMA"]
    for keyword in dangerous:
        if re.search(rf'\b{keyword}\b', sql_upper):
            return {
                "error": f"Query rejected: {keyword} operations are not allowed.",
                "rows": [],
                "columns": [],
            }

    try:
        conn = sqlite3.connect(NCUA_DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        result_rows = [dict(row) for row in rows]
        conn.close()
        return {"columns": columns, "rows": result_rows, "row_count": len(result_rows), "error": None}
    except sqlite3.OperationalError as e:
        return {"error": f"SQL error: {e}", "rows": [], "columns": []}
    except Exception as e:
        return {"error": str(e), "rows": [], "columns": []}


# ── Institution context helpers ───────────────────────────────────────────
def get_ncua_institution_context(cu_number: Optional[str] = None) -> str:
    """
    Return a formatted string describing a CU's latest KPIs for use in
    Claude's context window.

    Uses the cu_number (NCUA charter number) as the lookup key.
    """
    if not cu_number:
        return (
            "No specific credit union selected. "
            "Answer about the full NCUA dataset or ask which CU the user means."
        )

    try:
        conn = sqlite3.connect(NCUA_DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Look up by cu_number (parameterized — user input)
        cursor.execute(
            "SELECT * FROM institutions WHERE cu_number = ?",
            (str(cu_number),),
        )
        inst = cursor.fetchone()
        if not inst:
            conn.close()
            return f"Credit union with charter number {cu_number} not found in the database."

        inst_id = inst["id"]

        # Get the most recent quarter's financials
        cursor.execute(
            """
            SELECT * FROM financial_data
            WHERE institution_id = ?
            ORDER BY report_date DESC
            LIMIT 1
            """,
            (inst_id,),
        )
        latest = cursor.fetchone()

        # Get the prior quarter for simple trend comparison
        cursor.execute(
            """
            SELECT total_assets, total_shares, total_loans, member_count,
                   roa, net_worth_ratio, delinquency_ratio, loan_to_share_ratio
            FROM financial_data
            WHERE institution_id = ?
            ORDER BY report_date DESC
            LIMIT 2
            """,
            (inst_id,),
        )
        recent_two = cursor.fetchall()
        conn.close()

        if not latest:
            return (
                f"Credit union: {inst['name']} (Charter #{cu_number}). "
                "No financial data available in the database."
            )

        # Format key metrics
        assets_m = (latest["total_assets"] or 0) / 1_000_000
        shares_m = (latest["total_shares"] or 0) / 1_000_000
        loans_m  = (latest["total_loans"]  or 0) / 1_000_000
        equity_m = (latest["total_equity"] or 0) / 1_000_000

        roa_pct  = (latest["roa"]              or 0) * 100
        nwr_pct  = (latest["net_worth_ratio"]   or 0) * 100
        delq_pct = (latest["delinquency_ratio"] or 0) * 100
        lts_pct  = (latest["loan_to_share_ratio"] or 0) * 100
        nim_pct  = (latest["net_interest_margin"] or 0) * 100
        eff_pct  = (latest["efficiency_ratio"]   or 0) * 100

        # Capitalisation classification
        if nwr_pct >= 10.0:
            cap_status = "Well Capitalized"
        elif nwr_pct >= 7.0:
            cap_status = "Adequately Capitalized"
        else:
            cap_status = "Undercapitalized"

        # Asset-size tier
        if assets_m >= 1_000:
            size_tier = f"${assets_m/1000:.2f}B"
        else:
            size_tier = f"${assets_m:,.1f}M"

        # Peer group lookup (graceful degradation if table doesn't exist)
        peer_group_line = ""
        try:
            pg_row = cursor.execute(
                """
                SELECT cluster_id, cluster_label, cluster_size
                FROM peer_groups
                WHERE cu_number = ?
                """,
                (str(cu_number),),
            ).fetchone()
            if pg_row:
                peer_group_line = (
                    f"\n- Peer Group: {pg_row['cluster_label']} "
                    f"(cluster {pg_row['cluster_id']} of 8, "
                    f"{pg_row['cluster_size']} institutions)"
                )
        except Exception:
            pass  # peer_groups table may not exist yet

        ctx = f"""Currently selected credit union:
- Name: {inst['name']}
- NCUA Charter #: {cu_number}
- Location: {inst['city']}, {inst['state']}
- Charter Type: {inst['charter_type'] or 'N/A'}
- Region: {inst['region'] or 'N/A'}
- Total Assets: {size_tier} (as of {latest['report_date']}, quarter {latest['quarter_label'] or ''})
- Institution ID in database: {inst_id}{peer_group_line}

Latest Key Performance Indicators ({latest['report_date']}):
- Total Shares (deposits equiv.): ${shares_m:,.1f}M
- Total Loans: ${loans_m:,.1f}M
- Net Worth (equity): ${equity_m:,.1f}M
- Member Count: {(latest['member_count'] or 0):,}
- Return on Assets (ROA): {roa_pct:.2f}%
- Net Worth Ratio (NWR): {nwr_pct:.2f}% → {cap_status}
- Net Interest Margin (NIM): {nim_pct:.2f}%
- Loan-to-Share Ratio: {lts_pct:.1f}%
- Delinquency Rate: {delq_pct:.2f}%
- Efficiency Ratio: {eff_pct:.1f}%
- CAMEL Classification: {latest['camel_class'] or 'N/A'}

When the user says "my credit union", "our CU", "we", "us", "our institution", etc.,
they are referring to {inst['name']} (Charter #{cu_number}).
Reference this institution using institution_id = {inst_id} in SQL queries.
"""
        return ctx

    except Exception as e:
        return f"Error retrieving institution context: {e}"


def list_ncua_institutions(
    search: str = "",
    state: str = "",
    limit: int = 50,
) -> list:
    """
    Search and list NCUA credit unions.

    Args:
        search: partial name match (case-insensitive)
        state:  2-letter state code filter
        limit:  max results (capped at 200)

    Returns:
        List of dicts with institution info.
    """
    limit = min(int(limit), 200)

    try:
        conn = sqlite3.connect(NCUA_DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        query = (
            "SELECT id, cu_number, name, city, state, charter_type, "
            "total_assets_latest, region, year_opened "
            "FROM institutions WHERE active = 1"
        )
        params: list = []

        if search:
            query += " AND name LIKE ?"
            params.append(f"%{search}%")
        if state:
            query += " AND state = ?"
            params.append(state.upper().strip())

        query += " ORDER BY total_assets_latest DESC NULLS LAST LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

    except Exception as e:
        return [{"error": str(e)}]


# ── Self-test (runs only when executed directly) ──────────────────────────
if __name__ == "__main__":
    print("ncua_query_engine.py loaded successfully.")
    print(f"NCUA_DB_PATH = {NCUA_DB_PATH}")

    # Smoke-test the SQL executor
    result = execute_ncua_sql(
        "SELECT COUNT(*) AS total_cus FROM institutions WHERE active = 1"
    )
    print(f"Active CUs in DB: {result}")

    # Smoke-test institution listing
    sample = list_ncua_institutions(limit=3)
    print(f"Sample institutions (top 3 by assets): {[r.get('name') for r in sample]}")

    # Smoke-test context for first CU found
    if sample and not sample[0].get("error"):
        ctx = get_ncua_institution_context(sample[0]["cu_number"])
        print(f"\nContext snippet:\n{ctx[:400]}...")
