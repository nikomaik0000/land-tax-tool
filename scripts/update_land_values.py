#!/usr/bin/env python3
"""Update Taipei and New Taipei full land-value CSV files independently."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
MATERIAL = ROOT / "material"
METADATA_PATH = MATERIAL / "land-value-metadata.json"
TAIPEI_PAGE = "https://data.taipei/dataset/detail?id=7ac6eac3-a998-43ff-a289-6a4e3203c2c3"
NEW_TAIPEI_CATALOG = "https://data.ntpc.gov.tw/api/datasets/info/csv"
NEW_TAIPEI_ZIP = "https://data.ntpc.gov.tw/api/datasets/{dataset_id}/csv/zip"
TIMEOUT = 90
HEADERS = {"User-Agent": "land-tax-tool-data-updater/1.0"}

ALIASES = {
    "district": {"行政區", "區", "district"},
    "segment": {"段小段", "段名", "segment"},
    "landNumber": {"地號", "lid", "landno"},
    "officialValue": {"公告土地現值新臺幣元每平方公尺", "公告土地現值", "公告現值", "officialvaluebusiprval"},
    "officialPrice": {"公告地價新臺幣元每平方公尺", "公告地價", "officialpricebusiprval"},
}


def normalize_header(value: str) -> str:
    return re.sub(r"[\s\u3000（）()／/_-]+", "", value.replace("\ufeff", "")).lower()


NORMALIZED_ALIASES = {key: {normalize_header(value) for value in values} for key, values in ALIASES.items()}


def load_metadata() -> dict:
    if not METADATA_PATH.exists():
        return {}
    return json.loads(METADATA_PATH.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reject_error_content(data: bytes, content_type: str, label: str) -> None:
    prefix = data[:512].lstrip().lower()
    if "html" in content_type.lower() or prefix.startswith((b"<!doctype html", b"<html", b"{\"error", b"request rejected")):
        raise ValueError(f"{label} download returned an HTML/JSON error page")


def decode_csv(data: bytes, encodings: tuple[str, ...]) -> tuple[str, str]:
    for encoding in encodings:
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError(f"CSV cannot be decoded with: {', '.join(encodings)}")


def validate_csv(data: bytes, encodings: tuple[str, ...], previous_path: Path, minimum_rows: int = 100) -> dict:
    text, encoding = decode_csv(data, encodings)
    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader)
    except StopIteration as error:
        raise ValueError("CSV is empty") from error
    normalized = {normalize_header(value) for value in header}
    missing = [key for key, aliases in NORMALIZED_ALIASES.items() if not normalized.intersection(aliases)]
    if missing:
        raise ValueError(f"CSV missing required field mappings: {', '.join(missing)}")
    row_count = sum(1 for row in reader if any(str(cell).strip() for cell in row))
    if row_count < minimum_rows:
        raise ValueError(f"CSV row count is unexpectedly small: {row_count}")
    previous_rows = 0
    if previous_path.exists():
        with previous_path.open("rb") as stream:
            previous_rows = max(0, sum(1 for _ in stream) - 1)
        if previous_rows and row_count < previous_rows * 0.2:
            raise ValueError(f"CSV row count fell by more than 80% ({previous_rows} -> {row_count})")
    return {"encoding": "big5" if encoding in {"big5", "cp950"} else "utf-8", "rowCount": row_count}


def atomic_write(data: bytes, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".new")
    temporary.write_bytes(data)
    os.replace(temporary, target)


def discover_taipei(session: requests.Session) -> dict:
    response = session.get(TAIPEI_PAGE, timeout=TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    candidates = []
    for row in soup.find_all("tr"):
        text = row.get_text(" ", strip=True)
        match = re.search(r"臺北市(\d{2,3})年公告現值(?:公告地價)?", text)
        if not match:
            continue
        link = row.find("a", href=True)
        if link:
            candidates.append((int(match.group(1)), urljoin(TAIPEI_PAGE, link["href"])))
    if not candidates:
        raise ValueError("Unable to discover Taipei annual CSV resource")
    year, url = max(candidates, key=lambda item: item[0])
    return {"year": year, "url": url}


def discover_new_taipei(session: requests.Session) -> dict:
    response = session.get(NEW_TAIPEI_CATALOG, timeout=TIMEOUT)
    response.raise_for_status()
    reject_error_content(response.content, response.headers.get("Content-Type", ""), "New Taipei catalog")
    text, _ = decode_csv(response.content, ("utf-8-sig", "utf-8"))
    candidates = []
    for row in csv.DictReader(io.StringIO(text, newline="")):
        name = row.get("資料集名稱", "")
        match = re.fullmatch(r"新北市(\d{2,3})年公告土地現值及公告地價", name.strip())
        if match:
            candidates.append((int(match.group(1)), row.get("識別碼", "").strip().lower(), row.get("資料集網址", "").strip()))
    if not candidates:
        raise ValueError("Unable to discover New Taipei annual dataset")
    year, dataset_id, page_url = max(candidates, key=lambda item: item[0])
    return {"year": year, "datasetId": dataset_id, "pageUrl": page_url, "url": NEW_TAIPEI_ZIP.format(dataset_id=dataset_id)}


def download(session: requests.Session, url: str, label: str) -> tuple[bytes, requests.Response]:
    response = session.get(url, timeout=TIMEOUT)
    response.raise_for_status()
    reject_error_content(response.content, response.headers.get("Content-Type", ""), label)
    return response.content, response


def update_taipei(session: requests.Session, metadata: dict) -> tuple[bool, dict]:
    discovered = discover_taipei(session)
    current_year = int(metadata.get("year", 0) or 0)
    if discovered["year"] <= current_year:
        print(f"Taipei has no newer annual dataset ({discovered['year']}).")
        return False, metadata
    data, response = download(session, discovered["url"], "Taipei")
    target = MATERIAL / "taipei_value.csv"
    details = validate_csv(data, ("big5", "cp950", "utf-8-sig"), target)
    with tempfile.NamedTemporaryFile(prefix="taipei-new-", suffix=".csv", dir="/tmp", delete=False) as handle:
        temp_path = Path(handle.name); handle.write(data)
    try:
        if target.exists() and sha256(temp_path) == sha256(target):
            print("Taipei CSV content is unchanged.")
            return False, metadata
        atomic_write(data, target)
    finally:
        temp_path.unlink(missing_ok=True)
    return True, {"year": discovered["year"], "source": "臺北市政府地政局", "sourceUrl": discovered["url"], "datasetPage": TAIPEI_PAGE, "updatedAt": datetime.now(timezone.utc).date().isoformat(), "officialLastModified": response.headers.get("Last-Modified", ""), "sha256": sha256(target), **details}


def update_new_taipei(session: requests.Session, metadata: dict) -> tuple[bool, dict]:
    discovered = discover_new_taipei(session)
    current_year = int(metadata.get("year", 0) or 0)
    if discovered["year"] <= current_year:
        print(f"New Taipei has no newer annual dataset ({discovered['year']}).")
        return False, metadata
    archive, response = download(session, discovered["url"], "New Taipei")
    if not zipfile.is_zipfile(io.BytesIO(archive)):
        raise ValueError("New Taipei full download is not a valid ZIP archive")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        members = [name for name in bundle.namelist() if name.lower().endswith(".csv") and not name.endswith("/")]
        if not members:
            raise ValueError("New Taipei ZIP contains no CSV")
        data = max((bundle.read(name) for name in members), key=len)
    target = MATERIAL / "newtaipei_value.csv"
    details = validate_csv(data, ("utf-8-sig", "utf-8", "cp950", "big5"), target, minimum_rows=100_000)
    with tempfile.NamedTemporaryFile(prefix="newtaipei-new-", suffix=".csv", dir="/tmp", delete=False) as handle:
        temp_path = Path(handle.name); handle.write(data)
    try:
        if target.exists() and sha256(temp_path) == sha256(target):
            print("New Taipei CSV content is unchanged.")
            return False, metadata
        atomic_write(data, target)
    finally:
        temp_path.unlink(missing_ok=True)
    return True, {"year": discovered["year"], "source": "新北市政府地政局", "sourceUrl": discovered["url"], "datasetPage": discovered["pageUrl"], "updatedAt": datetime.now(timezone.utc).date().isoformat(), "officialLastModified": response.headers.get("Last-Modified", ""), "sha256": sha256(target), **details}


def update_all() -> int:
    session = requests.Session(); session.headers.update(HEADERS)
    metadata = load_metadata()
    failures = []
    changed = False
    for key, updater in (("taipei", update_taipei), ("newTaipei", update_new_taipei)):
        try:
            city_changed, city_metadata = updater(session, metadata.get(key, {}))
            metadata[key] = city_metadata
            changed = changed or city_changed
        except Exception as error:  # cities intentionally update independently
            failures.append(f"{key}: {error}")
            print(f"::error::{key} update failed: {error}")
    if changed:
        METADATA_PATH.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures:
        print("One or more city updates failed; successful city updates were kept.")
        return 1
    if not changed:
        print("No land-value files changed.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-existing", action="store_true")
    args = parser.parse_args()
    if args.validate_existing:
        print(validate_csv((MATERIAL / "taipei_value.csv").read_bytes(), ("big5", "cp950", "utf-8-sig"), MATERIAL / "taipei_value.csv"))
        print(validate_csv((MATERIAL / "newtaipei_value.csv").read_bytes(), ("utf-8-sig", "utf-8", "cp950"), MATERIAL / "newtaipei_value.csv", minimum_rows=100_000))
        raise SystemExit(0)
    raise SystemExit(update_all())
