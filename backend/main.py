"""
CallRpt AI — FastAPI Backend
Executive-level chatbot for FFIEC & NCUA call report data.
"""

import json
import os
import re
import uuid
from typing import Optional
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import init_db, DATABASE_PATH
from ingest import seed_sample_data
from ncua_api import router as ncua_router
from query_engine import (
    SCHEMA_CONTEXT,
    SYSTEM_PROMPT_SQL,
    SYSTEM_PROMPT_INTERPRET,
    execute_sql,
    get_institution_context,
    list_institutions,
    get_institution_summary,
)
from ncua_query_engine import (
    NCUA_SCHEMA_CONTEXT,
    NCUA_SYSTEM_PROMPT_SQL,
    NCUA_SYSTEM_PROMPT_INTERPRET,
    execute_ncua_sql,
    get_ncua_institution_context,
    list_ncua_institutions,
)

# ── Set database path ───────────────────────────────────────────────────
os.environ.setdefault("DATABASE_PATH", "./data/callreports.db")

# ── Try to import anthropic; fall back to mock for demo ─────────────────
try:
    import anthropic
    ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    HAS_ANTHROPIC = bool(ANTHROPIC_KEY)
    if HAS_ANTHROPIC:
        claude_client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    else:
        claude_client = None
except ImportError:
    HAS_ANTHROPIC = False
    claude_client = None


# ── Lifespan ────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    init_db()
    # Seed sample data if empty
    import sqlite3
    conn = sqlite3.connect(os.environ["DATABASE_PATH"])
    count = conn.execute("SELECT COUNT(*) FROM institutions").fetchone()[0]
    conn.close()
    if count == 0:
        seed_sample_data()
    yield


app = FastAPI(
    title="CallRpt AI",
    description="Executive-level chatbot for FFIEC & NCUA call report analysis",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ncua_router)


# ── Request/Response Models ─────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    institution_id: Optional[int] = None
    history: list = []  # [{"role": "user"|"assistant", "content": "..."}]


class ChatResponse(BaseModel):
    answer: str
    sql_query: Optional[str] = None
    data: Optional[dict] = None
    viz_config: Optional[dict] = None
    session_id: str
    source: str  # "claude" or "mock"


class InstitutionSearchRequest(BaseModel):
    search: str = ""
    institution_type: str = ""
    state: str = ""
    limit: int = 50


class CompareInstitutionsRequest(BaseModel):
    institution_ids: list[int]
    report_date: Optional[str] = None
    institution_type: str = "credit_union"


class SuggestedPeersRequest(BaseModel):
    institution_id: int
    limit: int = 5


class NCUAChatRequest(BaseModel):
    message: str
    cu_number: Optional[str] = None          # NCUA charter number
    history: list = []                        # [{"role": "user"|"assistant", "content": "..."}]
    session_id: Optional[str] = None


