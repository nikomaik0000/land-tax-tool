import { formatLandNumber } from "./formatters.js";
import { normalizeCity, normalizeDistrict, splitSectionAndSubsection } from "./land-value-normalization.js";
import { compareRocYearMonth } from "./pdf-parser.js";
import { lookupPriceIndex, normalizeRocMonth } from "./cpi-lookup.js";

const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let sheetJsPromise;
const aliases = Object.freeze({
  city: ["縣市", "城市", "市"], district: ["行政區", "區"], section: ["段", "段名"], subsection: ["小段", "小段名"], landNumber: ["地號"],
  area: ["面積", "土地面積", "登記面積"], owner: ["所有權人", "姓名"], announcedValue: ["公告現值", "當期公告現值"], share: ["持分"],
  shareNumerator: ["持分分子"], shareDenominator: ["持分分母"], date: ["前次移轉日期", "前次移轉年月", "原地價年月"],
  previousValue: ["前次移轉現值", "原規定地價"], priceIndex: ["物價指數", "CPI"], zoning: ["使用分區", "土地使用分區"]
});
const clean = (value) => String(value ?? "").normalize("NFKC").replace(/[\r\n\s　_()（）／/・,，.。:：-]+/g, "").toLowerCase();
const text = (value) => String(value ?? "").trim();
const number = (value) => { if (value === "" || value == null) return null; const parsed = Number(String(value).replaceAll(",", "").trim()); return Number.isFinite(parsed) ? parsed : null; };
const indexOf = (headers, names) => headers.findIndex((header) => names.some((name) => clean(header) === clean(name)));

export function vatExcelHeaderMap(headers) {
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, indexOf(headers, names)]));
}

export function detectVatExcelHeader(rows, scanLimit = 20) {
  for (let index = 0; index < Math.min(rows.length, scanLimit); index += 1) {
    const map = vatExcelHeaderMap(rows[index] ?? []);
    const signals = [map.city, map.district, map.section, map.landNumber, map.announcedValue, map.previousValue].filter((value) => value >= 0).length;
    if (map.landNumber >= 0 && signals >= 3) return { index, map };
  }
  return null;
}

function shareFromRow(row, map) {
  const explicitNumerator = map.shareNumerator >= 0 ? number(row[map.shareNumerator]) : null;
  const explicitDenominator = map.shareDenominator >= 0 ? number(row[map.shareDenominator]) : null;
  if (explicitNumerator !== null && explicitDenominator !== null) return { numerator: explicitNumerator, denominator: explicitDenominator };
  const match = map.share >= 0 ? text(row[map.share]).match(/^(\d+)\s*\/\s*(\d+)$/) : null;
  return match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : { numerator: null, denominator: null };
}

const valueAt = (row, map, field) => map[field] >= 0 ? row[map[field]] : null;
const firstValue = (value) => value !== null && value !== undefined && value !== "";

