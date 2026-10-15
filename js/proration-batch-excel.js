import { loadExcelJs } from "./exceljs-loader.js";
import { BATCH_FIELDS, BATCH_COMMON_FIELDS, createBatchState, createBatchRow, getField, setField, evaluateBatch } from "./proration-batch-state.js";
import { isBlank } from "./proration-input-normalization.js";

export const BATCH_TEMPLATE_VERSION = 2;
export const BATCH_SHEET_NAME = "批次資料";
const selectedField = Object.freeze({ path: "selected", label: "是否輸出", type: "boolean", required: false });
const fieldsByPath = new Map([selectedField, ...BATCH_FIELDS].map((field) => [field.path, field]));
const blocks = [
  { title: "主要填寫", color: "FFE4EBE7", groups: [
    ["基本資料", ["selected", "customer.label", "customer.doorplate", "customer.buyer"]],
    ["房屋稅", ["customer.houseTax.amount"]],
    ["地價稅", ["customer.landTax.shareNumerator"]],
    ["備註", ["customer.houseTax.taxNote", "customer.note"]]
  ] },
  { title: "視情況填寫", color: "FFE5EBF3", groups: [
    ["房屋稅", ["customer.houseTax.prorationStartDate", "customer.houseTax.prorationEndDate", "customer.houseTax.payer"]],
    ["地價稅", ["customer.landTax.prorationStartDate", "customer.landTax.prorationEndDate", "customer.landTax.payer"]]
  ] },
  { title: "共用設定優先", color: "FFF0ECE6", groups: [
    ["基本資料", ["shared.caseName", "shared.seller", "shared.handoverDate"]],
    ["房屋稅", ["customer.houseTax.taxableMonths", "customer.houseTax.taxStartDate"]],
    ["地價稅", ["customer.landTax.declaredLandValue", "customer.landTax.area", "customer.landTax.shareDenominator", "customer.landTax.taxYear", "customer.landTax.rate"]]
  ] }
];
export const BATCH_COLUMNS = Object.freeze(blocks.flatMap((block) => block.groups.flatMap(([, paths]) => paths.map((path) => fieldsByPath.get(path)))));
const META_SHEET = "填寫說明";
const headerKey = (value) => typeof value === "string" ? value.trim().normalize("NFKC").replace(/\s+/g, "") : "";
const displayHeader = (field) => ["customer.houseTax.prorationStartDate", "customer.houseTax.prorationEndDate", "customer.houseTax.payer", "customer.landTax.prorationStartDate", "customer.landTax.prorationEndDate", "customer.landTax.payer"].includes(field.path)
  ? field.label.replace(/\s*（選填）\s*/g, "").trim() : field.label;
const headerNames = new Map(BATCH_COLUMNS.map((field) => [headerKey(field.label), field]));
for (const field of BATCH_COLUMNS) headerNames.set(headerKey(displayHeader(field)), field);
headerNames.set(headerKey("土地面積（㎡）"), fieldsByPath.get("customer.landTax.area"));
const snapshotValue = (common, field) => {
  const value = getField(common, field.path);
  if (isBlank(value)) return null;
  if (field.type === "payer") return value === "buyer" ? "買方" : value === "seller" ? "賣方" : value;
  return value;
};

