#!/usr/bin/env python3
"""Build browser-ready New Taipei land-number conversion data from 9 official ZIPs."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import tempfile
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "material" / "land-number" / "new-taipei"
TAIPEI_OUTPUT_DIR = ROOT / "material" / "land-number" / "taipei"
SOURCE_UPDATED_THROUGH = "114-12-31"
TAIPEI_DATASET_ID = "05359dfb-6347-4e0a-ad84-34b306896756"
TAIPEI_RESOURCE_ID = "900696f2-7202-4501-97cf-fbcd6c72ddfe"
TAIPEI_SOURCE_UPDATED_AT = "2023-12-21T10:14:02+08:00"
TAIPEI_MIN_ROWS = 100_000
MIN_RETAINED_RATIO = 0.20
FIELDS = (
    "districtNew", "sectionNew", "subsectionNew", "landNumberNew",
    "districtOld", "sectionOld", "subsectionOld", "landNumberOld",
)
REQUIRED_SOURCE_FIELDS = {
    "district_new", "section_new", "num_new",
    "district_old", "section_old", "num_old",
}

SOURCES = (
    ("banqiao", "板橋地政事務所", "CFA39D71-E79D-43AE-8602-00D29AEB7A3E"),
    ("xinzhuang", "新莊地政事務所", "00c1324c-05b4-4497-bb32-4fca669ad6e7"),
    ("sanchong", "三重地政事務所", "2fec184a-e122-4142-9f7e-a7cc2c24dc3f"),
    ("zhonghe", "中和地政事務所", "440A7BB7-B798-4301-BE0C-56DE87213283"),
    ("xindian", "新店地政事務所", "459b08ab-aebb-49fd-9d1f-f50ecf8acad6"),
    ("shulin", "樹林地政事務所", "f74713e5-97d3-4275-85ed-9d7922f7aaf9"),
    ("xizhi", "汐止地政事務所", "3005f2b0-7552-4093-ae7d-1d8b68093aa3"),
    ("tamsui", "淡水地政事務所", "cfae996c-bf75-4bc7-8411-894cd0428d22"),
    ("ruifang", "瑞芳地政事務所", "e2cd8451-c654-43d4-9b27-8991cebbe94a"),
)

DISTRICT_SLUGS = {
    "板橋區": "banqiao", "三重區": "sanchong", "中和區": "zhonghe", "永和區": "yonghe",
    "新莊區": "xinzhuang", "新店區": "xindian", "土城區": "tucheng", "蘆洲區": "luzhou",
    "樹林區": "shulin", "汐止區": "xizhi", "鶯歌區": "yingge", "三峽區": "sanxia",
    "淡水區": "tamsui", "瑞芳區": "ruifang", "五股區": "wugu", "泰山區": "taishan",
    "林口區": "linkou", "深坑區": "shenkeng", "石碇區": "shiding", "坪林區": "pinglin",
    "三芝區": "sanzhi", "石門區": "shimen", "八里區": "bali", "平溪區": "pingxi",
    "雙溪區": "shuangxi", "貢寮區": "gongliao", "金山區": "jinshan", "萬里區": "wanli",
    "烏來區": "wulai",
}

TAIPEI_DISTRICT_SLUGS = {
    "中正區": "zhongzheng", "大同區": "datong", "中山區": "zhongshan", "松山區": "songshan",
    "大安區": "daan", "萬華區": "wanhua", "信義區": "xinyi", "士林區": "shilin",
    "北投區": "beitou", "內湖區": "neihu", "南港區": "nangang", "文山區": "wenshan",
}
TAIPEI_REQUIRED_FIELDS = {"行政區", "新段名", "新母地號", "新子地號", "舊段名", "舊母地號", "舊子地號"}


def clean_text(value: object) -> str:
    return re.sub(r"[\s\u3000]+", "", unicodedata.normalize("NFKC", str(value or ""))).strip()


def normalize_district(value: object) -> str:
    text = clean_text(value).removeprefix("新北市")
    return text if text.endswith("區") else f"{text}區" if text else ""


def split_section_and_subsection(value: object) -> tuple[str, str]:
    text = clean_text(value)
    match = re.match(r"^(.*?段)([^段]+小段)$", text)
    if match:
        return match.group(1).removesuffix("段"), match.group(2).removesuffix("小段")
    return text.removesuffix("段"), ""


def normalize_land_number(value: object) -> str:
    text = clean_text(value)
    if re.fullmatch(r"\d{8}", text):
        main, sub = int(text[:4]), int(text[4:])
        return str(main) if sub == 0 else f"{main}-{sub}"
    match = re.fullmatch(r"(\d+)(?:-(\d+))?", text)
    if not match:
        return text
    main = int(match.group(1))
    sub = int(match.group(2) or 0)
    return str(main) if sub == 0 else f"{main}-{sub}"


def normalize_row(row: dict[str, str]) -> tuple[str, ...] | None:
    section_new, subsection_new = split_section_and_subsection(row["section_new"])
    section_old, subsection_old = split_section_and_subsection(row["section_old"])
    result = (
        normalize_district(row["district_new"]), section_new, subsection_new, normalize_land_number(row["num_new"]),
        normalize_district(row["district_old"]), section_old, subsection_old, normalize_land_number(row["num_old"]),
    )
    return result if all((result[0], result[1], result[3], result[4], result[5], result[7])) else None


def combine_land_number(main: object, sub: object) -> str:
    main_text = clean_text(main)
    sub_text = clean_text(sub) or "0"
    return normalize_land_number(f"{int(main_text):04d}{int(sub_text):04d}") if main_text.isdigit() and sub_text.isdigit() else ""


def normalize_taipei_row(row: dict[str, str]) -> tuple[str, ...] | None:
    district = normalize_district(row["行政區"])
    section_new, subsection_new = split_section_and_subsection(row["新段名"])
    section_old, subsection_old = split_section_and_subsection(row["舊段名"])
    result = (
        district, section_new, subsection_new, combine_land_number(row["新母地號"], row["新子地號"]),
        district, section_old, subsection_old, combine_land_number(row["舊母地號"], row["舊子地號"]),
    )
    return result if all((result[0], result[1], result[3], result[4], result[5], result[7])) else None


def source_urls(dataset_id: str) -> tuple[str, str]:
    page = f"https://data.ntpc.gov.tw/datasets/{dataset_id}"
    return page, f"https://data.ntpc.gov.tw/api/datasets/{dataset_id}/csv/zip"


def read_zip(zip_bytes: bytes, source_name: str) -> tuple[list[tuple[str, ...]], str, int]:
    digest = hashlib.sha256(zip_bytes).hexdigest()
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv") and not name.endswith("/")]
            if len(csv_names) != 1:
                raise ValueError(f"expected exactly one CSV, found {len(csv_names)}")
            raw = archive.read(csv_names[0])
    except (zipfile.BadZipFile, KeyError) as error:
        raise ValueError(f"invalid ZIP: {error}") from error
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("CSV is not valid UTF-8") from error
    reader = csv.DictReader(io.StringIO(text, newline=""))
    headers = set(reader.fieldnames or [])
    missing = REQUIRED_SOURCE_FIELDS - headers
    if missing:
        raise ValueError(f"missing fields: {', '.join(sorted(missing))}")
    normalized = []
    source_rows = 0
    for row in reader:
        source_rows += 1
        item = normalize_row(row)
        if item:
            normalized.append(item)
    if source_rows <= 0 or not normalized:
        raise ValueError("CSV contains no usable rows")
    print(f"{source_name}: {source_rows:,} source rows, {len(normalized):,} normalized rows")
    return normalized, digest, source_rows


def read_previous_manifest() -> dict:
    return read_manifest(OUTPUT_DIR)


def read_manifest(output_dir: Path) -> dict:
    path = output_dir / "manifest.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def validate_previous_counts(source_key: str, new_count: int, previous: dict) -> None:
    old = next((item for item in previous.get("sources", []) if item.get("key") == source_key), None)
    old_count = int(old.get("rows", 0)) if old else 0
    if old_count and new_count < old_count * MIN_RETAINED_RATIO:
        raise ValueError(f"{source_key} row count fell from {old_count:,} to {new_count:,}")


def dataset_hash(rows: set[tuple[str, ...]]) -> str:
    digest = hashlib.sha256()
    for row in sorted(rows):
        digest.update("\x1f".join(row).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def write_bundle(target: Path, rows: set[tuple[str, ...]], source_meta: list[dict], content_hash: str) -> None:
    district_rows: dict[str, set[tuple[str, ...]]] = defaultdict(set)
    for row in rows:
        # Copy cross-district mappings into both relevant files so either lookup direction can lazy-load one district.
        district_rows[row[0]].add(row)
        district_rows[row[4]].add(row)
    unknown = sorted(set(district_rows) - set(DISTRICT_SLUGS))
    if unknown:
        raise ValueError(f"unknown districts: {', '.join(unknown)}")
    target.mkdir(parents=True, exist_ok=True)
    districts = {}
    for name, slug in DISTRICT_SLUGS.items():
        items = sorted(district_rows.get(name, set()))
        if not items:
            raise ValueError(f"district has no rows: {name}")
        path = target / f"{slug}.csv"
        with path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file, lineterminator="\n")
            writer.writerow(FIELDS)
            writer.writerows(items)
        districts[slug] = {
            "name": name,
            "file": path.name,
            "rows": len(items),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {
        "schemaVersion": 1,
        "city": "新北市",
        "sourceUpdatedThrough": SOURCE_UPDATED_THROUGH,
        "generatedAt": generated_at,
        "totalRows": len(rows),
        "hash": content_hash,
        "districts": districts,
        "sources": source_meta,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def taipei_urls() -> tuple[str, str]:
    page = f"https://data.taipei/dataset/detail?id={TAIPEI_DATASET_ID}"
    download = f"https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid={TAIPEI_RESOURCE_ID}"
    return page, download


def read_taipei_csv(raw: bytes) -> tuple[set[tuple[str, ...]], str, int]:
    if raw.lstrip(b"\xef\xbb\xbf \t\r\n").startswith((b"<", b"{", b"[")):
        raise ValueError("Taipei download is HTML/JSON, not CSV")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Taipei CSV is not valid UTF-8") from error
    reader = csv.DictReader(io.StringIO(text, newline=""))
    headers = set(reader.fieldnames or [])
    missing = TAIPEI_REQUIRED_FIELDS - headers
    if missing:
        raise ValueError(f"Taipei CSV missing fields: {', '.join(sorted(missing))}")
    rows: set[tuple[str, ...]] = set()
    source_rows = 0
    for row in reader:
        source_rows += 1
        item = normalize_taipei_row(row)
        if item:
            rows.add(item)
    if source_rows < TAIPEI_MIN_ROWS or not rows:
        raise ValueError(f"Taipei CSV row count is suspicious: {source_rows:,}")
    print(f"臺北市地政局: {source_rows:,} source rows, {len(rows):,} unique normalized rows")
    return rows, hashlib.sha256(raw).hexdigest(), source_rows


def write_taipei_bundle(target: Path, rows: set[tuple[str, ...]], source_rows: int, source_hash: str, content_hash: str) -> None:
    district_rows: dict[str, set[tuple[str, ...]]] = defaultdict(set)
    for row in rows:
        district_rows[row[0]].add(row)
        district_rows[row[4]].add(row)
    unknown = sorted(set(district_rows) - set(TAIPEI_DISTRICT_SLUGS))
    if unknown:
        raise ValueError(f"unknown Taipei districts: {', '.join(unknown)}")
    target.mkdir(parents=True, exist_ok=True)
    districts = {}
    for name, slug in TAIPEI_DISTRICT_SLUGS.items():
        items = sorted(district_rows.get(name, set()))
        if not items:
            raise ValueError(f"Taipei district has no rows: {name}")
        path = target / f"{slug}.csv"
        with path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file, lineterminator="\n")
            writer.writerow(FIELDS)
            writer.writerows(items)
        districts[slug] = {"name": name, "file": path.name, "rows": len(items), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    page_url, download_url = taipei_urls()
    manifest = {
        "schemaVersion": 1, "city": "臺北市", "datasetId": TAIPEI_DATASET_ID, "resourceId": TAIPEI_RESOURCE_ID,
        "sourceUrl": page_url, "resourceUrl": download_url, "sourceUpdatedAt": TAIPEI_SOURCE_UPDATED_AT,
        "updateFrequency": "不定期", "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sourceRows": source_rows, "totalRows": len(rows), "hash": content_hash, "sourceSha256": source_hash,
        "districts": districts,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def obtain_zip(source_dir: Optional[Path], key: str, dataset_id: str) -> bytes:
    if source_dir:
        path = source_dir / f"{key}.zip"
        if not path.exists():
            raise FileNotFoundError(f"missing local source: {path}")
        return path.read_bytes()
    _, download_url = source_urls(dataset_id)
    request = urllib.request.Request(download_url, headers={"User-Agent": "land-tax-tool-updater/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise ValueError(f"HTTP {response.status}")
        return response.read()


def replace_directory(staging: Path, output_dir: Path) -> None:
    backup = output_dir.with_name(f"{output_dir.name}.previous")
    if backup.exists():
        shutil.rmtree(backup)
    if output_dir.exists():
        output_dir.rename(backup)
    try:
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(staging, output_dir)
    except Exception:
        if output_dir.exists():
            shutil.rmtree(output_dir)
        if backup.exists():
            backup.rename(output_dir)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def run_new_taipei(source_dir: Optional[Path] = None) -> bool:
    previous = read_previous_manifest()
    all_rows: set[tuple[str, ...]] = set()
    source_meta = []
    for key, office, dataset_id in SOURCES:
        page_url, download_url = source_urls(dataset_id)
        zip_bytes = obtain_zip(source_dir, key, dataset_id)
        rows, zip_hash, source_rows = read_zip(zip_bytes, office)
        validate_previous_counts(key, source_rows, previous)
        all_rows.update(rows)
        source_meta.append({
            "key": key, "office": office, "datasetId": dataset_id,
            "sourceUrl": page_url, "downloadUrl": download_url,
            "rows": source_rows, "normalizedRows": len(rows), "zipSha256": zip_hash,
        })
    if len(source_meta) != len(SOURCES):
        raise ValueError("not all 9 sources were validated")
    content_hash = dataset_hash(all_rows)
    if previous.get("hash") == content_hash:
        print("Land-number data is unchanged.")
        return False
    with tempfile.TemporaryDirectory(prefix="land-number-build-") as temp_name:
        staging = Path(temp_name) / "new-taipei"
        write_bundle(staging, all_rows, source_meta, content_hash)
        replace_directory(staging, OUTPUT_DIR)
    print(f"Updated {OUTPUT_DIR} with {len(all_rows):,} unique mappings.")
    return True


def obtain_taipei_csv(source_dir: Optional[Path]) -> bytes:
    if source_dir:
        path = source_dir / "taipei.csv"
        if not path.exists():
            raise FileNotFoundError(f"missing local source: {path}")
        return path.read_bytes()
    _, download_url = taipei_urls()
    request = urllib.request.Request(download_url, headers={"User-Agent": "land-tax-tool-updater/1.0", "Accept": "text/csv,*/*"})
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise ValueError(f"Taipei resource HTTP {response.status}")
        content_type = response.headers.get("Content-Type", "").lower()
        raw = response.read()
        if "html" in content_type or "json" in content_type:
            raise ValueError(f"Taipei resource returned {content_type}")
        return raw


def run_taipei(source_dir: Optional[Path] = None) -> bool:
    previous = read_manifest(TAIPEI_OUTPUT_DIR)
    rows, source_hash, source_rows = read_taipei_csv(obtain_taipei_csv(source_dir))
    old_count = int(previous.get("sourceRows", 0))
    if old_count and source_rows < old_count * MIN_RETAINED_RATIO:
        raise ValueError(f"Taipei row count fell from {old_count:,} to {source_rows:,}")
    content_hash = dataset_hash(rows)
    if previous.get("hash") == content_hash:
        print("Taipei land-number data is unchanged.")
        return False
    with tempfile.TemporaryDirectory(prefix="taipei-land-number-build-") as temp_name:
        staging = Path(temp_name) / "taipei"
        write_taipei_bundle(staging, rows, source_rows, source_hash, content_hash)
        replace_directory(staging, TAIPEI_OUTPUT_DIR)
    print(f"Updated {TAIPEI_OUTPUT_DIR} with {len(rows):,} unique mappings.")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, help="Read <source-key>.zip fixtures instead of downloading")
    parser.add_argument("--city", choices=("all", "new-taipei", "taipei"), default="all")
    args = parser.parse_args()
    failures = []
    if args.city in ("all", "new-taipei"):
        try:
            run_new_taipei(args.source_dir)
        except Exception as error:
            failures.append(f"New Taipei: {error}")
            print(f"ERROR New Taipei: {error}")
    if args.city in ("all", "taipei"):
        try:
            run_taipei(args.source_dir)
        except Exception as error:
            failures.append(f"Taipei: {error}")
            print(f"ERROR Taipei: {error}")
    if failures:
        raise SystemExit("; ".join(failures))


if __name__ == "__main__":
    main()
