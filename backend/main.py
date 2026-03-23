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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import init_db, DATABASE_PATH
from ingest import seed_sample_data
from query_engine import (
    SCHEMA_CONTEXT,
    SYSTEM_PROMPT_SQL,
    SYSTEM_PROMPT_INTERPRET,
    execute_sql,
    get_institution_context,
    list_institutions,
    get_institution_summary,
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
    session_id: str
    source: str  # "claude" or "mock"


class InstitutionSearchRequest(BaseModel):
    search: str = ""
    institution_type: str = ""
    state: str = ""
    limit: int = 50


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

    # Find peer group by asset size and type
    sql = f"""
        SELECT i.id, i.name, i.state,
               f.total_assets, f.roa, f.roe, f.net_interest_margin,
               f.efficiency_ratio, f.npl_ratio, f.tier1_capital_ratio
        FROM financial_data f
        JOIN institutions i ON f.institution_id = i.id
        WHERE f.report_date = '2024-12-31'
          AND i.institution_type = '{inst["institution_type"]}'
          AND f.total_assets BETWEEN {latest["total_assets"] * 0.5} AND {latest["total_assets"] * 2.0}
          AND i.id != {institution_id}
        ORDER BY f.total_assets DESC
        LIMIT 20
    """
    data = execute_sql(sql)
    return {"peers": data.get("rows", []), "institution": inst, "latest": dict(latest)}


# ── Mount static files (React build) ───────────────────────────────────
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")
if os.path.isdir(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="static")
