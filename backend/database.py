"""
Database layer for CallRpt AI — stores FFIEC and NCUA call report data.
Uses SQLite for the prototype; swap to Postgres for production.
"""

import aiosqlite
import sqlite3
import os

DATABASE_PATH = os.getenv("DATABASE_PATH", "./data/callreports.db")


def get_sync_connection() -> sqlite3.Connection:
    """Synchronous connection for data ingestion scripts."""
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


async def get_db() -> aiosqlite.Connection:
    """Async connection for FastAPI endpoints."""
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    return db


def init_db():
    """Create all tables if they don't exist."""
    conn = get_sync_connection()
    cursor = conn.cursor()

    # ── Institutions table ──────────────────────────────────────────────
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS institutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cert_or_cu_number TEXT UNIQUE NOT NULL,   -- FDIC cert # or NCUA CU number
        institution_type TEXT NOT NULL,            -- 'bank' or 'credit_union'
        name TEXT NOT NULL,
        city TEXT,
        state TEXT,
        total_assets_latest REAL,
        charter_type TEXT,
        active INTEGER DEFAULT 1
    )
    """)

    # ── Financial data (quarterly snapshots) ────────────────────────────
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS financial_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        institution_id INTEGER NOT NULL,
        report_date TEXT NOT NULL,                 -- e.g. '2024-12-31'

        -- Balance Sheet
        total_assets REAL,
        total_loans REAL,
        total_deposits REAL,
        total_equity REAL,
        total_liabilities REAL,
        cash_and_equivalents REAL,
        securities REAL,

        -- Loan Composition
        residential_re_loans REAL,
        commercial_re_loans REAL,
        commercial_industrial_loans REAL,
        consumer_loans REAL,
        agriculture_loans REAL,

        -- Asset Quality
        nonperforming_loans REAL,
        loan_loss_allowance REAL,
        net_charge_offs REAL,
        past_due_30_89 REAL,
        past_due_90_plus REAL,

        -- Income Statement (YTD)
        total_interest_income REAL,
        total_interest_expense REAL,
        net_interest_income REAL,
        provision_for_loan_losses REAL,
        noninterest_income REAL,
        noninterest_expense REAL,
        net_income REAL,

        -- Key Ratios (computed or reported)
        roa REAL,                                  -- Return on Assets
        roe REAL,                                  -- Return on Equity
        net_interest_margin REAL,
        efficiency_ratio REAL,
        tier1_capital_ratio REAL,
        total_capital_ratio REAL,
        leverage_ratio REAL,
        npl_ratio REAL,                            -- Non-performing loan ratio
        loan_to_deposit_ratio REAL,

        -- Credit Union specific
        member_count INTEGER,
        net_worth_ratio REAL,
        delinquency_ratio REAL,

        FOREIGN KEY (institution_id) REFERENCES institutions(id),
        UNIQUE(institution_id, report_date)
    )
    """)

    # ── Peer groups ─────────────────────────────────────────────────────
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS peer_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        institution_type TEXT,                     -- 'bank', 'credit_union', or 'all'
        asset_min REAL,
        asset_max REAL,
        state TEXT                                 -- NULL = nationwide
    )
    """)

    # ── Chat history ────────────────────────────────────────────────────
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        institution_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        title TEXT
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,                        -- 'user' or 'assistant'
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    )
    """)

    # ── Indexes ─────────────────────────────────────────────────────────
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_fin_inst ON financial_data(institution_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_fin_date ON financial_data(report_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_inst_type ON institutions(institution_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_inst_state ON institutions(state)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_inst_name ON institutions(name)")

    conn.commit()
    conn.close()
    print("✓ Database initialized successfully")


if __name__ == "__main__":
    init_db()