export function normalizeVatExcel(rows, { idFactory = (prefix) => `${prefix}-${crypto.randomUUID()}` } = {}) {
  const header = detectVatExcelHeader(rows);
  if (!header) throw new Error("找不到可辨識的土地資料欄位");
  const groups = new Map(); const warnings = []; let skippedRows = 0; let transferCount = 0;
  rows.slice(header.index + 1).forEach((row, offset) => {
    const sourceRow = header.index + offset + 2;
    const rawLandNumber = text(valueAt(row, header.map, "landNumber"));
    if (!rawLandNumber) { if ((row ?? []).some(firstValue)) { skippedRows += 1; warnings.push(`第 ${sourceRow} 列缺少地號，已略過。`); } return; }
    const parts = splitSectionAndSubsection(valueAt(row, header.map, "section"), valueAt(row, header.map, "subsection"));
    const normalized = {
      city: normalizeCity(valueAt(row, header.map, "city")), district: normalizeDistrict(valueAt(row, header.map, "district")), section: parts.section,
      subsection: parts.subsection, landNumber: formatLandNumber(rawLandNumber), owner: text(valueAt(row, header.map, "owner"))
    };
    const key = [normalized.city, normalized.district, normalized.section, normalized.subsection, normalized.landNumber, normalized.owner].join("|");
    const landValues = { area: number(valueAt(row, header.map, "area")), announcedValue: number(valueAt(row, header.map, "announcedValue")), zoning: text(valueAt(row, header.map, "zoning")) };
    let land = groups.get(key);
    if (!land) {
      land = { id: idFactory("excel-land"), ...normalized, rawLandNumber, area: landValues.area, announcedValue: landValues.announcedValue, zoning: landValues.zoning, zonings: landValues.zoning ? [landValues.zoning] : [], zoningManual: Boolean(landValues.zoning), zoningStatus: landValues.zoning ? "manual" : "", previousTransfers: [], importSourceRows: [sourceRow] };
      groups.set(key, land);
    } else {
      land.importSourceRows.push(sourceRow);
      for (const field of ["area", "announcedValue", "zoning"]) if (firstValue(landValues[field]) && firstValue(land[field]) && String(landValues[field]) !== String(land[field])) warnings.push(`第 ${sourceRow} 列的${({ area: "面積", announcedValue: "公告現值", zoning: "使用分區" })[field]}與同一土地首列不同，已保留首列。`);
      for (const field of ["area", "announcedValue", "zoning"]) if (!firstValue(land[field]) && firstValue(landValues[field])) land[field] = landValues[field];
    }
    const share = shareFromRow(row, header.map);
    const transfer = { date: text(valueAt(row, header.map, "date")), previousValue: number(valueAt(row, header.map, "previousValue")), shareNumerator: share.numerator, shareDenominator: share.denominator, priceIndex: number(valueAt(row, header.map, "priceIndex")), cpiSource: number(valueAt(row, header.map, "priceIndex")) !== null ? "manual" : "" };
    if (Object.values(transfer).some(firstValue)) { land.previousTransfers.push(transfer); transferCount += 1; }
  });
  const lands = [...groups.values()];
  lands.forEach((land) => { land.previousTransfers.sort((a, b) => compareRocYearMonth(a.date, b.date)); land.shareNumerator = land.previousTransfers[0]?.shareNumerator ?? null; land.shareDenominator = land.previousTransfers[0]?.shareDenominator ?? null; });
  const ownerNames = [...new Set(lands.map((land) => land.owner).filter(Boolean))];
  const owners = ownerNames.map((name) => ({ id: idFactory("owner"), name }));
  const ownerIds = new Map(owners.map((owner) => [owner.name, owner.id]));
  lands.forEach((land) => { land.ownerId = ownerIds.get(land.owner) ?? null; });
  return { lands, owners, houses: [], headerRow: header.index + 1, transferCount, skippedRows, warnings };
}

async function loadSheetJs() {
  if (globalThis.XLSX) return globalThis.XLSX;
  sheetJsPromise ??= new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = SHEETJS_URL; script.onload = () => resolve(globalThis.XLSX); script.onerror = () => reject(new Error("無法載入 Excel 讀取元件。")); document.head.append(script); });
  return sheetJsPromise;
}

export async function readVatExcel(file) {
  const XLSX = await loadSheetJs(); const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true, cellDates: false }); let lastError;
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    try { return { ...normalizeVatExcel(rows), sheetName }; } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error("找不到可辨識的土地資料欄位");
}

export function fillMissingVatExcelCpi(lands, cpiData) {
  for (const land of lands ?? []) for (const transfer of land.previousTransfers ?? []) {
    if (transfer.priceIndex != null || !transfer.date) continue;
    const date = normalizeRocMonth(transfer.date);
    transfer.priceIndex = date ? lookupPriceIndex(cpiData, date.rocYear, date.month) : null;
    if (transfer.priceIndex != null) transfer.cpiSource = "lookup";
  }
  return lands;
}
