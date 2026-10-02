const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
let excelJsPromise;

function loadExcelJs() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  excelJsPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = EXCELJS_URL;
    script.onload = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error("ExcelJS 載入失敗。"));
    script.onerror = () => reject(new Error("無法載入 Excel 匯出元件，請確認網路連線後重試。")); document.head.append(script);
  });
  return excelJsPromise;
}

const moneyFormat = "#,##0";
const decimalFormat = "#,##0.##";
const safeName = (value) => `${String(value || "地價稅房屋稅分算找補").replace(/[\\/:*?"<>|－]/g, "_")}.xlsx`;
const settlementLabel = (result, buyer, seller) => result.settlement > 0 ? `${buyer || "買方"}應補${seller || "賣方"}` : result.settlement < 0 ? `${seller || "賣方"}應補${buyer || "買方"}` : "雙方無須找補";
const period = (start, end, days) => days > 0 ? `${start} ～ ${end}` : "—";

export async function buildProrationWorkbook(state, results, ExcelJS = globalThis.ExcelJS) {
  if (!ExcelJS?.Workbook) throw new Error("ExcelJS 尚未載入。");
  const shared = state.shared; const customer = state.customer; const houseTax = customer.houseTax; const landTax = customer.landTax;
  const workbook = new ExcelJS.Workbook(); workbook.creator = "土地及房屋稅費試算";
  const sheet = workbook.addWorksheet("分算找補", { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 22 }, { width: 27 }, { width: 20 }, { width: 20 }, { width: 22 }];
  const mergeTitle = (row, text) => { sheet.mergeCells(row, 1, row, 5); sheet.getCell(row, 1).value = text; sheet.getCell(row, 1).font = { name: "Microsoft JhengHei", size: 12, bold: true }; };
  const style = (from, to, bold = false) => { for (let row = from; row <= to; row += 1) for (let col = 1; col <= 5; col += 1) { const cell = sheet.getCell(row, col); cell.font = { name: "Microsoft JhengHei", size: 10.5, bold }; cell.alignment = { vertical: "middle", horizontal: col >= 3 ? "right" : "left", wrapText: true }; cell.border = { top: { style: "thin", color: { argb: "FF999999" } }, bottom: { style: "thin", color: { argb: "FF999999" } }, left: { style: "thin", color: { argb: "FF999999" } }, right: { style: "thin", color: { argb: "FF999999" } } }; } };
  const valueRow = (row, label, value, format = null) => { sheet.getCell(row, 1).value = label; sheet.mergeCells(row, 2, row, 5); sheet.getCell(row, 2).value = value ?? null; if (format && value !== null && value !== "") sheet.getCell(row, 2).numFmt = format; style(row, row); return row + 1; };
  mergeTitle(1, "地價稅房屋稅 分算找補"); sheet.getCell(1, 1).alignment = { horizontal: "center" }; sheet.getCell(1, 1).font = { name: "Microsoft JhengHei", size: 17, bold: true }; sheet.getRow(1).height = 38;
  let row = 3;
  for (const [label, value] of [["案件名稱", shared.caseName], ["買方", customer.buyer], ["賣方", shared.seller], ["交屋日／分算基準日", shared.handoverDate]]) row = valueRow(row, label, value || null);

  row += 1; mergeTitle(row, "房屋稅計算依據"); row += 1;
  for (const [label, value, format] of [["房屋稅額", results.house.amount, moneyFormat], ["課稅月數", houseTax.taxableMonths, decimalFormat], ["完整課稅期間", `${results.house.taxStartDate} ～ ${results.house.taxEndDate}`], ["總課稅天數", results.house.totalTaxDays, moneyFormat], ["房屋稅備註", houseTax.taxNote || null]]) row = valueRow(row, label, value, format);
  row = writeProration(sheet, row, "房屋稅分算", results.house, houseTax, customer.buyer, shared.seller, style, mergeTitle);

  row += 1; mergeTitle(row, "地價稅計算依據"); row += 1;
  for (const [label, value, format] of [["申報地價（元／㎡）", landTax.declaredLandValue, moneyFormat], ["土地面積（㎡）", landTax.area, decimalFormat], ["土地持分", `${landTax.shareNumerator} / ${landTax.shareDenominator}`], ["課稅地價", results.land.taxableLandValue, moneyFormat], ["地價稅率（%）", Number(landTax.rate), decimalFormat], ["完整地價稅", results.land.taxAmount, moneyFormat], ["課稅年度", landTax.taxYear], ["總課稅天數", results.land.totalTaxDays, moneyFormat]]) row = valueRow(row, label, value, format);
  row = writeProration(sheet, row, "地價稅分算", results.land, landTax, customer.buyer, shared.seller, style, mergeTitle);

  row += 1; mergeTitle(row, "最終找補"); row += 1; sheet.getCell(row, 1).value = results.total > 0 ? `${customer.buyer || "買方"}應補${shared.seller || "賣方"}` : results.total < 0 ? `${shared.seller || "賣方"}應補${customer.buyer || "買方"}` : "雙方無須找補"; sheet.mergeCells(row, 1, row, 4); sheet.getCell(row, 5).value = Math.abs(results.total); sheet.getCell(row, 5).numFmt = moneyFormat; style(row, row, true); row += 2;
  const notes = (shared.notes ?? []).filter((note) => String(note.content ?? "").trim());
  if (notes.length) { mergeTitle(row, "其他備註"); row += 1; for (const [index, note] of notes.entries()) { sheet.mergeCells(row, 1, row, 5); sheet.getCell(row, 1).value = `${index + 1}. ${note.content}`; sheet.getRow(row).height = 32; style(row, row); row += 1; } }
  sheet.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.32, right: 0.32, top: 0.32, bottom: 0.32, header: 0, footer: 0 }, printArea: `A1:E${row}` };
  return workbook;
}

function writeProration(sheet, row, title, result, tax, buyer, seller, style, mergeTitle) {
  mergeTitle(row, title); row += 1;
  ["項目", "期間／說明", "天數", "支付方", "金額"].forEach((value, index) => { sheet.getCell(row, index + 1).value = value; }); style(row, row, true); row += 1;
  const values = [["本次找補期間", period(result.prorationStartDate, result.prorationEndDate, result.prorationDays), `${result.prorationDays} / ${result.totalTaxDays}`, tax.payer === "buyer" ? buyer || "買方" : seller || "賣方", result.prorationAmount], ["計算", `${result.amount} × ${result.prorationDays} / ${result.totalTaxDays}`, null, null, result.prorationAmount], ["找補結果", settlementLabel(result, buyer, seller), null, null, Math.abs(result.settlement)]];
  for (const data of values) { data.forEach((value, index) => { sheet.getCell(row, index + 1).value = value; }); sheet.getCell(row, 5).numFmt = moneyFormat; row += 1; }
  style(row - values.length, row - 1); return row;
}

export async function exportProrationExcel(state, results) {
  const ExcelJS = await loadExcelJs(); const workbook = await buildProrationWorkbook(state, results, ExcelJS); const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); const link = document.createElement("a"); link.href = url; link.download = safeName(state.shared.caseName); link.hidden = true; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