# ── Mock response engine (when no API key) ──────────────────────────────
def mock_chat_response(message: str, institution_id: Optional[int] = None) -> dict:
    """Generate a helpful mock response that demonstrates the system's capabilities."""
    msg_lower = message.lower()

    # Try to generate and execute a real SQL query based on keywords
    sql = None
    data = None

    if any(kw in msg_lower for kw in ["asset", "largest", "biggest", "top"]):
        sql = """
            SELECT i.name, i.institution_type, i.state,
                   ROUND(f.total_assets / 1000, 1) as total_assets_millions,
                   ROUND(f.roa * 100, 2) as roa_pct,
                   ROUND(f.roe * 100, 2) as roe_pct
            FROM financial_data f
            JOIN institutions i ON f.institution_id = i.id
            WHERE f.report_date = '2024-12-31'
            ORDER BY f.total_assets DESC LIMIT 10
        """
    elif any(kw in msg_lower for kw in ["npl", "nonperform", "non-perform", "credit quality", "asset quality"]):
        if institution_id:
            sql = f"""
                SELECT f.report_date,
                       ROUND(f.npl_ratio * 100, 2) as npl_ratio_pct,
                       ROUND(f.nonperforming_loans / 1000, 1) as npl_millions,
                       ROUND(f.loan_loss_allowance / 1000, 1) as allowance_millions,
                       ROUND(f.net_charge_offs / 1000, 1) as nco_millions
                FROM financial_data f
                WHERE f.institution_id = {institution_id}
                ORDER BY f.report_date
            """
        else:
            sql = """
                SELECT i.name, i.institution_type,
                       ROUND(f.npl_ratio * 100, 2) as npl_ratio_pct,
                       ROUND(f.total_assets / 1000, 1) as assets_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = '2024-12-31'
                ORDER BY f.npl_ratio DESC LIMIT 10
            """
    elif any(kw in msg_lower for kw in ["profit", "income", "roa", "roe", "earning", "return"]):
        if institution_id:
            sql = f"""
                SELECT f.report_date,
                       ROUND(f.net_income / 1000, 1) as net_income_millions,
                       ROUND(f.roa * 100, 2) as roa_pct,
                       ROUND(f.roe * 100, 2) as roe_pct,
                       ROUND(f.net_interest_margin * 100, 2) as nim_pct,
                       ROUND(f.efficiency_ratio * 100, 1) as efficiency_pct
                FROM financial_data f
                WHERE f.institution_id = {institution_id}
                ORDER BY f.report_date
            """
        else:
            sql = """
                SELECT i.name, i.institution_type,
                       ROUND(f.roa * 100, 2) as roa_pct,
                       ROUND(f.roe * 100, 2) as roe_pct,
                       ROUND(f.net_income / 1000, 1) as net_income_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = '2024-12-31'
                ORDER BY f.roa DESC LIMIT 10
            """
    elif any(kw in msg_lower for kw in ["capital", "tier", "well-capital", "adequacy"]):
        if institution_id:
            sql = f"""
                SELECT f.report_date,
                       ROUND(f.tier1_capital_ratio * 100, 2) as tier1_pct,
                       ROUND(f.total_capital_ratio * 100, 2) as total_capital_pct,
                       ROUND(f.leverage_ratio * 100, 2) as leverage_pct,
                       ROUND(f.total_equity / 1000, 1) as equity_millions
                FROM financial_data f
                WHERE f.institution_id = {institution_id}
                ORDER BY f.report_date
            """
        else:
            sql = """
                SELECT i.name, i.institution_type,
                       ROUND(f.tier1_capital_ratio * 100, 2) as tier1_pct,
                       ROUND(f.total_capital_ratio * 100, 2) as total_capital_pct,
                       ROUND(f.total_assets / 1000, 1) as assets_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = '2024-12-31'
                ORDER BY f.tier1_capital_ratio DESC LIMIT 10
            """
    elif any(kw in msg_lower for kw in ["loan", "lending", "portfolio", "composition"]):
        if institution_id:
            sql = f"""
                SELECT f.report_date,
                       ROUND(f.total_loans / 1000, 1) as total_loans_millions,
                       ROUND(f.residential_re_loans / 1000, 1) as residential_re_m,
                       ROUND(f.commercial_re_loans / 1000, 1) as commercial_re_m,
                       ROUND(f.commercial_industrial_loans / 1000, 1) as ci_m,
                       ROUND(f.consumer_loans / 1000, 1) as consumer_m,
                       ROUND(f.loan_to_deposit_ratio * 100, 1) as ltd_pct
                FROM financial_data f
                WHERE f.institution_id = {institution_id}
                ORDER BY f.report_date
            """
        else:
            sql = """
                SELECT i.name,
                       ROUND(f.total_loans / 1000, 1) as loans_millions,
                       ROUND(f.loan_to_deposit_ratio * 100, 1) as ltd_pct,
                       ROUND(f.residential_re_loans / f.total_loans * 100, 1) as res_re_pct,
                       ROUND(f.commercial_re_loans / f.total_loans * 100, 1) as com_re_pct
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = '2024-12-31'
                ORDER BY f.total_loans DESC LIMIT 10
            """
    elif any(kw in msg_lower for kw in ["compare", "peer", "benchmark", "vs", "versus"]):
        sql = """
            SELECT i.institution_type,
                   COUNT(*) as count,
                   ROUND(AVG(f.total_assets) / 1000, 1) as avg_assets_millions,
                   ROUND(AVG(f.roa) * 100, 2) as avg_roa_pct,
                   ROUND(AVG(f.roe) * 100, 2) as avg_roe_pct,
                   ROUND(AVG(f.net_interest_margin) * 100, 2) as avg_nim_pct,
                   ROUND(AVG(f.efficiency_ratio) * 100, 1) as avg_efficiency_pct,
                   ROUND(AVG(f.npl_ratio) * 100, 2) as avg_npl_pct,
                   ROUND(AVG(f.tier1_capital_ratio) * 100, 2) as avg_tier1_pct
            FROM financial_data f
            JOIN institutions i ON f.institution_id = i.id
            WHERE f.report_date = '2024-12-31'
            GROUP BY i.institution_type
        """
    elif any(kw in msg_lower for kw in ["overview", "summary", "snapshot", "dashboard", "how are we doing"]):
        if institution_id:
            sql = f"""
                SELECT f.report_date,
                       ROUND(f.total_assets / 1000, 1) as assets_m,
                       ROUND(f.total_loans / 1000, 1) as loans_m,
                       ROUND(f.total_deposits / 1000, 1) as deposits_m,
                       ROUND(f.net_income / 1000, 1) as net_income_m,
                       ROUND(f.roa * 100, 2) as roa_pct,
                       ROUND(f.roe * 100, 2) as roe_pct,
                       ROUND(f.net_interest_margin * 100, 2) as nim_pct,
                       ROUND(f.efficiency_ratio * 100, 1) as efficiency_pct,
                       ROUND(f.npl_ratio * 100, 2) as npl_pct,
                       ROUND(f.tier1_capital_ratio * 100, 2) as tier1_pct,
                       ROUND(f.loan_to_deposit_ratio * 100, 1) as ltd_pct
                FROM financial_data f
                WHERE f.institution_id = {institution_id}
                ORDER BY f.report_date
            """
        else:
            sql = """
                SELECT i.institution_type,
                       COUNT(DISTINCT i.id) as institutions,
                       ROUND(SUM(f.total_assets) / 1000000, 2) as total_assets_billions,
                       ROUND(AVG(f.roa) * 100, 2) as avg_roa,
                       ROUND(AVG(f.npl_ratio) * 100, 2) as avg_npl
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = '2024-12-31'
                GROUP BY i.institution_type
            """
    elif any(kw in msg_lower for kw in ["efficiency", "cost", "expense", "overhead"]):
        sql = """
            SELECT i.name, i.institution_type,
                   ROUND(f.efficiency_ratio * 100, 1) as efficiency_pct,
                   ROUND(f.noninterest_expense / 1000, 1) as ni_expense_millions,
                   ROUND(f.total_assets / 1000, 1) as assets_millions
            FROM financial_data f
            JOIN institutions i ON f.institution_id = i.id
            WHERE f.report_date = '2024-12-31'
            ORDER BY f.efficiency_ratio ASC LIMIT 10
        """
    else:
        # Default: provide an overview
        sql = """
            SELECT i.institution_type, COUNT(DISTINCT i.id) as count,
                   ROUND(AVG(f.total_assets)/1000, 0) as avg_assets_m,
                   ROUND(AVG(f.roa)*100, 2) as avg_roa,
                   ROUND(AVG(f.npl_ratio)*100, 2) as avg_npl
            FROM financial_data f
            JOIN institutions i ON f.institution_id = i.id
            WHERE f.report_date = '2024-12-31'
            GROUP BY i.institution_type
        """

    if sql:
        data = execute_sql(sql)

    # Build a response narrative
    if data and data.get("rows"):
        rows = data["rows"]
        if len(rows) <= 3:
            detail = json.dumps(rows, indent=2, default=str)
        else:
            detail = json.dumps(rows[:5], indent=2, default=str)
            if len(rows) > 5:
                detail += f"\n... and {len(rows) - 5} more rows"

        answer = f"""Here's what I found based on the call report data:

{_format_table_text(data['columns'], data['rows'][:10])}

**Note:** This prototype is running without a Claude API key, so you're seeing template-based analysis. Add your `ANTHROPIC_API_KEY` to `.env` for full AI-powered executive insights, including trend analysis, peer comparisons, risk flagging, and strategic recommendations.

*Data sourced from FFIEC/NCUA call reports. All dollar figures in millions unless otherwise noted.*"""
    else:
        answer = """Welcome to **CallRpt AI** — your executive intelligence layer for community banking.

I can help you analyze FFIEC and NCUA call report data. Try asking me:

- "Show me the top 10 institutions by assets"
- "What's our asset quality trend?"
- "Compare bank vs credit union profitability"
- "Who has the best efficiency ratio?"
- "Give me a capital adequacy overview"
- "How is our loan portfolio composed?"

Select an institution from the sidebar to get institution-specific analysis, or ask broad market questions.

**Note:** Add your `ANTHROPIC_API_KEY` for full AI-powered analysis with Claude."""

    return {"answer": answer, "sql": sql, "data": data}


