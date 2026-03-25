#!/usr/bin/env python3
"""
Import NCUA quarterly ZIP raw files into the local SQLite schema.

Expected input files (from download script):
  call-report-data-YYYY-MM.zip
"""

from __future__ import annotations

import argparse
import csv
import io
import pathlib
import re
import sqlite3
import zipfile

from database import DATABASE_PATH, init_db

ZIP_NAME_RE = re.compile(r"call-report-data-(\d{4})-(03|06|09|12)\.zip$", re.IGNORECASE)
QUARTER_END_DAY = {"03": "31", "06": "30", "09": "30", "12": "31"}


def parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    s = str(value).strip().replace(",", "")
    if s == "" or s.lower() in {"none", "null", "nan"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def safe_div(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def normalize_ratio(value: float | None) -> float | None:
    """
    Normalize ratio-like values to decimal form.

    NCUA ratio fields are often reported in basis-points-like percent units
    (e.g. 1136 => 11.36% => 0.1136 decimal).
    If value > 1, divide by 10,000 to normalize to decimal.
    """
    if value is None:
        return None
    return value / 10000.0 if value > 1 else value


def qtr_report_date_from_name(zip_name: str) -> str:
    m = ZIP_NAME_RE.search(zip_name)
    if not m:
        raise ValueError(f"Unexpected ZIP file name format: {zip_name}")
    year, mm = m.group(1), m.group(2)
    return f"{year}-{mm}-{QUARTER_END_DAY[mm]}"


def load_csv_from_zip(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    raw = zf.read(name).decode("utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(raw)))


def normalize_row_keys(row: dict[str, str]) -> dict[str, str]:
    """Normalize CSV row keys to uppercase for stable account lookups."""
    out: dict[str, str] = {}
    for k, v in row.items():
        if k is None:
            continue
        out[str(k).strip().upper()] = v
    return out


def acct_value(row: dict[str, str], code: str) -> float | None:
    return parse_number(row.get(code.upper()))


def list_ncua_zip_files(raw_dir: pathlib.Path) -> list[pathlib.Path]:
    files = [p for p in raw_dir.glob("call-report-data-*.zip") if p.is_file()]
    return sorted(files, key=lambda p: p.name)


def upsert_institutions(
    conn: sqlite3.Connection,
    foicu_rows: list[dict[str, str]],
) -> dict[str, int]:
    cur = conn.cursor()
    for r in foicu_rows:
        cu_number = str(r.get("CU_NUMBER", "")).strip()
        if not cu_number:
            continue
        cur.execute(
            """
            INSERT INTO institutions
                (cert_or_cu_number, institution_type, name, city, state, charter_type, active)
            VALUES
                (?, 'credit_union', ?, ?, ?, ?, 1)
            ON CONFLICT(cert_or_cu_number) DO UPDATE SET
                name = excluded.name,
                city = excluded.city,
                state = excluded.state,
                charter_type = excluded.charter_type,
                active = 1
            """,
            (
                cu_number,
                (r.get("CU_NAME") or "").strip()[:255],
                (r.get("CITY") or "").strip()[:120],
                (r.get("STATE") or "").strip()[:10],
                (r.get("CU_TYPE") or "").strip()[:50],
            ),
        )

    conn.commit()

    mapping: dict[str, int] = {}
    cur.execute(
        """
        SELECT id, cert_or_cu_number
        FROM institutions
        WHERE institution_type = 'credit_union'
        """
    )
    for inst_id, cert in cur.fetchall():
        mapping[str(cert)] = int(inst_id)
    return mapping


def import_zip_file(
    conn: sqlite3.Connection,
    zip_path: pathlib.Path,
    replace_quarter: bool = False,
) -> tuple[int, int]:
    report_date = qtr_report_date_from_name(zip_path.name)
    print(f"Importing {zip_path.name} as report_date={report_date}")

    with zipfile.ZipFile(zip_path) as zf:
        foicu_rows = load_csv_from_zip(zf, "FOICU.txt")
        fs220_rows = load_csv_from_zip(zf, "FS220.txt")
        fs220a_rows = load_csv_from_zip(zf, "FS220A.txt")

    institution_id_by_cert = upsert_institutions(conn, foicu_rows)

    fs220_by_cu: dict[str, dict[str, str]] = {}
    for r in fs220_rows:
        cu_number = str(r.get("CU_NUMBER", "")).strip()
        if cu_number:
            fs220_by_cu[cu_number] = normalize_row_keys(r)
    for r in fs220a_rows:
        cu_number = str(r.get("CU_NUMBER", "")).strip()
        if cu_number:
            fs220_by_cu.setdefault(cu_number, {}).update(normalize_row_keys(r))

    cur = conn.cursor()
    inserted = 0
    updated = 0

    for cu_number, inst_id in institution_id_by_cert.items():
        row = fs220_by_cu.get(cu_number)
        if not row:
            continue

        total_assets = acct_value(row, "ACCT_010")
        total_loans = acct_value(row, "ACCT_025B")
        total_deposits = acct_value(row, "ACCT_018")
        total_equity = acct_value(row, "ACCT_997")  # Total Net Worth for CUs
        total_liabilities = (
            (total_assets - total_equity)
            if (total_assets is not None and total_equity is not None)
            else None
        )

        loan_loss_allowance = acct_value(row, "ACCT_719")
        past_due_30_89 = acct_value(row, "ACCT_020B")  # 1 to < 2 months delinquent
        past_due_90_plus = acct_value(row, "ACCT_041B")  # >= 2 months delinquent
        nonperforming_loans = acct_value(row, "ACCT_041B")

        charge_offs_ytd = acct_value(row, "ACCT_550")
        recoveries_ytd = acct_value(row, "ACCT_551")
        net_charge_offs = (
            (charge_offs_ytd - recoveries_ytd)
            if (charge_offs_ytd is not None and recoveries_ytd is not None)
            else None
        )

        total_interest_income = acct_value(row, "ACCT_115")
        total_interest_expense = acct_value(row, "ACCT_350")
        net_interest_income = None
        if total_interest_income is not None and total_interest_expense is not None:
            net_interest_income = total_interest_income - total_interest_expense

        provision_for_loan_losses = acct_value(row, "ACCT_300")
        noninterest_income = acct_value(row, "ACCT_117")
        noninterest_expense = acct_value(row, "ACCT_671")
        net_income = acct_value(row, "ACCT_661A")

        member_count = acct_value(row, "ACCT_083")
        net_worth_ratio = normalize_ratio(acct_value(row, "ACCT_998"))
        delinquency_ratio = safe_div(nonperforming_loans, total_loans)

        roa = safe_div(net_income, total_assets)
        roe = safe_div(net_income, total_equity)
        nim = safe_div(net_interest_income, total_assets)
        efficiency_ratio = safe_div(
            noninterest_expense,
            (net_interest_income + noninterest_income)
            if (net_interest_income is not None and noninterest_income is not None)
            else None,
        )
        npl_ratio = safe_div(nonperforming_loans, total_loans)
        loan_to_deposit_ratio = safe_div(total_loans, total_deposits)

        if replace_quarter:
            cur.execute(
                "DELETE FROM financial_data WHERE institution_id = ? AND report_date = ?",
                (inst_id, report_date),
            )

        cur.execute(
            """
            INSERT OR REPLACE INTO financial_data (
                institution_id, report_date,
                total_assets, total_loans, total_deposits, total_equity, total_liabilities,
                nonperforming_loans, loan_loss_allowance, net_charge_offs,
                past_due_30_89, past_due_90_plus,
                total_interest_income, total_interest_expense, net_interest_income,
                provision_for_loan_losses, noninterest_income, noninterest_expense, net_income,
                roa, roe, net_interest_margin, efficiency_ratio,
                tier1_capital_ratio, total_capital_ratio, leverage_ratio,
                npl_ratio, loan_to_deposit_ratio,
                member_count, net_worth_ratio, delinquency_ratio
            ) VALUES (
                ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?,
                ?, ?, ?
            )
            """,
            (
                inst_id,
                report_date,
                total_assets,
                total_loans,
                total_deposits,
                total_equity,
                total_liabilities,
                nonperforming_loans,
                loan_loss_allowance,
                net_charge_offs,
                past_due_30_89,
                past_due_90_plus,
                total_interest_income,
                total_interest_expense,
                net_interest_income,
                provision_for_loan_losses,
                noninterest_income,
                noninterest_expense,
                net_income,
                roa,
                roe,
                nim,
                efficiency_ratio,
                net_worth_ratio,  # Placeholder for Tier1-equivalent in CU context
                net_worth_ratio,  # Placeholder for total capital ratio
                net_worth_ratio,  # Placeholder for leverage ratio
                npl_ratio,
                loan_to_deposit_ratio,
                int(member_count) if member_count is not None else None,
                net_worth_ratio,
                delinquency_ratio,
            ),
        )
        inserted += 1

    # Refresh latest total_assets_latest for CU institutions
    cur.execute(
        """
        UPDATE institutions
        SET total_assets_latest = (
            SELECT fd.total_assets
            FROM financial_data fd
            WHERE fd.institution_id = institutions.id
            ORDER BY fd.report_date DESC
            LIMIT 1
        )
        WHERE institution_type = 'credit_union'
        """
    )

    conn.commit()
    return inserted, updated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import NCUA quarterly ZIP files into SQLite financial_data.",
    )
    parser.add_argument(
        "--raw-dir",
        default="./data/ncua_raw",
        help="Directory containing call-report-data-YYYY-MM.zip files (default: ./data/ncua_raw)",
    )
    parser.add_argument(
        "--database-path",
        default=DATABASE_PATH,
        help=f"SQLite DB path (default: {DATABASE_PATH})",
    )
    parser.add_argument(
        "--replace-quarter",
        action="store_true",
        help="Delete existing rows for each institution/report_date before insert.",
    )
    parser.add_argument(
        "--limit-files",
        type=int,
        default=0,
        help="For testing: only import first N zip files.",
    )
    parser.add_argument(
        "--truncate-credit-unions",
        action="store_true",
        help="Delete existing credit_union rows in institutions/financial_data before import.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    raw_dir = pathlib.Path(args.raw_dir).resolve()
    if not raw_dir.exists():
        print(f"error: raw directory not found: {raw_dir}")
        return 1

    init_db()
    zip_files = list_ncua_zip_files(raw_dir)
    if args.limit_files > 0:
        zip_files = zip_files[: args.limit_files]

    if not zip_files:
        print(f"error: no call-report-data-*.zip files found in {raw_dir}")
        return 1

    conn = sqlite3.connect(args.database_path)
    total_inserted = 0
    try:
        if args.truncate_credit_unions:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM financial_data WHERE institution_id IN (SELECT id FROM institutions WHERE institution_type='credit_union')"
            )
            cur.execute("DELETE FROM institutions WHERE institution_type='credit_union'")
            conn.commit()
            print("cleared existing credit_union data")

        for zf in zip_files:
            inserted, _updated = import_zip_file(
                conn=conn,
                zip_path=zf,
                replace_quarter=args.replace_quarter,
            )
            print(f"  rows imported: {inserted:,}")
            total_inserted += inserted
    finally:
        conn.close()

    print(f"done: imported {len(zip_files)} files, {total_inserted:,} quarterly CU rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

