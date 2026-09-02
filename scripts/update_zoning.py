#!/usr/bin/env python3
"""Build the browser-ready Taipei parcel zoning lookup from the official CSV."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import tempfile
import unicodedata
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "material" / "zoning" / "taipei"
SOURCE_PAGE = "https://data.taipei/dataset/detail?id=a132a433-db7c-4387-8085-83e6a093b17f"
SOURCE_URL = "https://data.taipei/api/dataset/a132a433-db7c-4387-8085-83e6a093b17f/resource/bed9a0d3-cb43-438e-825b-93810f8f2b9d/download"
MIN_ROWS = 300_000
MIN_RETAINED_RATIO = 0.80
REQUIRED_FIELDS = {"行政區", "大段", "小段", "母號", "子號", "分區說明"}
DISTRICT_SLUGS = {
    "中正區": "zhongzheng", "大同區": "datong", "中山區": "zhongshan", "松山區": "songshan",
    "大安區": "daan", "萬華區": "wanhua", "信義區": "xinyi", "士林區": "shilin",
    "北投區": "beitou", "內湖區": "neihu", "南港區": "nangang", "文山區": "wenshan",
}


def clean(value: object) -> str:
    return re.sub(r"[\s\u3000]+", "", unicodedata.normalize("NFKC", str(value or ""))).strip()


def number(value: object) -> str:
    text = clean(value)
    return str(int(text)) if text.isdigit() else text


def zoning(value: object) -> str:
    return clean(value).rstrip("。")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def previous_rows() -> int:
    try:
        return int(json.loads((OUTPUT_DIR / "manifest.json").read_text(encoding="utf-8"))["rows"])
    except (OSError, KeyError, ValueError, json.JSONDecodeError):
        return 0


def build(source: Path, target: Path) -> dict:
    grouped: dict[str, list[tuple[str, ...]]] = defaultdict(list)
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_FIELDS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"官方 CSV 缺少欄位：{', '.join(sorted(missing))}")
        source_rows = 0
        for row in reader:
            source_rows += 1
            district = clean(row["行政區"])
            item = (district, clean(row["大段"]), number(row["小段"]), number(row["母號"]), number(row["子號"]), zoning(row["分區說明"]))
            if district in DISTRICT_SLUGS and all(item):
                grouped[district].append(item)
    if source_rows < MIN_ROWS:
        raise ValueError(f"官方 CSV 僅 {source_rows:,} 筆，低於安全門檻 {MIN_ROWS:,} 筆")
    old_rows = previous_rows()
    if old_rows and source_rows < old_rows * MIN_RETAINED_RATIO:
        raise ValueError(f"資料筆數由 {old_rows:,} 降至 {source_rows:,}，拒絕覆蓋舊版")
    missing_districts = set(DISTRICT_SLUGS) - set(grouped)
    if missing_districts:
        raise ValueError(f"缺少行政區：{', '.join(sorted(missing_districts))}")

    target.mkdir(parents=True)
    districts = {}
    for district, slug in DISTRICT_SLUGS.items():
        path = target / f"{slug}.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(("district", "section", "subsection", "mainNumber", "subNumber", "zoning"))
            writer.writerows(grouped[district])
        districts[slug] = {"name": district, "file": path.name, "rows": len(grouped[district]), "sha256": sha256(path)}
    manifest = {
        "schemaVersion": 1,
        "city": "臺北市",
        "source": SOURCE_PAGE,
        "downloadUrl": SOURCE_URL,
        "updateFrequency": "每6月",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "rows": source_rows,
        "sourceSha256": sha256(source),
        "districts": districts,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-file", type=Path, help="Use an already downloaded official CSV")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="taipei-zoning-") as workspace:
        workspace_path = Path(workspace)
        source = workspace_path / "source.csv"
        if args.source_file:
            shutil.copyfile(args.source_file, source)
        else:
            request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "land-tax-tool-zoning-updater/1.0"})
            with urllib.request.urlopen(request, timeout=180) as response, source.open("wb") as output:
                shutil.copyfileobj(response, output)
        staged = workspace_path / "bundle"
        manifest = build(source, staged)
        OUTPUT_DIR.parent.mkdir(parents=True, exist_ok=True)
        backup = OUTPUT_DIR.with_name("taipei.previous")
        if backup.exists():
            shutil.rmtree(backup)
        if OUTPUT_DIR.exists():
            OUTPUT_DIR.rename(backup)
        try:
            staged.rename(OUTPUT_DIR)
        except Exception:
            if backup.exists() and not OUTPUT_DIR.exists():
                backup.rename(OUTPUT_DIR)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        print(f"Taipei zoning: {manifest['rows']:,} rows -> {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