def _format_table_text(columns: list, rows: list) -> str:
    """Format query results as a readable text table."""
    if not rows:
        return "No data found."

    # Calculate column widths
    widths = {col: len(col) for col in columns}
    for row in rows:
        for col in columns:
            val = str(row.get(col, ""))
            widths[col] = max(widths[col], len(val))

    # Header
    header = " | ".join(col.ljust(widths[col]) for col in columns)
    separator = "-|-".join("-" * widths[col] for col in columns)

    # Rows
    lines = [header, separator]
    for row in rows:
        line = " | ".join(str(row.get(col, "")).ljust(widths[col]) for col in columns)
        lines.append(line)

    return "```\n" + "\n".join(lines) + "\n```"


# ── Claude-powered chat ─────────────────────────────────────────────────
def claude_chat(message: str, institution_id: Optional[int] = None, history: list = None) -> dict:
    """Full Claude-powered analysis pipeline."""
    if not claude_client:
        return mock_chat_response(message, institution_id)

    inst_context = get_institution_context(institution_id)

    # Step 1: Generate SQL
    sql_messages = []
    if history:
        # Include recent history for context
        for h in history[-6:]:
            sql_messages.append({"role": h["role"], "content": h["content"]})

    sql_messages.append({
        "role": "user",
        "content": f"""Database schema:
{SCHEMA_CONTEXT}

Institution context:
{inst_context}

User question: {message}

Generate a SQL query to answer this question. Return only the SQL in ```sql``` fences."""
    })

    sql_response = claude_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT_SQL,
        messages=sql_messages,
    )

    sql_text = sql_response.content[0].text

    # Extract SQL from response
    sql_match = re.search(r'```sql\s*(.*?)\s*```', sql_text, re.DOTALL)
    if not sql_match:
        if "CANNOT_ANSWER" in sql_text:
            return {
                "answer": sql_text.replace("CANNOT_ANSWER:", "I can't answer that from the available data:"),
                "sql": None,
                "data": None,
            }
        # Try to use the whole response as SQL
        sql_query = sql_text.strip()
    else:
        sql_query = sql_match.group(1).strip()

    # Step 2: Execute SQL
    data = execute_sql(sql_query)

    if data.get("error"):
        # Let Claude retry with the error
        retry_messages = sql_messages + [
            {"role": "assistant", "content": sql_text},
            {"role": "user", "content": f"That query failed with error: {data['error']}. Please fix the query."}
        ]
        retry_response = claude_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT_SQL,
            messages=retry_messages,
        )
        retry_text = retry_response.content[0].text
        retry_match = re.search(r'```sql\s*(.*?)\s*```', retry_text, re.DOTALL)
        if retry_match:
            sql_query = retry_match.group(1).strip()
            data = execute_sql(sql_query)

    # Step 3: Interpret results with Claude
    if data.get("rows"):
        result_summary = json.dumps(data["rows"][:20], indent=2, default=str)

        interpret_messages = [{
            "role": "user",
            "content": f"""The user asked: "{message}"

{inst_context}

I ran this query:
```sql
{sql_query}
```

Results ({data['row_count']} rows):
{result_summary}

Please provide an executive-level analysis of these results. Be concise, insightful, and highlight anything noteworthy. Format dollar amounts from thousands to millions/billions."""
        }]

        interpret_response = claude_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=SYSTEM_PROMPT_INTERPRET,
            messages=interpret_messages,
        )

        answer = interpret_response.content[0].text
    else:
        answer = "I wasn't able to find relevant data for that question. Could you try rephrasing, or ask about a specific metric like assets, profitability, asset quality, or capital?"

    return {"answer": answer, "sql": sql_query, "data": data}


