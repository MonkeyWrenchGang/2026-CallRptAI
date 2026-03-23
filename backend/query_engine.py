"""
Query engine — translates natural language into SQL via Claude,
executes queries, and returns structured results.

This is the brain of the chatbot. It:
  1. Receives a user question + optional institution context
  2. Asks Claude to generate SQL against our schema
  3. Executes the SQL safely (read-only)
  4. Asks Claude to interpret the results for an executive audience
"""

import json
import sqlite3
import os
import re
from typing import Optional

DATABASE_PATH = os.getenv("DATABASE_PATH", "./data/callreports.db")

# ── Schema description for Claude ───────────────────────────────────────
SCHEMA_CONTEXT = """
You have access to a SQLite database containing FFIEC (bank) and NCUA (credit union) call report data.

## Tables

### institutions
- id (INTEGER PK)
- cert_or_cu_number (TEXT) — FDIC certificate number or NCUA charter number
- institution_type (TEXT) — 'bank' or 'credit_union'
- name (TEXT)
- city (TEXT)
- state (TEXT) — 2-letter code
- total_assets_latest (REAL) — most recent total assets in thousands of dollars
- charter_type (TEXT) — e.g. 'National', 'State Member', 'Federal'
- active (INTEGER) — 1 = active

### financial_data
- id (INTEGER PK)
- institution_id (INTEGER FK → institutions.id)
- report_date (TEXT) — quarterly: '2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31', '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'

**Balance Sheet** (all in thousands of $):
- total_assets, total_loans, total_deposits, total_equity, total_liabilities
- cash_and_equivalents, securities

**Loan Composition** (thousands):
- residential_re_loans, commercial_re_loans, commercial_industrial_loans, consumer_loans, agriculture_loans

**Asset Quality** (thousands):
- nonperforming_loans, loan_loss_allowance, net_charge_offs, past_due_30_89, past_due_90_plus

**Income Statement** (YTD, thousands):
- total_interest_income, total_interest_expense, net_interest_income
- provision_for_loan_losses, noninterest_income, noninterest_expense, net_income

**Key Ratios** (decimals, e.g. 0.0125 = 1.25%):
- roa, roe, net_interest_margin, efficiency_ratio
- tier1_capital_ratio, total_capital_ratio, leverage_ratio
- npl_ratio, loan_to_deposit_ratio

**Credit Union Only**:
- member_count (INTEGER), net_worth_ratio (REAL), delinquency_ratio (REAL)

### peer_groups
- id, name, description, institution_type, asset_min, asset_max, state

## Important Notes
- All dollar amounts are in THOUSANDS. Display as millions or billions for executives.
- Ratios are decimals (multiply by 100 for percentages).
- report_date is a TEXT field in 'YYYY-MM-DD' format.
- The most recent data is for 2024-12-31.
- YTD income figures accumulate through the year; Q4 figures represent the full year.
"""

SYSTEM_PROMPT_SQL = """You are a financial data analyst that converts natural language questions into SQL queries.
Given the database schema and a user question, generate a SQLite-compatible SELECT query.

Rules:
1. ONLY generate SELECT statements. Never INSERT, UPDATE, DELETE, DROP, or ALTER.
2. Always limit results to 50 rows max unless the user specifically asks for more.
3. Format dollar amounts clearly — the raw data is in thousands.
4. When comparing institutions, include the institution name.
5. For trend questions, order by report_date.
6. For peer comparisons, use the financial_data table joined with institutions.
7. Return ONLY the SQL query, no explanation. Wrap it in ```sql``` code fences.
8. If the question cannot be answered from this data, return: CANNOT_ANSWER: <reason>
"""

