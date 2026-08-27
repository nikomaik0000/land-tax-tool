import { formatLandNumber } from "./formatters.js";
import { buildLandNumberLookupKey, normalizeCity, normalizeDistrict, splitSectionAndSubsection } from "./land-value-normalization.js";

export const HEADER_ALIASES = Object.freeze({
  city: ["縣市", "縣市別", "城市", "city", "county"],
  district: ["區", "行政區", "district"],
  section: ["段", "段小段", "段名", "segment", "section"],
  subsection: ["小段", "subsection"],
  landNumber: ["地號", "landnumber", "landno", "lid"]
});

export const BUNDLED_FIELDS = Object.freeze([
  "districtNew", "sectionNew", "subsectionNew", "landNumberNew",
  "districtOld", "sectionOld", "subsectionOld", "landNumberOld"
]);

export const normalizeHeaderText = (value) => String(value ?? "").normalize("NFKC").replace(/[\r\n\s　]+/g, "").trim();
const canonical = (value) => normalizeHeaderText(value).replace(/[_()（）／/・,，.。:：-]/g, "").toLowerCase();

function findFieldIndex(headers, aliases) {
  const candidates = aliases.map(canonical);
  return headers.findIndex((header) => candidates.includes(canonical(header)));
}

export function workbookHeaderMap(headers) {
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, findFieldIndex(headers, aliases)]));
}

export function detectLandNumberHeaderRow(rows, scanLimit = 30) {
  for (let index = 0; index < Math.min(rows.length, scanLimit); index += 1) {
    const map = workbookHeaderMap(rows[index]);
    if (map.district >= 0 && map.section >= 0 && map.landNumber >= 0) return { index, map };
  }
  return null;
}

export function parseCsvLine(line) {
  const values = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
}

export function createDistrictLookup(csvText, direction, city) {
  const firstBreak = csvText.indexOf("\n");
  if (firstBreak < 0) throw new Error("行政區資料檔內容為空。");
  const headers = parseCsvLine(csvText.slice(0, firstBreak).replace(/^\uFEFF/, "").replace(/\r$/, ""));
  const columns = Object.fromEntries(BUNDLED_FIELDS.map((field) => [field, headers.indexOf(field)]));
  const missing = BUNDLED_FIELDS.filter((field) => columns[field] < 0);
  if (missing.length) throw new Error(`行政區資料檔缺少欄位：${missing.join("、")}`);
  const from = direction === "old-to-new" ? "Old" : "New";
  const index = new Map(); let position = firstBreak + 1; let rowCount = 0;
  while (position <= csvText.length) {
    let next = csvText.indexOf("\n", position); if (next < 0) next = csvText.length;
    const line = csvText.slice(position, next).replace(/\r$/, ""); position = next + 1;
    if (!line) { if (next === csvText.length) break; continue; }
    const cells = parseCsvLine(line);
    const mapping = Object.fromEntries(BUNDLED_FIELDS.map((field) => [field, cells[columns[field]] ?? ""]));
    const key = buildLandNumberLookupKey({
      city,
      district: mapping[`district${from}`], section: mapping[`section${from}`],
      subsection: mapping[`subsection${from}`], landNumber: mapping[`landNumber${from}`]
    });
    const matches = index.get(key);
    if (matches) matches.push(mapping); else index.set(key, [mapping]);
    rowCount += 1;
    if (next === csvText.length) break;
  }
  return { index, rowCount };
}

export function parseWorkbookRecords(rows, header, fallbackCity = "新北市") {
  const headers = rows[header.index].map(normalizeHeaderText);
  const records = rows.slice(header.index + 1).map((row, offset) => {
    const map = header.map;
    const combined = splitSectionAndSubsection(row[map.section], map.subsection >= 0 ? row[map.subsection] : "");
    return {
      id: `query-${offset}`,
      sourceRowIndex: header.index + 1 + offset,
      originalRow: [...row],
      city: map.city >= 0 ? normalizeCity(row[map.city]) : normalizeCity(fallbackCity),
      district: normalizeDistrict(row[map.district]),
      section: combined.section,
      subsection: combined.subsection,
      landNumber: formatLandNumber(row[map.landNumber]),
      status: "pending",
      matches: []
    };
  }).filter((record) => record.district && record.section && record.landNumber);
  return { headers, records };
}

export function applyLookup(records, indexes, direction) {
  return records.map((record) => {
    const key = buildLandNumberLookupKey(record);
    const matches = indexes.get(`${normalizeCity(record.city)}|${normalizeDistrict(record.district)}`)?.get(key) ?? [];
    return { ...record, status: matches.length > 1 ? "multiple" : matches.length === 1 ? "found" : "not-found", matches };
  });
}

export function expandResultRows(records, direction) {
  const target = direction === "old-to-new" ? "New" : "Old";
  return records.flatMap((record) => {
    const matches = record.matches?.length ? record.matches : [null];
    return matches.map((mapping) => ({
      record,
      city: record.city,
      status: record.status,
      district: mapping?.[`district${target}`] ?? "",
      section: mapping?.[`section${target}`] ?? "",
      subsection: mapping?.[`subsection${target}`] ?? "",
      landNumber: mapping?.[`landNumber${target}`] ?? ""
    }));
  });
}