# ── API Routes ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "ai_enabled": HAS_ANTHROPIC}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Main chat endpoint — ask questions about call report data."""
    session_id = request.session_id or str(uuid.uuid4())

    result = claude_chat(
        message=request.message,
        institution_id=request.institution_id,
        history=request.history,
    )

    return ChatResponse(
        answer=result["answer"],
        sql_query=result.get("sql"),
        data=result.get("data"),
        session_id=session_id,
        source="claude" if HAS_ANTHROPIC else "mock",
    )


@app.post("/api/institutions/search")
async def search_institutions(request: InstitutionSearchRequest):
    """Search for institutions by name, type, or state."""
    results = list_institutions(
        search=request.search,
        inst_type=request.institution_type,
        state=request.state,
        limit=request.limit,
    )
    return {"institutions": results, "count": len(results)}


@app.get("/api/institutions/{institution_id}")
async def get_institution(institution_id: int):
    """Get detailed info for a single institution."""
    summary = get_institution_summary(institution_id)
    if not summary["institution"]:
        raise HTTPException(status_code=404, detail="Institution not found")
    return summary


@app.get("/api/institutions/{institution_id}/peers")
async def get_peers(institution_id: int):
    """Get peer comparison for an institution."""
    summary = get_institution_summary(institution_id)
    if not summary["institution"]:
        raise HTTPException(status_code=404, detail="Institution not found")

    inst = summary["institution"]
    latest = summary["financials"][0] if summary["financials"] else None
    if not latest:
        return {"peers": [], "institution": inst}

    # Find peer group by asset size and type on the latest report date
    latest_report_sql = "SELECT MAX(report_date) AS latest_report_date FROM financial_data"
    latest_date_result = execute_sql(latest_report_sql)
    latest_report_date = (
        latest_date_result.get("rows", [{}])[0].get("latest_report_date") or "2024-12-31"
    )

    sql = f"""
        SELECT i.id, i.name, i.state,
               f.total_assets, f.roa, f.roe, f.net_interest_margin,
               f.efficiency_ratio, f.npl_ratio, f.tier1_capital_ratio
        FROM financial_data f
        JOIN institutions i ON f.institution_id = i.id
        WHERE f.report_date = '{latest_report_date}'
          AND i.institution_type = '{inst["institution_type"]}'
          AND f.total_assets BETWEEN {latest["total_assets"] * 0.5} AND {latest["total_assets"] * 2.0}
          AND i.id != {institution_id}
        ORDER BY f.total_assets DESC
        LIMIT 20
    """
    data = execute_sql(sql)
    return {
        "peers": data.get("rows", []),
        "institution": inst,
        "latest": dict(latest),
        "report_date": latest_report_date,
    }


@app.post("/api/institutions/suggested-peers")
async def suggested_peers(request: SuggestedPeersRequest):
    """Get suggested peers for a base institution (asset-band + same type)."""
    if request.limit < 1 or request.limit > 25:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 25")

    summary = get_institution_summary(request.institution_id)
    inst = summary.get("institution")
    latest = summary["financials"][0] if summary.get("financials") else None
    if not inst or not latest:
        raise HTTPException(status_code=404, detail="Institution not found or has no financial data")

    latest_report_sql = "SELECT MAX(report_date) AS latest_report_date FROM financial_data"
    latest_date_result = execute_sql(latest_report_sql)
    latest_report_date = (
        latest_date_result.get("rows", [{}])[0].get("latest_report_date") or latest["report_date"]
    )

    sql = f"""
        SELECT i.id, i.name, i.state, i.cert_or_cu_number,
               f.total_assets, f.roa, f.net_worth_ratio, f.efficiency_ratio, f.npl_ratio
        FROM institutions i
        JOIN financial_data f ON f.institution_id = i.id
        WHERE i.institution_type = '{inst["institution_type"]}'
          AND f.report_date = '{latest_report_date}'
          AND i.id != {int(request.institution_id)}
          AND f.total_assets BETWEEN {float(latest["total_assets"]) * 0.5} AND {float(latest["total_assets"]) * 2.0}
        ORDER BY
          CASE WHEN i.state = '{inst["state"]}' THEN 0 ELSE 1 END,
          ABS(f.total_assets - {float(latest["total_assets"])})
        LIMIT {int(request.limit)}
    """
    data = execute_sql(sql)
    return {
        "base_institution": inst,
        "report_date": latest_report_date,
        "peers": data.get("rows", []),
    }