SYSTEM_PROMPT_INTERPRET = """You are an executive-level financial analyst presenting insights from call report data to a bank or credit union CEO/CFO.

Style guidelines:
- Be concise but insightful — executives want the "so what"
- Lead with the key finding, then supporting detail
- Express dollar amounts in millions (M) or billions (B), not thousands
- Express ratios as percentages with 2 decimal places
- Flag anything that looks like a risk or opportunity
- Compare to industry norms when relevant:
  * ROA: community banks typically 0.80-1.20%
  * ROE: typically 8-12%
  * NIM: typically 3.00-4.00%
  * Efficiency ratio: <60% is excellent, 60-70% is good, >70% needs attention
  * NPL ratio: <1.0% is healthy, 1-2% is watch, >2% is concern
  * Tier 1 capital: >10% is well-capitalized, 8-10% adequate, <8% undercapitalized
  * Loan-to-deposit: 70-90% is typical
- Use bullet points sparingly, prefer flowing analysis
- If you spot a trend (improving or deteriorating), call it out
- End with a brief strategic implication or question to consider
"""


def execute_sql(sql: str) -> dict:
    """Safely execute a read-only SQL query and return results."""
    # Safety check
    sql_upper = sql.upper().strip()
    dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "EXEC", "ATTACH"]
    for keyword in dangerous:
        # Check for keyword as a standalone word
        if re.search(rf'\b{keyword}\b', sql_upper):
            return {"error": f"Query rejected: {keyword} operations are not allowed.", "rows": [], "columns": []}

    try:
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        columns = [description[0] for description in cursor.description] if cursor.description else []
        result_rows = [dict(row) for row in rows]
        conn.close()
        return {"columns": columns, "rows": result_rows, "row_count": len(result_rows), "error": None}
    except Exception as e:
        return {"error": str(e), "rows": [], "columns": []}


def get_institution_context(institution_id: Optional[int] = None) -> str:
    """Get context about the selected institution for Claude."""
    if not institution_id:
        return "No specific institution selected. Answer about the full dataset or ask which institution."

    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM institutions WHERE id = ?", (institution_id,))
    inst = cursor.fetchone()
    if not inst:
        conn.close()
        return "Institution not found."

    cursor.execute("""
        SELECT * FROM financial_data
        WHERE institution_id = ?
        ORDER BY report_date DESC LIMIT 1
    """, (institution_id,))
    latest = cursor.fetchone()
    conn.close()

    if not latest:
        return f"Institution: {inst['name']} ({inst['institution_type']}). No financial data available."

    inst_type = "Bank" if inst["institution_type"] == "bank" else "Credit Union"
    assets_m = latest["total_assets"] / 1000 if latest["total_assets"] else 0

    ctx = f"""Currently selected institution:
- Name: {inst['name']}
- Type: {inst_type}
- Location: {inst['city']}, {inst['state']}
- Charter: {inst['charter_type']}
- Total Assets: ${assets_m:,.0f}M (as of {latest['report_date']})
- Institution ID in database: {institution_id}

When the user asks about "my bank", "our institution", "we", etc., they mean this institution.
"""
    return ctx


def list_institutions(search: str = "", inst_type: str = "", state: str = "", limit: int = 50) -> list:
    """Search and list institutions."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = "SELECT id, cert_or_cu_number, institution_type, name, city, state, total_assets_latest FROM institutions WHERE active = 1"
    params = []

    if search:
        query += " AND name LIKE ?"
        params.append(f"%{search}%")
    if inst_type:
        query += " AND institution_type = ?"
        params.append(inst_type)
    if state:
        query += " AND state = ?"
        params.append(state.upper())

    query += " ORDER BY total_assets_latest DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_institution_summary(institution_id: int) -> dict:
    """Get a full summary of an institution's latest financials."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM institutions WHERE id = ?", (institution_id,))
    inst = dict(cursor.fetchone()) if cursor.fetchone else None

    cursor.execute("SELECT * FROM institutions WHERE id = ?", (institution_id,))
    row = cursor.fetchone()
    inst = dict(row) if row else None

    cursor.execute("""
        SELECT * FROM financial_data
        WHERE institution_id = ?
        ORDER BY report_date DESC LIMIT 8
    """, (institution_id,))
    financials = [dict(r) for r in cursor.fetchall()]

    conn.close()
    return {"institution": inst, "financials": financials}
