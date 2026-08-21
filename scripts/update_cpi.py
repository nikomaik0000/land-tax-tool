#!/usr/bin/env python3
"""Download, validate and atomically update the bundled tax CPI workbook."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
import xlrd
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "material" / "cpispleym.xls"
METADATA = ROOT / "material" / "cpi-metadata.json"
SOURCE_PAGE = "https://www.stat.gov.tw/cp.aspx?n=2665"
FALLBACK_URL = "https://ws.dgbas.gov.tw/001/Upload/463/relfile/10315/2677/cpispleym.xls"
TARGET_LABEL = "各年月為基期之消費者物價總指數－稅務專用"
MIN_FILE_SIZE = 10_000
TIMEOUT = 30
HEADERS = {"User-Agent": "land-tax-tool-data-updater/1.0"}


def discover_source_url(session: requests.Session) -> str:
    response = session.get(SOURCE_PAGE, timeout=TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    for item in soup.find_all("li"):
        normalized = "".join(item.get_text(" ", strip=True).split())
        if "".join(TARGET_LABEL.split()) not in normalized:
            continue
        for link in item.find_all("a", href=True):
            href = link["href"].strip()
            if href.lower().endswith((".xls", ".xlsx")):
                return urljoin(SOURCE_PAGE, href)
    print("::warning::CPI source page structure changed; using the configured direct URL.")
    return FALLBACK_URL


def looks_like_error_page(path: Path, content_type: str) -> bool:
    prefix = path.read_bytes()[:512].lstrip().lower()
    return "html" in content_type.lower() or prefix.startswith((b"<!doctype html", b"<html", b"{\"error", b"request rejected"))


def validate_workbook(path: Path) -> dict:
    if path.stat().st_size < MIN_FILE_SIZE:
        raise ValueError(f"CPI workbook is unexpectedly small: {path.stat().st_size} bytes")
    workbook = xlrd.open_workbook(path)
    if not workbook.sheet_names():
        raise ValueError("CPI workbook contains no worksheet")
    valid_values = 0
    matched_sheet = ""
    for sheet in workbook.sheets():
        header_row = None
        year_column = None
        month_columns = {}
        for row_index in range(min(sheet.nrows, 40)):
            cells = [str(sheet.cell_value(row_index, column)).replace(" ", "").strip() for column in range(sheet.ncols)]
            if "年" not in cells:
                continue
            months = {month: next((index for index, value in enumerate(cells) if value == f"{month}月"), None) for month in range(1, 13)}
            if all(index is not None for index in months.values()):
                header_row = row_index
                year_column = cells.index("年")
                month_columns = months
                break
        if header_row is None:
            continue
        for row_index in range(header_row + 1, sheet.nrows):
            try:
                year = int(float(sheet.cell_value(row_index, year_column)))
            except (TypeError, ValueError):
                continue
            if not 1 <= year <= 300:
                continue
            for column in month_columns.values():
                value = sheet.cell_value(row_index, column)
                if isinstance(value, (int, float)) and value > 0:
                    valid_values += 1
        matched_sheet = sheet.name
        if valid_values >= 120:
            break
    if valid_values < 120:
        raise ValueError("CPI workbook does not contain a reasonable year/month lookup table")
    return {"sheetName": matched_sheet, "validValues": valid_values}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_replace(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    sibling = target.with_suffix(target.suffix + ".new")
    shutil.copyfile(source, sibling)
    os.replace(sibling, target)


def update() -> bool:
    session = requests.Session()
    session.headers.update(HEADERS)
    source_url = discover_source_url(session)
    with tempfile.NamedTemporaryFile(prefix="cpispleym-new-", suffix=".xls", dir="/tmp", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        response = session.get(source_url, timeout=TIMEOUT, stream=True)
        response.raise_for_status()
        with temporary.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    output.write(chunk)
        if looks_like_error_page(temporary, response.headers.get("Content-Type", "")):
            raise ValueError("CPI download returned an HTML/JSON error page")
        details = validate_workbook(temporary)
        if TARGET.exists() and sha256(temporary) == sha256(TARGET):
            print("CPI data is unchanged; no files were modified.")
            return False
        atomic_replace(temporary, TARGET)
        metadata = {
            "source": "行政院主計總處",
            "sourcePage": SOURCE_PAGE,
            "sourceFile": source_url,
            "updatedAt": datetime.now(timezone.utc).date().isoformat(),
            "officialLastModified": response.headers.get("Last-Modified", ""),
            "sha256": sha256(TARGET),
            **details,
        }
        METADATA.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Updated {TARGET.relative_to(ROOT)} from {source_url}")
        return True
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-existing", action="store_true")
    args = parser.parse_args()
    if args.validate_existing:
        print(json.dumps(validate_workbook(TARGET), ensure_ascii=False))
    else:
        update()