@app.post("/api/institutions/compare")
async def compare_institutions(request: CompareInstitutionsRequest):
    """Compare multiple institutions on a single report date."""
    if not request.institution_ids:
        raise HTTPException(status_code=400, detail="institution_ids cannot be empty")

    unique_ids = sorted({int(x) for x in request.institution_ids if int(x) > 0})
    if len(unique_ids) > 8:
        raise HTTPException(status_code=400, detail="max 8 institutions for compare")

    if request.report_date:
        report_date = request.report_date
    else:
        latest_report_sql = "SELECT MAX(report_date) AS latest_report_date FROM financial_data"
        latest_date_result = execute_sql(latest_report_sql)
        report_date = latest_date_result.get("rows", [{}])[0].get("latest_report_date")
        if not report_date:
            raise HTTPException(status_code=404, detail="No financial data found")

    ids_sql = ",".join(str(i) for i in unique_ids)
    sql = f"""
        SELECT i.id, i.name, i.institution_type, i.cert_or_cu_number, i.city, i.state,
               f.report_date, f.total_assets, f.total_loans, f.total_deposits, f.member_count,
               f.roa, f.roe, f.net_interest_margin, f.efficiency_ratio, f.npl_ratio,
               f.net_worth_ratio, f.tier1_capital_ratio, f.loan_to_deposit_ratio, f.net_income
        FROM institutions i
        LEFT JOIN financial_data f
               ON f.institution_id = i.id AND f.report_date = '{report_date}'
        WHERE i.id IN ({ids_sql})
          AND i.institution_type = '{request.institution_type}'
        ORDER BY f.total_assets DESC
    """
    result = execute_sql(sql)
    rows = result.get("rows", [])
    if not rows:
        raise HTTPException(status_code=404, detail="No institutions found for compare")

    return {
        "report_date": report_date,
        "institution_type": request.institution_type,
        "rows": rows,
    }


