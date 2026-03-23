"""
Data ingestion for FFIEC (bank) and NCUA (credit union) call reports.

This module can:
  1. Download real bulk data from FFIEC CDR and NCUA
  2. Generate realistic sample data for prototyping

For the prototype, we seed with realistic synthetic data covering ~200 institutions
across 8 quarters. In production, swap to the real download functions.
"""

import sqlite3
import random
import os
import sys

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(__file__))
from database import get_sync_connection, init_db, DATABASE_PATH

# ── Real data source URLs (for production use) ─────────────────────────
FFIEC_BULK_URL = "https://cdr.ffiec.gov/public/PWS/DownloadBulkData.aspx"
NCUA_DATA_URL = "https://ncua.gov/files/publications/analysis/"
FDIC_API_URL = "https://banks.data.fdic.gov/api/"

# ── Sample institution names ────────────────────────────────────────────
BANK_NAMES = [
    "First National Community Bank", "Heritage Valley Bank", "Pinnacle State Bank",
    "Summit Trust Bank", "Cornerstone Federal Bank", "Lakewood Savings Bank",
    "Prairie Land National Bank", "Mountain West Bank", "Coastal Commerce Bank",
    "Heartland Farmers Bank", "Riverside Community Bank", "Pacific Crest Bank",
    "Eagle Point National Bank", "Midlands Trust & Savings", "Frontier State Bank",
    "Capital City Bank", "Clearwater National Bank", "Timber Ridge Bank",
    "Valley Forge Community Bank", "Sunset Harbor Bank", "Granite Peak Bank",
    "Northern Plains Bank", "Blue Ridge National Bank", "Silver Creek Savings",
    "Westfield Community Bank", "Cedar Valley Bank", "Ironwood National Bank",
    "Golden State Community Bank", "Maple Leaf Savings", "Stonebridge Trust Bank",
    "Redwood Financial Bank", "Cross Creek National Bank", "Hilltop Community Bank",
    "Riverbend Savings Bank", "Cascade Mountain Bank", "Bayshore National Bank",
    "Tall Grass Community Bank", "Windmill Plains Bank", "Oak Harbor Savings",
    "Copper Canyon National Bank", "Sunrise Federal Bank", "Deep Creek Trust",
    "Sequoia Valley Bank", "Meadowbrook Community Bank", "Lone Star State Bank",
    "Tidewater National Bank", "Pine Forest Savings", "Sandstone Community Bank",
    "Horizon View Bank", "Willowbrook Federal Bank"
]

CU_NAMES = [
    "United Federal Credit Union", "Community First CU", "Heritage Members CU",
    "Midwest Alliance Credit Union", "Pacific Coast FCU", "Liberty Employees CU",
    "Sunrise Community Credit Union", "Evergreen Federal CU", "Lakeshore Members CU",
    "Mountain View Credit Union", "Harbor Light FCU", "Crossroads Community CU",
    "Gateway Federal Credit Union", "Northern Star CU", "Prairie Fire FCU",
    "Valley Teachers Credit Union", "Skyline Community CU", "Beacon Federal CU",
    "Riverdale Employees CU", "Summit Peak Credit Union", "Coastal Neighbors FCU",
    "Heartland Community CU", "Pioneer Federal Credit Union", "Eagle Federal CU",
    "Cornerstone Members CU", "Clearview Community CU", "Lakeland Federal CU",
    "Metro Area Credit Union", "Farmworkers United CU", "City Employees FCU",
    "Tri-County Community CU", "Granite Federal Credit Union", "Redwood Community CU",
    "South Bay Federal CU", "Inland Empire Credit Union", "Buckeye State CU",
    "Peach State Federal CU", "Bluegrass Community CU", "Keystone Federal CU",
    "Magnolia Federal Credit Union", "Desert Sun CU", "Timber Country FCU",
    "Great Lakes Community CU", "Appalachian Federal CU", "Silver State Credit Union",
    "Northwest Neighbors FCU", "Lone Pine Community CU", "Bayou Federal CU",
    "Rocky Mountain Credit Union", "Palmetto Federal CU"
]

STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
]

CITIES = [
    "Springfield", "Madison", "Georgetown", "Franklin", "Clinton",
    "Greenville", "Bristol", "Fairview", "Salem", "Chester",
    "Manchester", "Oakland", "Arlington", "Riverside", "Burlington",
    "Lakewood", "Jackson", "Milton", "Newport", "Centerville"
]

REPORT_DATES = [
    "2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31",
    "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
]


def _rand_pct(base, pct=0.10):
    """Return base ± pct variation."""
    return base * (1 + random.uniform(-pct, pct))


def _generate_financial_data(inst_type: str, asset_tier: str, quarter_idx: int):
    """
    Generate a realistic quarterly financial snapshot.
    asset_tier: 'small' (<500M), 'mid' (500M-2B), 'large' (2B-10B)
    """
    # Base total assets by tier
    asset_bases = {
        "small": random.uniform(80_000, 500_000),      # $80M - $500M (in thousands)
        "mid": random.uniform(500_000, 2_000_000),      # $500M - $2B
        "large": random.uniform(2_000_000, 10_000_000),  # $2B - $10B
    }
    base_assets = asset_bases[asset_tier]

    # Apply growth trend (1-3% per quarter)
    growth = 1 + (0.005 + random.uniform(0, 0.008)) * quarter_idx
    total_assets = _rand_pct(base_assets * growth, 0.02)

    # Balance sheet ratios
    loan_pct = random.uniform(0.58, 0.75)
    deposit_pct = random.uniform(0.78, 0.88)
    equity_pct = random.uniform(0.08, 0.13)
    cash_pct = random.uniform(0.05, 0.12)
    securities_pct = random.uniform(0.12, 0.25)

    total_loans = total_assets * loan_pct
    total_deposits = total_assets * deposit_pct
    total_equity = total_assets * equity_pct
    total_liabilities = total_assets - total_equity
    cash = total_assets * cash_pct
    securities = total_assets * securities_pct

    # Loan composition
    res_re = total_loans * random.uniform(0.25, 0.45)
    com_re = total_loans * random.uniform(0.20, 0.35)
    ci = total_loans * random.uniform(0.10, 0.25)
    consumer = total_loans * random.uniform(0.05, 0.15)
    ag = total_loans * random.uniform(0.01, 0.08)

    # Asset quality
    npl_rate = random.uniform(0.005, 0.025)
    npl = total_loans * npl_rate
    allowance = total_loans * random.uniform(0.008, 0.018)
    nco = total_loans * random.uniform(0.001, 0.006) * ((quarter_idx + 1) / 4)
    pd30 = total_loans * random.uniform(0.005, 0.015)
    pd90 = total_loans * random.uniform(0.002, 0.008)

    # Income (annualized, then scaled to YTD based on quarter)
    qtrs_in = (quarter_idx % 4) + 1
    nim_rate = random.uniform(0.028, 0.042)
    int_income = total_assets * random.uniform(0.035, 0.055) * (qtrs_in / 4)
    int_expense = total_assets * random.uniform(0.008, 0.022) * (qtrs_in / 4)
    net_ii = int_income - int_expense
    provision = total_loans * random.uniform(0.001, 0.004) * (qtrs_in / 4)
    ni_income = total_assets * random.uniform(0.005, 0.012) * (qtrs_in / 4)
    ni_expense = total_assets * random.uniform(0.018, 0.032) * (qtrs_in / 4)
    net_income = net_ii - provision + ni_income - ni_expense

    # Ratios
    roa = (net_income / total_assets) * (4 / qtrs_in) if total_assets else 0
    roe = (net_income / total_equity) * (4 / qtrs_in) if total_equity else 0
    efficiency = ni_expense / (net_ii + ni_income) if (net_ii + ni_income) else 0
    tier1 = random.uniform(0.10, 0.18)
    total_cap = tier1 + random.uniform(0.01, 0.03)
    leverage = random.uniform(0.08, 0.12)
    ltd = total_loans / total_deposits if total_deposits else 0

    data = {
        "total_assets": round(total_assets, 0),
        "total_loans": round(total_loans, 0),
        "total_deposits": round(total_deposits, 0),
        "total_equity": round(total_equity, 0),
        "total_liabilities": round(total_liabilities, 0),
        "cash_and_equivalents": round(cash, 0),
        "securities": round(securities, 0),
        "residential_re_loans": round(res_re, 0),
        "commercial_re_loans": round(com_re, 0),
        "commercial_industrial_loans": round(ci, 0),
        "consumer_loans": round(consumer, 0),
        "agriculture_loans": round(ag, 0),
        "nonperforming_loans": round(npl, 0),
        "loan_loss_allowance": round(allowance, 0),
        "net_charge_offs": round(nco, 0),
        "past_due_30_89": round(pd30, 0),
        "past_due_90_plus": round(pd90, 0),
        "total_interest_income": round(int_income, 0),
        "total_interest_expense": round(int_expense, 0),
        "net_interest_income": round(net_ii, 0),
        "provision_for_loan_losses": round(provision, 0),
        "noninterest_income": round(ni_income, 0),
        "noninterest_expense": round(ni_expense, 0),
        "net_income": round(net_income, 0),
        "roa": round(roa, 4),
        "roe": round(roe, 4),
        "net_interest_margin": round(nim_rate, 4),
        "efficiency_ratio": round(efficiency, 4),
        "tier1_capital_ratio": round(tier1, 4),
        "total_capital_ratio": round(total_cap, 4),
        "leverage_ratio": round(leverage, 4),
        "npl_ratio": round(npl_rate, 4),
        "loan_to_deposit_ratio": round(ltd, 4),
    }

    # Credit union specifics
    if inst_type == "credit_union":
        members_base = int(total_assets / random.uniform(8, 18))
        data["member_count"] = int(members_base * (1 + 0.005 * quarter_idx))
        data["net_worth_ratio"] = round(total_equity / total_assets, 4) if total_assets else 0
        data["delinquency_ratio"] = round(random.uniform(0.004, 0.020), 4)

    return data


