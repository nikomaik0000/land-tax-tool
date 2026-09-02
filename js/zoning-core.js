import { formatLandNumber } from "./formatters.js";
import { normalizeCity, normalizeDistrict, splitSectionAndSubsection } from "./land-value-normalization.js";
import { detectLandNumberHeaderRow, parseCsvLine } from "./land-number-converter-core.js";

const clean = (value) => String(value ?? "").normalize("NFKC").replace(/[\s　]+/g, "").trim();
function chineseInteger(value) {
  const text = clean(value); const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^[零〇一二兩三四五六七八九]$/.test(text)) return String(digits[text]);
  const match = text.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (match) return String((match[1] ? digits[match[1]] : 1) * 10 + (match[2] ? digits[match[2]] : 0));
  return text;
}
const cleanPart = (value) => /^\d+$/.test(clean(value)) ? String(Number(clean(value))) : chineseInteger(value);

export function zoningLookupKey(record) {
  const landNumber = formatLandNumber(record.landNumber);
  const [main = "", sub = "0"] = landNumber.split("-");
  return [normalizeDistrict(record.district), clean(record.section).replace(/段$/, ""), cleanPart(record.subsection).replace(/小段$/, ""), cleanPart(main), cleanPart(sub)].join("|");
}

export function normalizeTaipeiZoningRow(cells, columns) {
  return {
    city: "臺北市", district: cells[columns.district], section: cells[columns.section], subsection: cells[columns.subsection],
    landNumber: cleanPart(cells[columns.subNumber]) === "0" ? cleanPart(cells[columns.mainNumber]) : `${cleanPart(cells[columns.mainNumber])}-${cleanPart(cells[columns.subNumber])}`,
    landType: "都市土地", zoning: cells[columns.zoning], landUse: "", source: "臺北市土地使用分區"
  };
}

export function createTaipeiZoningLookup(csvText) {
  const lines = csvText.trim().split(/\r?\n/); const headers = parseCsvLine(lines.shift().replace(/^\uFEFF/, ""));
  const required = ["district", "section", "subsection", "mainNumber", "subNumber", "zoning"];
  const columns = Object.fromEntries(required.map((field) => [field, headers.indexOf(field)]));
  const missing = required.filter((field) => columns[field] < 0); if (missing.length) throw new Error(`使用分區檔缺少欄位：${missing.join("、")}`);
  const index = new Map();
  for (const line of lines) {
    if (!line) continue; const result = normalizeTaipeiZoningRow(parseCsvLine(line), columns); const key = zoningLookupKey(result);
    const matches = index.get(key);
    if (matches && !matches.some((item) => item.zoning === result.zoning && item.landUse === result.landUse)) matches.push(result);
    else if (!matches) index.set(key, [result]);
  }
  return index;
}

export function parseZoningWorkbookRecords(rows, fallbackCity = "臺北市") {
  const header = detectLandNumberHeaderRow(rows, 30); if (!header) throw new Error("Excel 找不到必要欄位：區、段、地號。");
  const headers = rows[header.index].map(clean);
  const records = rows.slice(header.index + 1).map((row, offset) => {
    const parts = splitSectionAndSubsection(row[header.map.section], header.map.subsection >= 0 ? row[header.map.subsection] : "");
    return { id: `zoning-${offset}`, originalRow: [...row], city: header.map.city >= 0 ? normalizeCity(row[header.map.city]) : normalizeCity(fallbackCity), district: normalizeDistrict(row[header.map.district]), section: parts.section, subsection: parts.subsection, landNumber: formatLandNumber(row[header.map.landNumber]), matches: [], status: "pending" };
  }).filter((row) => row.district && row.section && row.landNumber);
  return { header, headers, records };
}

export function applyZoningLookup(records, districtIndexes) {
  return records.map((record) => {
    if (record.city === "新北市") return { ...record, status: "unsupported", matches: [] };
    const matches = districtIndexes.get(`${record.city}|${record.district}`)?.get(zoningLookupKey(record)) ?? [];
    return { ...record, matches, status: matches.length > 1 ? "multiple" : matches.length === 1 ? "found" : "not-found" };
  });
}