# ── NCUA mock response (no API key) ─────────────────────────────────────
def _ncua_mock_response(message: str, cu_number: Optional[str] = None) -> dict:
    """Template-based fallback for NCUA chat when no Claude API key is set."""
    msg_lower = message.lower()
    sql = None
    data = None

    if any(kw in msg_lower for kw in ["nwr", "net worth", "capital", "capitalized", "well cap"]):
        if cu_number:
            sql = f"""
                SELECT i.name, f.report_date, f.quarter_label,
                       ROUND(f.net_worth_ratio * 100, 2) AS nwr_pct,
                       f.camel_class,
                       ROUND(f.total_equity / 1000000.0, 2) AS equity_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE i.cu_number = '{cu_number}'
                ORDER BY f.report_date DESC LIMIT 8
            """
        else:
            sql = """
                SELECT camel_class, COUNT(*) AS cu_count,
                       ROUND(AVG(net_worth_ratio) * 100, 2) AS avg_nwr_pct
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = (SELECT MAX(report_date) FROM financial_data)
                GROUP BY camel_class ORDER BY cu_count DESC
            """
    elif any(kw in msg_lower for kw in ["delinquency", "delinquent", "past due", "credit quality"]):
        if cu_number:
            sql = f"""
                SELECT i.name, f.report_date, f.quarter_label,
                       ROUND(f.delinquency_ratio * 100, 2) AS delinquency_pct
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE i.cu_number = '{cu_number}'
                ORDER BY f.report_date DESC LIMIT 8
            """
        else:
            sql = """
                SELECT i.name, i.state,
                       ROUND(f.delinquency_ratio * 100, 2) AS delinquency_pct,
                       ROUND(f.total_assets / 1000000.0, 1) AS assets_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = (SELECT MAX(report_date) FROM financial_data)
                ORDER BY f.delinquency_ratio DESC LIMIT 10
            """
    elif any(kw in msg_lower for kw in ["member", "membership", "growth"]):
        if cu_number:
            sql = f"""
                SELECT f.report_date, f.quarter_label, f.member_count,
                       ROUND(f.total_assets / 1000000.0, 2) AS assets_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE i.cu_number = '{cu_number}'
                ORDER BY f.report_date DESC LIMIT 8
            """
        else:
            sql = """
                SELECT i.name, i.state, f.member_count,
                       ROUND(f.total_assets / 1000000.0, 1) AS assets_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = (SELECT MAX(report_date) FROM financial_data)
                ORDER BY f.member_count DESC LIMIT 10
            """
    elif any(kw in msg_lower for kw in ["roa", "profit", "income", "earning", "return"]):
        if cu_number:
            sql = f"""
                SELECT f.report_date, f.quarter_label,
                       ROUND(f.roa * 100, 2) AS roa_pct,
                       ROUND(f.net_income / 1000000.0, 2) AS net_income_millions,
                       ROUND(f.net_interest_margin * 100, 2) AS nim_pct,
                       ROUND(f.efficiency_ratio * 100, 1) AS efficiency_pct
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE i.cu_number = '{cu_number}'
                ORDER BY f.report_date DESC LIMIT 8
            """
        else:
            sql = """
                SELECT i.name, i.state,
                       ROUND(f.roa * 100, 2) AS roa_pct,
                       ROUND(f.net_income / 1000000.0, 2) AS net_income_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = (SELECT MAX(report_date) FROM financial_data)
                ORDER BY f.roa DESC LIMIT 10
            """
    elif any(kw in msg_lower for kw in ["loan", "share", "loan-to-share", "lts"]):
        if cu_number:
            sql = f"""
                SELECT f.report_date, f.quarter_label,
                       ROUND(f.total_loans / 1000000.0, 2) AS loans_millions,
                       ROUND(f.total_shares / 1000000.0, 2) AS shares_millions,
                       ROUND(f.loan_to_share_ratio * 100, 1) AS lts_pct
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE i.cu_number = '{cu_number}'
                ORDER BY f.report_date DESC LIMIT 8
            """
        else:
            sql = """
                SELECT i.name, i.state,
                       ROUND(f.loan_to_share_ratio * 100, 1) AS lts_pct,
                       ROUND(f.total_loans / 1000000.0, 1) AS loans_millions
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = (SELECT MAX(report_date) FROM financial_data)
                ORDER BY f.loan_to_share_ratio DESC LIMIT 10
            """
    else:
        # General overview
        if cu_number:
            sql = f"""
                SELECT f.report_date, f.quarter_label,
                       ROUND(f.total_assets / 1000000.0, 2) AS assets_millions,
                       ROUND(f.total_loans / 1000000.0, 2) AS loans_millions,
                       ROUND(f.total_shares / 1000000.0, 2) AS shares_millions,
                       f.member_count,
                       ROUND(f.roa * 100, 2) AS roa_pct,
                       ROUND(f.net_worth_ratio * 100, 2) AS nwr_pct,
                       ROUND(f.delinquency_ratio * 100, 2) AS delinquency_pct,
                       ROUND(f.loan_to_share_ratio * 100, 1) AS lts_pct
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE i.cu_number = '{cu_number}'
                ORDER BY f.report_date DESC LIMIT 4
            """
        else:
            sql = """
                SELECT COUNT(DISTINCT i.id) AS total_cus,
                       ROUND(SUM(f.total_assets) / 1e9, 2) AS total_assets_billions,
                       ROUND(AVG(f.roa) * 100, 2) AS avg_roa_pct,
                       ROUND(AVG(f.net_worth_ratio) * 100, 2) AS avg_nwr_pct,
                       ROUND(AVG(f.delinquency_ratio) * 100, 2) AS avg_delinquency_pct
                FROM financial_data f
                JOIN institutions i ON f.institution_id = i.id
                WHERE f.report_date = (SELECT MAX(report_date) FROM financial_data)
            """

    if sql:
        data = execute_ncua_sql(sql)

    if data and data.get("rows"):
        table = _format_table_text(data["columns"], data["rows"][:10])
        answer = (
            f"Here's what I found in the NCUA 5300 call report data:\n\n{table}\n\n"
            "**Note:** This is running without a Claude API key — you're seeing template-based "
            "analysis. Add your `ANTHROPIC_API_KEY` to `.env` for full AI-powered executive "
            "insights, including trend analysis, peer benchmarking, and regulatory commentary."
        )
    else:
        answer = (
            "Welcome to **CallRpt AI — NCUA Edition**.\n\n"
            "I can help you analyse NCUA 5300 call report data for 5,400+ credit unions "
            "(2020–2025). Try asking:\n\n"
            "- \"What's our NWR trend over the last 8 quarters?\"\n"
            "- \"Are we well capitalized?\"\n"
            "- \"Show member growth for the past two years\"\n"
            "- \"How does our delinquency rate compare to peers?\"\n"
            "- \"What is our loan-to-share ratio?\"\n"
            "- \"Show our ROA vs the prior year\"\n\n"
            "Select a credit union (charter number) from the sidebar for CU-specific analysis.\n\n"
            "**Note:** Add your `ANTHROPIC_API_KEY` for full Claude-powered analysis."
        )

    return {"answer": answer, "sql": sql, "data": data}