export function buildBatchTemplate(common = {}, ExcelJS = globalThis.ExcelJS) {
  if (!ExcelJS?.Workbook) throw new Error("ExcelJS 尚未載入。");
  const workbook = new ExcelJS.Workbook(); workbook.creator = "土地及房屋稅費試算";
  const sheet = workbook.addWorksheet(BATCH_SHEET_NAME, { views: [{ state: "frozen", xSplit: 4, ySplit: 3 }] });
  sheet.columns = BATCH_COLUMNS.map((field) => ({ width: field.type === "date" ? 28 : field.type === "text" ? 24 : 22 }));
  sheet.properties.defaultRowHeight = 30;
  BATCH_COLUMNS.forEach((field, index) => {
    sheet.getColumn(index + 1).alignment = { horizontal: field.type === "number" || field.type === "year" ? "right" : "center", vertical: "middle" };
  });
  sheet.properties.outlineLevelCol = 1;
  for (let index = 15; index <= BATCH_COLUMNS.length; index += 1) {
    const column = sheet.getColumn(index);
    column.outlineLevel = 1; column.hidden = true;
  }
  let position = 1;
  for (const block of blocks) {
    const start = position;
    for (const [category, paths] of block.groups) {
      const end = position + paths.length - 1;
      if (end > position) sheet.mergeCells(2, position, 2, end);
      sheet.getCell(2, position).value = category;
      position = end + 1;
    }
    if (block.title === "主要填寫") {
      sheet.mergeCells("A1:D1");
      sheet.mergeCells("E1:H1");
      sheet.getCell("E1").value = block.title;
    } else if (position - 1 > start) sheet.mergeCells(1, start, 1, position - 1);
    sheet.getCell(1, start).value = block.title;
    for (let column = start; column < position; column += 1) for (const row of [1, 2]) {
      const cell = sheet.getCell(row, column);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: block.color } };
      cell.font = { name: "Microsoft JhengHei", size: 11, bold: true, color: { argb: "FF222222" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    }
  }
  sheet.getRow(1).height = 28; sheet.getRow(2).height = 28; sheet.getRow(3).height = 54;
  BATCH_COLUMNS.forEach((field, index) => { sheet.getCell(3, index + 1).value = displayHeader(field); });
  sheet.getRow(3).eachCell((cell) => {
    cell.font = { name: "Microsoft JhengHei", size: 11, bold: true, color: { argb: "FF222222" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
  });
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: BATCH_COLUMNS.length } };
  // A blank business row with an output default is ignored by the importer.
  sheet.getRow(4).height = 30;
  sheet.getCell(4, 1).value = "是";
  BATCH_COLUMNS.forEach((field, index) => {
    const column = sheet.getColumn(index + 1);
    column.numFmt = field.type === "date" || field.type === "text" ? "@" : "0.##########";
    if (field.type === "payer" || field.type === "boolean") {
      sheet.getCell(4, index + 1).dataValidation = { type: "list", allowBlank: true, formulae: [field.type === "payer" ? '"買方,賣方"' : '"是,否"'] };
    }
  });
  const notes = workbook.addWorksheet(META_SHEET);
  notes.columns = [{ width: 42 }, { width: 100 }];
  notes.addRows([
    ["範本版本", BATCH_TEMPLATE_VERSION],
    ["填寫方式", "第 4 列起一列一戶；主要填寫、視情況填寫及共用設定優先三區依序排列。"],
    ["空白與覆寫", "個別欄位空白時繼承網頁共用值；有值時覆寫，格式錯誤不會退回共用值。"],
    ["共用設定優先", "O～X 欄預設收合，需要個別覆寫時點選 Excel 欄位群組展開。"],
    ["門牌與土地", "門牌請以文字填寫；土地總面積、持分分母及申報地價可在網頁設為共用預設。"],
    ["日期", "西元 YYYY-MM-DD 或民國年/月/日；Excel 日期也可。交屋日不自動決定找補期間。"],
    ["稅率", "數字 1 表示 1%；勿使用 Excel 百分比格式或公式。"],
    ["公式", "公式及其快取結果不接受，請先複製並貼上為值。"],
    ["共用設定快照", "以下僅供核對；匯入時不覆蓋網頁目前共用設定。"],
    ...BATCH_COMMON_FIELDS.map((field) => [field.label, snapshotValue(common, field)]),
    ["共用其他備註", (common.shared?.notes ?? []).map((note) => note.content).join("\n") || null]
  ]);
  notes.eachRow((row) => { row.height = 40; row.eachCell((cell) => { cell.font = { name: "Microsoft JhengHei", size: 11 }; cell.alignment = { vertical: "middle", wrapText: true }; }); });
  return workbook;
}