def seed_sample_data(num_banks=50, num_credit_unions=50):
    """Generate and insert realistic sample data."""
    init_db()
    conn = get_sync_connection()
    cursor = conn.cursor()

    # Check if data already exists
    cursor.execute("SELECT COUNT(*) FROM institutions")
    if cursor.fetchone()[0] > 0:
        print("⚠ Data already exists. Skipping seed.")
        conn.close()
        return

    print(f"Seeding {num_banks} banks and {num_credit_unions} credit unions...")

    institution_id = 0

    # ── Insert banks ────────────────────────────────────────────────────
    for i in range(num_banks):
        institution_id += 1
        cert = str(random.randint(10000, 99999))
        name = BANK_NAMES[i % len(BANK_NAMES)]
        if i >= len(BANK_NAMES):
            name = f"{name} #{i - len(BANK_NAMES) + 2}"
        state = random.choice(STATES)
        city = random.choice(CITIES)
        tier = random.choices(["small", "mid", "large"], weights=[0.6, 0.3, 0.1])[0]

        cursor.execute("""
            INSERT INTO institutions (cert_or_cu_number, institution_type, name, city, state, charter_type)
            VALUES (?, 'bank', ?, ?, ?, ?)
        """, (cert, name, city, state, random.choice(["National", "State Member", "State Non-Member"])))

        inst_id = cursor.lastrowid

        # Generate 8 quarters of data
        for q_idx, report_date in enumerate(REPORT_DATES):
            fin = _generate_financial_data("bank", tier, q_idx)
            cols = ", ".join(fin.keys())
            placeholders = ", ".join(["?"] * len(fin))
            values = list(fin.values())

            cursor.execute(f"""
                INSERT INTO financial_data (institution_id, report_date, {cols})
                VALUES (?, ?, {placeholders})
            """, [inst_id, report_date] + values)

        # Update latest assets
        cursor.execute("""
            UPDATE institutions SET total_assets_latest = (
                SELECT total_assets FROM financial_data
                WHERE institution_id = ? ORDER BY report_date DESC LIMIT 1
            ) WHERE id = ?
        """, (inst_id, inst_id))

    # ── Insert credit unions ────────────────────────────────────────────
    for i in range(num_credit_unions):
        institution_id += 1
        cu_num = str(random.randint(60000, 99999))
        name = CU_NAMES[i % len(CU_NAMES)]
        if i >= len(CU_NAMES):
            name = f"{name} #{i - len(CU_NAMES) + 2}"
        state = random.choice(STATES)
        city = random.choice(CITIES)
        tier = random.choices(["small", "mid", "large"], weights=[0.65, 0.25, 0.1])[0]

        cursor.execute("""
            INSERT INTO institutions (cert_or_cu_number, institution_type, name, city, state, charter_type)
            VALUES (?, 'credit_union', ?, ?, ?, ?)
        """, (cu_num, name, city, state, random.choice(["Federal", "State"])))

        inst_id = cursor.lastrowid

        for q_idx, report_date in enumerate(REPORT_DATES):
            fin = _generate_financial_data("credit_union", tier, q_idx)
            cols = ", ".join(fin.keys())
            placeholders = ", ".join(["?"] * len(fin))
            values = list(fin.values())

            cursor.execute(f"""
                INSERT INTO financial_data (institution_id, report_date, {cols})
                VALUES (?, ?, {placeholders})
            """, [inst_id, report_date] + values)

        cursor.execute("""
            UPDATE institutions SET total_assets_latest = (
                SELECT total_assets FROM financial_data
                WHERE institution_id = ? ORDER BY report_date DESC LIMIT 1
            ) WHERE id = ?
        """, (inst_id, inst_id))

    # ── Insert peer groups ──────────────────────────────────────────────
    peer_groups = [
        ("Community Banks < $500M", "Small community banks", "bank", 0, 500000, None),
        ("Community Banks $500M - $2B", "Mid-size community banks", "bank", 500000, 2000000, None),
        ("Community Banks $2B - $10B", "Large community banks", "bank", 2000000, 10000000, None),
        ("Credit Unions < $500M", "Small credit unions", "credit_union", 0, 500000, None),
        ("Credit Unions $500M - $2B", "Mid-size credit unions", "credit_union", 500000, 2000000, None),
        ("Credit Unions > $2B", "Large credit unions", "credit_union", 2000000, 100000000, None),
        ("All Institutions", "All banks and credit unions", "all", 0, 100000000, None),
    ]
    for pg in peer_groups:
        cursor.execute("""
            INSERT INTO peer_groups (name, description, institution_type, asset_min, asset_max, state)
            VALUES (?, ?, ?, ?, ?, ?)
        """, pg)

    conn.commit()
    conn.close()

    total = num_banks + num_credit_unions
    print(f"✓ Seeded {total} institutions × {len(REPORT_DATES)} quarters = {total * len(REPORT_DATES)} financial records")


# ── Production data download stubs ──────────────────────────────────────
async def download_ffiec_data(report_period: str):
    """
    Download FFIEC bulk call report data for a given period.
    In production, this hits cdr.ffiec.gov or the FDIC API.
    """
    # TODO: Implement real download
    # URL pattern: https://cdr.ffiec.gov/public/PWS/DownloadBulkData.aspx
    # Params: DType=Call&RDate={report_period}&FType=CSV
    raise NotImplementedError("Production FFIEC download not yet implemented")


async def download_ncua_data(report_period: str):
    """
    Download NCUA 5300 call report data for a given period.
    In production, this fetches from ncua.gov quarterly data files.
    """
    # TODO: Implement real download
    # URL pattern: https://ncua.gov/files/publications/analysis/call-report-data-{period}.zip
    raise NotImplementedError("Production NCUA download not yet implemented")


if __name__ == "__main__":
    seed_sample_data()