# ── NCUA Claude pipeline ─────────────────────────────────────────────────
NCUA_ROUTER_PROMPT = """You are a routing classifier for a credit union data analytics platform.
Given a user's question, classify it into exactly ONE category. Return ONLY the category label, nothing else.

Categories:
- DATA_QUERY — Questions that require looking up specific numbers, trends, comparisons, or rankings from the NCUA 5300 call report database. Examples: "What's Navy Federal's ROA?", "Show me the top 10 CUs by assets", "How has our delinquency trended?", "Compare us to Pentagon FCU"
- KNOWLEDGE — Questions about credit union concepts, definitions, regulatory thresholds, or general industry knowledge that can be answered without querying the database. Examples: "What does net worth ratio mean?", "What's a good ROA for a credit union?", "Explain the CAMEL rating system", "What are NCUA regulatory thresholds?"
- OFF_TOPIC — Questions unrelated to credit unions, banking, or financial analysis. Examples: "What's the weather?", "Write me a poem", "Tell me a joke"

Return ONLY one of: DATA_QUERY, KNOWLEDGE, OFF_TOPIC"""

NCUA_KNOWLEDGE_PROMPT = """You are an expert NCUA 5300 Call Report analyst answering a credit union executive's question about industry concepts, definitions, or regulatory frameworks.

Style guidelines:
- Use credit union terminology: "members" not "customers", "shares" not "deposits", "net worth ratio (NWR)" not "Tier 1 capital ratio".
- Be concise but thorough — executives want actionable understanding.
- Reference NCUA regulatory thresholds where relevant:
  * NWR: ≥10% = Well Capitalized, 7–10% = Adequately Capitalized, <7% = Undercapitalized
  * ROA: credit union peer average is typically 0.70–1.00%
  * NIM: typically 2.50–3.50% for credit unions
  * Efficiency ratio: <70% is good, 70–80% is adequate, >80% needs attention
  * Delinquency rate: <1.0% is healthy, 1–2% is watch, >2% is concern
  * Loan-to-share ratio: 70–85% is typical
- Reference NCUA 5300 report schedules when relevant.
- If the question could benefit from actual data analysis, suggest what they could ask next (e.g., "To see how your CU compares, try asking: 'How does our ROA compare to peers?'")."""


def _classify_question(message: str) -> str:
    """Classify a user question as DATA_QUERY, KNOWLEDGE, or OFF_TOPIC."""
    resp = claude_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=20,
        system=NCUA_ROUTER_PROMPT,
        messages=[{"role": "user", "content": message}],
    )
    label = resp.content[0].text.strip().upper()
    if label in ("DATA_QUERY", "KNOWLEDGE", "OFF_TOPIC"):
        return label
    # Default to DATA_QUERY if classification is unclear
    return "DATA_QUERY"


def _answer_knowledge_question(
    message: str,
    cu_number: Optional[str] = None,
    history: Optional[list] = None,
) -> dict:
    """Answer a conceptual/knowledge question without SQL."""
    cu_context = get_ncua_institution_context(cu_number)

    messages = []
    if history:
        for h in (history or [])[-6:]:
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({
        "role": "user",
        "content": f"Credit union context:\n{cu_context}\n\nQuestion: {message}",
    })

    resp = claude_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=NCUA_KNOWLEDGE_PROMPT,
        messages=messages,
    )
    return {"answer": resp.content[0].text, "sql": None, "data": None}


