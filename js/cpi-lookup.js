const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let sheetJsPromise;

function loadSheetJs() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  sheetJsPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_URL;
    script.onload = () => globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("物價指數 Excel 讀取元件載入失敗。"));
    script.onerror = () => reject(new Error("無法載入物價指數 Excel 讀取元件，請確認網路連線。"));
    document.head.append(script);
  });
  return sheetJsPromise;
}

const normalizedCell = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();

export function normalizeRocMonth(value) {
  const text = normalizedCell(value).replace(/^民國/, "");
  const match = text.match(/^(\d{2,3})(?:年|[.\/-])(\d{1,2})月?$/);
  if (!match) return null;
  const rocYear = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(rocYear) || rocYear < 1 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { rocYear, month };
}

export function buildCpiLookup(rows, sheetName = "") {
  const headerIndex = rows.findIndex((row) => normalizedCell(row[0]) === "年" && row.some((cell) => normalizedCell(cell) === "1月") && row.some((cell) => normalizedCell(cell) === "12月"));
  if (headerIndex < 0) throw new Error("找不到物價指數表的「年／1月～12月」表頭。");
  const header = rows[headerIndex];
  const yearColumn = header.findIndex((cell) => normalizedCell(cell) === "年");
  const monthColumns = new Map();
  header.forEach((cell, column) => {
    const match = normalizedCell(cell).match(/^(\d{1,2})月$/);
    if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12) monthColumns.set(Number(match[1]), column);
  });
  if (monthColumns.size !== 12) throw new Error("物價指數表沒有完整的 1 月至 12 月欄位。");
  const values = new Map();
  const duplicates = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const rocYear = Number(row[yearColumn]);
    if (!Number.isInteger(rocYear) || rocYear < 1 || rocYear > 300) continue;
    for (const [month, column] of monthColumns) {
      const value = Number(row[column]);
      if (!Number.isFinite(value)) continue;
      const key = `${rocYear}-${month}`;
      if (values.has(key)) duplicates.push(key);
      else values.set(key, value);
    }
  }
  return { sheetName, values, duplicates: [...new Set(duplicates)], headerRow: headerIndex + 1, yearColumn: yearColumn + 1, monthColumns };
}

export async function loadCpiWorkbook(file) {
  const XLSX = await loadSheetJs();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: true });
  const candidates = workbook.SheetNames.map((sheetName) => ({ sheetName, rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null }) }));
  let lastError;
  for (const candidate of candidates) {
    try { return buildCpiLookup(candidate.rows, candidate.sheetName); }
    catch (error) { lastError = error; }
  }
  throw lastError ?? new Error("物價指數 Excel 沒有可讀取的工作表。");
}

export function lookupPriceIndex(cpiData, rocYear, month) {
  if (!cpiData?.values || !Number.isInteger(Number(rocYear)) || !Number.isInteger(Number(month))) return null;
  const value = cpiData.values.get(`${Number(rocYear)}-${Number(month)}`);
  return Number.isFinite(value) ? value : null;
}
