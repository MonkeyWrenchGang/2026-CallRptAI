#!/usr/bin/env python3
"""
Download NCUA quarterly call report ZIP files.

Source page:
https://ncua.gov/analysis/credit-union-corporate-call-report-data/quarterly-data
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

NCUA_QUARTERLY_DATA_PAGE = (
    "https://ncua.gov/analysis/credit-union-corporate-call-report-data/quarterly-data"
)
ZIP_LINK_RE = re.compile(
    r"(/files/publications/analysis/call-report-data-(\d{4})-(03|06|09|12)\.zip)",
    re.IGNORECASE,
)
QUARTER_TO_MM = {1: "03", 2: "06", 3: "09", 4: "12"}


def fetch_page(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "CallRptAI-NCUA-Downloader/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def discover_zip_urls(page_html: str) -> dict[tuple[int, int], str]:
    matches = ZIP_LINK_RE.findall(page_html)
    discovered: dict[tuple[int, int], str] = {}
    for rel_path, year_str, mm in matches:
        year = int(year_str)
        quarter = {"03": 1, "06": 2, "09": 3, "12": 4}[mm]
        key = (year, quarter)
        # Keep first match; both "Select" and "Select Revised" may appear.
        if key not in discovered:
            discovered[key] = urllib.parse.urljoin("https://ncua.gov", rel_path)
    return discovered


def download_file(url: str, output_path: pathlib.Path) -> None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "CallRptAI-NCUA-Downloader/1.0"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    output_path.write_bytes(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download NCUA quarterly call report ZIP files.",
    )
    parser.add_argument(
        "--dest",
        default="./data/ncua_raw",
        help="Destination directory for downloaded ZIP files (default: ./data/ncua_raw)",
    )
    parser.add_argument("--year", type=int, help="Year to download (e.g. 2024)")
    parser.add_argument(
        "--quarter",
        type=int,
        choices=[1, 2, 3, 4],
        help="Quarter to download (1..4). Requires --year.",
    )
    parser.add_argument(
        "--latest",
        action="store_true",
        help="Download only the latest available quarter.",
    )
    parser.add_argument(
        "--all-for-year",
        action="store_true",
        help="Download all available quarters for --year.",
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="List available years/quarters discovered on the NCUA page without downloading.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.quarter and not args.year:
        print("error: --quarter requires --year", file=sys.stderr)
        return 2
    if args.all_for_year and not args.year:
        print("error: --all-for-year requires --year", file=sys.stderr)
        return 2

    try:
        html = fetch_page(NCUA_QUARTERLY_DATA_PAGE)
        urls = discover_zip_urls(html)
    except urllib.error.URLError as exc:
        print(f"error: failed to load NCUA page: {exc}", file=sys.stderr)
        return 1

    if not urls:
        print("error: no ZIP links found on NCUA quarterly data page", file=sys.stderr)
        return 1

    available = sorted(urls.keys())
    if args.list_only:
        for year, q in available:
            print(f"{year} Q{q}: {urls[(year, q)]}")
        return 0

    targets: list[tuple[int, int]] = []
    if args.latest:
        targets = [available[-1]]
    elif args.year and args.quarter:
        targets = [(args.year, args.quarter)]
    elif args.year and args.all_for_year:
        targets = [k for k in available if k[0] == args.year]
    elif args.year:
        # If a year is provided without quarter, default to Q4 if present, else latest for that year.
        yearly = [k for k in available if k[0] == args.year]
        if not yearly:
            print(f"error: no NCUA quarterly ZIP found for year {args.year}", file=sys.stderr)
            return 1
        target = (args.year, 4) if (args.year, 4) in urls else yearly[-1]
        targets = [target]
    else:
        # Default behavior: latest quarter.
        targets = [available[-1]]

    dest = pathlib.Path(args.dest).resolve()
    dest.mkdir(parents=True, exist_ok=True)

    ok = 0
    for year, quarter in targets:
        key = (year, quarter)
        url = urls.get(key)
        if not url:
            print(f"warning: not found on page: {year} Q{quarter}")
            continue
        mm = QUARTER_TO_MM[quarter]
        filename = f"call-report-data-{year}-{mm}.zip"
        output_path = dest / filename
        try:
            print(f"downloading {year} Q{quarter} -> {output_path}")
            download_file(url, output_path)
            print(f"ok: {output_path.name} ({output_path.stat().st_size:,} bytes)")
            ok += 1
        except urllib.error.URLError as exc:
            print(f"error: failed downloading {url}: {exc}", file=sys.stderr)

    if ok == 0:
        return 1

    print(f"done: downloaded {ok} file(s) to {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