def ncua_claude_chat(
    message: str,
    cu_number: Optional[str] = None,
    history: Optional[list] = None,
) -> dict:
    """
    Full Claude-powered NCUA analysis pipeline with intent routing.

    Step 0: Classify the question (DATA_QUERY / KNOWLEDGE / OFF_TOPIC).
    Step 1: Build context (schema + CU KPIs).
    Step 2: Ask Claude to generate SQL.
    Step 3: Execute SQL against ncua_callreports.db.
    Step 4: Ask Claude to interpret results for a CU executive.
    """
    if not claude_client:
        return _ncua_mock_response(message, cu_number)

    # ── Step 0: Route the question ──────────────────────────────────────
    intent = _classify_question(message)

    if intent == "OFF_TOPIC":
        return {
            "answer": (
                "I'm focused on credit union financial analysis using NCUA 5300 call report data. "
                "I can help with topics like asset trends, ROA, net worth ratios, delinquency rates, "
                "peer comparisons, and regulatory metrics. How can I help with your CU analysis?"
            ),
            "sql": None,
            "data": None,
        }

    if intent == "KNOWLEDGE":
        return _answer_knowledge_question(message, cu_number, history)

    # ── DATA_QUERY: proceed with SQL pipeline ───────────────────────────
    cu_context = get_ncua_institution_context(cu_number)

    # ── Step 1: Generate SQL ────────────────────────────────────────────
    sql_messages = []
    if history:
        for h in (history or [])[-6:]:
            sql_messages.append({"role": h["role"], "content": h["content"]})

    sql_messages.append({
        "role": "user",
        "content": (
            f"Database schema:\n{NCUA_SCHEMA_CONTEXT}\n\n"
            f"Credit union context:\n{cu_context}\n\n"
            f"User question: {message}\n\n"
            "Generate a SQL query to answer this question. "
            "Return only the SQL in ```sql``` fences."
        ),
    })

    sql_response = claude_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=NCUA_SYSTEM_PROMPT_SQL,
        messages=sql_messages,
    )
    sql_text = sql_response.content[0].text

    # Extract SQL from fences
    sql_match = re.search(r'```sql\s*(.*?)\s*```', sql_text, re.DOTALL)
    if not sql_match:
        if "CANNOT_ANSWER" in sql_text:
            return {
                "answer": sql_text.replace(
                    "CANNOT_ANSWER:",
                    "I can't answer that from the available NCUA data:"
                ),
                "sql": None,
                "data": None,
            }
        sql_query = sql_text.strip()
    else:
        sql_query = sql_match.group(1).strip()

    # ── Step 2: Execute SQL ─────────────────────────────────────────────
    data = execute_ncua_sql(sql_query)

    if data.get("error"):
        # Ask Claude to fix the query
        retry_messages = sql_messages + [
            {"role": "assistant", "content": sql_text},
            {
                "role": "user",
                "content": (
                    f"That query failed with error: {data['error']}. "
                    "Please correct the SQL and try again."
                ),
            },
        ]
        retry_resp = claude_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=NCUA_SYSTEM_PROMPT_SQL,
            messages=retry_messages,
        )
        retry_text = retry_resp.content[0].text
        retry_match = re.search(r'```sql\s*(.*?)\s*```', retry_text, re.DOTALL)
        if retry_match:
            sql_query = retry_match.group(1).strip()
            data = execute_ncua_sql(sql_query)

    # ── Step 3: Interpret results ───────────────────────────────────────
    viz_config = None
    if data.get("rows"):
        result_summary = json.dumps(data["rows"][:20], indent=2, default=str)

        interpret_messages = [{
            "role": "user",
            "content": (
                f'The credit union executive asked: "{message}"\n\n'
                f"{cu_context}\n\n"
                f"I ran this NCUA 5300 query:\n```sql\n{sql_query}\n```\n\n"
                f"Results ({data['row_count']} rows, dollar values are in actual dollars):\n"
                f"Columns: {data.get('columns', [])}\n"
                f"{result_summary}\n\n"
                "Please provide an executive-level analysis of these results. "
                "Be concise and insightful. Use credit union terminology. "
                "Convert dollar amounts to millions or billions for readability.\n\n"
                "Additionally, if the data would benefit from a chart, include a JSON block "
                "at the END of your response in this exact format:\n"
                "```viz\n"
                '{"chart_type": "bar"|"line"|"pie", "x_field": "<column_name>", '
                '"y_field": "<column_name>", "title": "<short title>"}\n'
                "```\n"
                "Use 'line' for time-series trends, 'bar' for comparisons across categories, "
                "'pie' for composition (8 or fewer slices). "
                "x_field and y_field must be exact column names from the result set. "
                "If the data is a single row or not suitable for charting, omit the viz block."
            ),
        }]

        interpret_resp = claude_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=NCUA_SYSTEM_PROMPT_INTERPRET,
            messages=interpret_messages,
        )
        answer = interpret_resp.content[0].text

        # Extract optional visualization config
        viz_match = re.search(r'```viz\s*(\{.*?\})\s*```', answer, re.DOTALL)
        if viz_match:
            try:
                viz_config = json.loads(viz_match.group(1))
            except json.JSONDecodeError:
                viz_config = None
            answer = answer[:viz_match.start()].rstrip()
    else:
        answer = (
            "I wasn't able to find relevant data for that question in the NCUA database. "
            "Could you try rephrasing, or ask about a specific metric such as net worth ratio, "
            "delinquency rate, loan-to-share ratio, member growth, ROA, or NIM?"
        )

    return {"answer": answer, "sql": sql_query, "data": data, "viz_config": viz_config}


# ── NCUA API Routes ──────────────────────────────────────────────────────

@app.post("/api/ncua/chat", response_model=ChatResponse)
async def ncua_chat(request: NCUAChatRequest):
    """
    NCUA 5300 chat endpoint — ask questions about real NCUA call report data.

    Accepts a natural-language question, an optional NCUA charter number
    (cu_number), and conversation history.  Returns an AI-generated executive
    analysis backed by live SQL against the 5,400-CU dataset.
    """
    session_id = request.session_id or str(uuid.uuid4())

    result = ncua_claude_chat(
        message=request.message,
        cu_number=request.cu_number,
        history=request.history,
    )

    return ChatResponse(
        answer=result["answer"],
        sql_query=result.get("sql"),
        data=result.get("data"),
        viz_config=result.get("viz_config"),
        session_id=session_id,
        source="claude" if HAS_ANTHROPIC else "mock",
    )


@app.post("/api/ncua/institutions/search")
async def ncua_search_institutions(request: InstitutionSearchRequest):
    """Search NCUA credit unions by name and/or state."""
    results = list_ncua_institutions(
        search=request.search,
        state=request.state,
        limit=request.limit,
    )
    return {"institutions": results, "count": len(results)}


@app.get("/api/ncua/institutions/{cu_number}/context")
async def ncua_institution_context(cu_number: str):
    """Return the KPI context string for a given NCUA charter number."""
    ctx = get_ncua_institution_context(cu_number)
    return {"cu_number": cu_number, "context": ctx}


# ── Mount static files (React build) ───────────────────────────────────
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")
if os.path.isdir(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="static")