export async function batchTemplateBuffer(common, ExcelJS) {
  const library = ExcelJS ?? await loadExcelJs();
  return buildBatchTemplate(common, library).xlsx.writeBuffer();
}

export async function downloadBatchTemplate(common) {
  const buffer = await batchTemplateBuffer(common);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a"); link.href = url; link.download = "分算找補_批次範本.xlsx";
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseBatchWorkbook(workbook, { common = {}, filename = "", sheetName = BATCH_SHEET_NAME } = {}) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`找不到「${sheetName}」工作表。`);
  const version = workbook.getWorksheet(META_SHEET)?.getCell("B1").value ?? null;
  if (version != null && version !== 1 && version !== BATCH_TEMPLATE_VERSION) throw new Error("不支援此批次範本版本。");
  const headerRowNumber = version === 2 ? 3 : version === 1 ? 1 : headerNames.has(headerKey(sheet.getCell(1, 1).value)) ? 1 : 3;
  const dataStartRow = headerRowNumber + 1;
  const mapping = new Map(), seen = new Set(), warnings = [];
  sheet.getRow(headerRowNumber).eachCell({ includeEmpty: false }, (cell, index) => {
    const key = headerKey(cell.value), field = headerNames.get(key);
    if (!key) throw new Error(`第 ${index} 欄欄名格式錯誤。`);
    if (!field) throw new Error(`無法辨識欄位名稱：${cell.value}`);
    if (seen.has(field.path)) throw new Error(`欄位名稱重複：${cell.value}`);
    seen.add(field.path);
    mapping.set(index, field);
  });
  for (const field of BATCH_FIELDS.filter((field) => field.required && !field.override)) {
    if (![...mapping.values()].includes(field)) throw new Error(`缺少必要欄位：${field.label}`);
  }
  const batch = createBatchState(common);
  batch.metadata = { templateVersion: version, filename, sheetName, headerRowNumber, dataStartRow, date1904: Boolean(workbook.properties.date1904) };
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber < dataStartRow) return;
    const cells = [], unmappedCells = [], values = {}; let selected = true, hasBusinessData = false;
    excelRow.eachCell({ includeEmpty: false }, (cell, column) => {
      if (!mapping.has(column) && !isBlank(cell.value)) { unmappedCells.push({ address: cell.address, raw: structuredClone(cell.value) }); hasBusinessData = true; }
    });
    for (const [column, field] of mapping) {
      const cell = excelRow.getCell(column), raw = cell.value;
      if (field.path === "selected") selected = isBlank(raw) ? true : structuredClone(raw);
      else { setField(values, field.path, structuredClone(raw)); if (!isBlank(raw)) hasBusinessData = true; }
      cells.push({ path: field.path, address: cell.address, raw: structuredClone(raw), numberFormat: cell.numFmt || "" });
    }
    if (!hasBusinessData) return;
    const row = createBatchRow(values, { selected, source: { filename, sheetName, rowNumber, date1904: batch.metadata.date1904, cells, unmappedCells } });
    batch.rows.push(row);
  });
  if (!batch.rows.length) throw new Error("Excel 沒有資料列。");
  const evaluated = evaluateBatch(batch);
  return { batch, evaluated, warnings };
}

export async function readBatchExcel(fileOrBuffer, options = {}) {
  const ExcelJS = options.ExcelJS ?? await loadExcelJs();
  const buffer = typeof fileOrBuffer?.arrayBuffer === "function" ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
  if (!buffer?.byteLength) throw new Error("Excel 檔案為空。");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw new Error("無法讀取 XLSX，請確認檔案格式與內容。"); }
  return parseBatchWorkbook(workbook, { ...options, filename: options.filename ?? fileOrBuffer?.name ?? "" });
}
