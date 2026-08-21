import { clauses } from "./clauses.js?v=20260818-9";
import { formatLandNumber } from "./formatters.js?v=20260819-25";
import { calculateTaxSummaryByOwner, calculateTotalDeedTax } from "./calculations.js";
import { ownerName } from "./relationships.js";

const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const COLORS = { black: "FF000000", dark: "FF333333", line: "FF999999", white: "FFFFFFFF" };
const MONEY_FORMAT = "#,##0";
const AREA_FORMAT = "#,##0.##";
const INDEX_FORMAT = "0.##";

let excelJsPromise;

function loadExcelJs() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  excelJsPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = EXCELJS_URL;
    script.onload = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error("ExcelJS 載入失敗。"));
    script.onerror = () => reject(new Error("無法載入 Excel 匯出元件，請確認網路連線後重試。"));
    document.head.append(script);
  });
  return excelJsPromise;
}

const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const numericOrNull = (value) => hasNumber(value) ? Number(value) : null;
const shareText = (numerator, denominator) => `${numerator ?? ""} / ${denominator ?? ""}`;
const hasHouse = (house) => Boolean(String(house?.address || "").trim()) || Number(house?.assessedValue) > 0;
const columnLetter = (index) => {
  let value = index; let result = "";
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
};

function spacingConfig(value) {
  return ({ compact: { header: 30, data: 21, section: 24 }, standard: { header: 36, data: 26, section: 28 }, relaxed: { header: 44, data: 34, section: 34 } })[value] ?? { header: 36, data: 26, section: 28 };
}

function fontConfig(value) {
  return ({ small: { body: 9, title: 16 }, medium: { body: 10.5, title: 17 }, large: { body: 12, title: 18 } })[value] ?? { body: 10.5, title: 17 };
}

function mainColumns(showSelfUseTax) {
  return [
    { key: "district", header: "區", width: 7, align: "center" },
    { key: "section", header: "段", width: 8, align: "center" },
    { key: "subsection", header: "小段", width: 8, align: "center" },
    { key: "landNumber", header: "地號", width: 10, align: "center" },
    { key: "area", header: "面積", width: 12, align: "center", format: AREA_FORMAT },
    { key: "owner", header: "所有\n權人", width: 12, align: "center" },
    { key: "announcedValue", header: "公告\n現值", width: 13, align: "right", format: MONEY_FORMAT },
    { key: "share", header: "持分", width: 12, align: "center" },
    { key: "currentValue", header: "總現值", width: 15, align: "right", format: MONEY_FORMAT },
    { key: "date", header: "前次\n移轉日期", width: 13, align: "center" },
    { key: "previousValue", header: "前次\n移轉現值", width: 14, align: "right", format: MONEY_FORMAT },
    { key: "priceIndex", header: "物價\n指數", width: 10, align: "center", format: INDEX_FORMAT },
    ...(showSelfUseTax ? [{ key: "selfUseTax", header: "自用\n增值稅", width: 15, align: "right", format: MONEY_FORMAT }] : []),
    { key: "generalTax", header: "一般\n增值稅", width: 15, align: "right", format: MONEY_FORMAT }
  ];
}

function applyFont(cell, fontSize, bold = false) {
  cell.font = { name: "Microsoft JhengHei", size: fontSize, bold, color: { argb: COLORS.black } };
}

function styleRange(sheet, startRow, startCol, endRow, endCol, options = {}) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      const cell = sheet.getCell(row, col);
      applyFont(cell, options.fontSize, options.bold);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
      cell.alignment = {
        horizontal: options.horizontal ?? cell.alignment?.horizontal ?? "center",
        vertical: options.vertical ?? cell.alignment?.vertical ?? "middle",
        wrapText: options.wrapText ?? cell.alignment?.wrapText ?? true
      };
      cell.border = {
        top: { style: row === startRow ? "medium" : "thin", color: { argb: row === startRow ? COLORS.black : COLORS.line } },
        bottom: { style: row === endRow ? "medium" : "thin", color: { argb: row === endRow ? COLORS.black : COLORS.line } },
        left: { style: col === startCol ? "medium" : "thin", color: { argb: col === startCol ? COLORS.black : COLORS.line } },
        right: { style: col === endCol ? "medium" : "thin", color: { argb: col === endCol ? COLORS.black : COLORS.line } }
      };
    }
  }
}

function addSectionTitle(sheet, row, title, totalColumns, fontSize, height) {
  sheet.mergeCells(row, 1, row, totalColumns);
  const cell = sheet.getCell(row, 1); cell.value = title; applyFont(cell, fontSize, true);
  cell.alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(row).height = height;
}

function writeMainTable(sheet, startRow, state, totals, styles) {
  const columns = mainColumns(state.displayOptions.showSelfUseTax);
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  const headerRow = startRow;
  columns.forEach((column, index) => { sheet.getCell(headerRow, index + 1).value = column.header; });
  sheet.getRow(headerRow).height = styles.spacing.header;
  styleRange(sheet, headerRow, 1, headerRow, columns.length, { fontSize: styles.font.body, bold: true });

  const basicColumnCount = columns.findIndex((column) => column.key === "date");
  let row = headerRow + 1; const renderedHouses = new Set();
  const writeHouse = (house) => {
    const announcedColumn = columns.findIndex((column) => column.key === "announcedValue") + 1;
    const shareColumn = columns.findIndex((column) => column.key === "share") + 1;
    const currentColumn = columns.findIndex((column) => column.key === "currentValue") + 1;
    sheet.mergeCells(row, 1, row, announcedColumn); sheet.getCell(row, 1).value = `房屋座落：${house.address || "—"}`;
    sheet.getCell(row, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    sheet.getCell(row, shareColumn).value = shareText(house.shareNumerator, house.shareDenominator);
    sheet.getCell(row, currentColumn).value = numericOrNull(house.currentValue); sheet.getCell(row, currentColumn).numFmt = MONEY_FORMAT;
    sheet.getRow(row).height = styles.spacing.data; styleRange(sheet, row, 1, row, columns.length, { fontSize: styles.font.body }); row += 1;
  };
  for (let landIndex = 0; landIndex < state.lands.length; landIndex += 1) {
    const land = state.lands[landIndex];
    const transfers = land.previousTransfers?.length ? land.previousTransfers : [null];
    const firstRow = row; const lastRow = row + transfers.length - 1;
    const basicValues = {
      district: land.district || null, section: land.section || null, subsection: land.subsection || null,
      landNumber: formatLandNumber(land.landNumber), area: numericOrNull(land.area), owner: ownerName(state, land.ownerId, land.owner),
      announcedValue: numericOrNull(land.announcedValue), share: shareText(land.shareNumerator, land.shareDenominator),
      currentValue: numericOrNull(land.currentValue)
    };
    columns.slice(0, basicColumnCount).forEach((column, index) => {
      const col = index + 1;
      if (transfers.length > 1) sheet.mergeCells(firstRow, col, lastRow, col);
      const cell = sheet.getCell(firstRow, col); cell.value = basicValues[column.key] ?? null;
      if (column.format && cell.value !== null) cell.numFmt = column.format;
      cell.alignment = { horizontal: column.align, vertical: "middle", wrapText: true };
    });
    transfers.forEach((transfer, transferIndex) => {
      const currentRow = firstRow + transferIndex;
      const values = {
        date: transfer?.date || null, previousValue: numericOrNull(transfer?.previousValue), priceIndex: numericOrNull(transfer?.priceIndex),
        selfUseTax: numericOrNull(transfer?.selfUseTax), generalTax: numericOrNull(transfer?.generalTax)
      };
      columns.slice(basicColumnCount).forEach((column, offset) => {
        const cell = sheet.getCell(currentRow, basicColumnCount + offset + 1); cell.value = values[column.key] ?? null;
        if (column.format && cell.value !== null) cell.numFmt = column.format;
        cell.alignment = { horizontal: column.align, vertical: "middle", wrapText: true };
      });
      sheet.getRow(currentRow).height = styles.spacing.data;
    });
    styleRange(sheet, firstRow, 1, lastRow, columns.length, { fontSize: styles.font.body });
    row = lastRow + 1;
    const house = state.houses?.find((item) => item.id === land.houseId);
    const laterUse = house && state.lands.slice(landIndex + 1).some((item) => item.houseId === house.id);
    if (house && !laterUse && !renderedHouses.has(house.id)) { writeHouse(house); renderedHouses.add(house.id); }
  }

  for (const house of state.houses ?? []) if (!renderedHouses.has(house.id) && hasHouse(house)) writeHouse(house);

  const shareColumn = columns.findIndex((column) => column.key === "share") + 1;
  const currentColumn = columns.findIndex((column) => column.key === "currentValue") + 1;
  sheet.mergeCells(row, 1, row, shareColumn);
  sheet.getCell(row, 1).value = "合計";
  sheet.getCell(row, currentColumn).value = numericOrNull(state.caseCurrentValue);
  sheet.getCell(row, currentColumn).numFmt = MONEY_FORMAT;
  if (state.displayOptions.showSelfUseTax) {
    const col = columns.findIndex((column) => column.key === "selfUseTax") + 1;
    sheet.getCell(row, col).value = numericOrNull(totals.selfUseTax); sheet.getCell(row, col).numFmt = MONEY_FORMAT;
  }
  const generalColumn = columns.findIndex((column) => column.key === "generalTax") + 1;
  sheet.getCell(row, generalColumn).value = numericOrNull(totals.generalTax); sheet.getCell(row, generalColumn).numFmt = MONEY_FORMAT;
  sheet.getRow(row).height = styles.spacing.data;
  styleRange(sheet, row, 1, row, columns.length, { fontSize: styles.font.body, bold: true });
  for (let col = 1; col <= columns.length; col += 1) sheet.getCell(row, col).border.top = { style: "thick", color: { argb: COLORS.black } };
  return { nextRow: row + 1, columns, headerRow };
}

function giftItems(state) {
  const result = state.giftTax.result;
  return [
    ...(state.lands.length ? [{ label: "土地總\n現值", value: result.landCurrentValue }] : []),
    ...(result.houseCurrentValue > 0 ? [{ label: "房屋持分\n現值", value: result.houseCurrentValue }] : []),
    ...(result.otherCurrentGiftAmount > 0 ? [{ label: "其他本次\n贈與", value: result.otherCurrentGiftAmount }] : []),
    { label: "本次贈與\n總額", value: result.currentGiftAmount },
    ...(result.previousGiftAmount > 0 ? [{ label: "以前各次\n贈與", value: result.previousGiftAmount }] : []),
    { label: "本年度\n贈與總額", value: result.annualGiftAmount },
    ...(result.excludedGiftAmount > 0 ? [{ label: "不計入\n贈與總額", value: result.excludedGiftAmount }] : []),
    { label: "免稅額", value: result.exemption },
    ...(result.landValueTaxDeduction > 0 ? [{ label: "土增稅\n扣除額", value: result.landValueTaxDeduction }] : []),
    ...(result.deedTaxDeduction > 0 ? [{ label: "契稅\n扣除額", value: result.deedTaxDeduction }] : []),
    ...(result.otherDeduction > 0 ? [{ label: "其他\n扣除額", value: result.otherDeduction }] : []),
    { label: "課稅贈與\n淨額", value: result.taxableGift },
    ...(result.previousPaidTaxCredit > 0 ? [{ label: "全年應納\n贈與稅", value: result.calculatedAnnualTax }, { label: "以前已納稅額\n／可扣抵稅額", value: result.previousPaidTaxCredit }] : [])
  ];
}

function giftFormula(result) {
  const rate = `${Math.round(result.bracketRate * 100)}%`;
  if (result.bracketLabel === "第一級") return `適用稅率：${rate} ｜ ${Math.round(result.taxableGift).toLocaleString("zh-TW")} × ${rate} ＝ ${Math.round(result.calculatedAnnualTax).toLocaleString("zh-TW")} 元`;
  return `適用稅率：${rate} ｜ ${Math.round(result.bracketBaseTax).toLocaleString("zh-TW")} ＋（${Math.round(result.taxableGift).toLocaleString("zh-TW")} − ${Math.round(result.bracketExcessOver).toLocaleString("zh-TW")}）× ${rate} ＝ ${Math.round(result.calculatedAnnualTax).toLocaleString("zh-TW")} 元`;
}

function writeGiftTax(sheet, startRow, state, totalColumns, styles) {
  if (!state.giftTax.enabled || !state.giftTax.result) return startRow;
  addSectionTitle(sheet, startRow, "贈與稅試算", totalColumns, styles.font.body + 0.5, styles.spacing.section);
  const items = giftItems(state); const headerRow = startRow + 1; const valueRow = startRow + 2; const finalRow = startRow + 3;
  items.forEach((item, index) => {
    const from = Math.floor(index * totalColumns / items.length) + 1;
    const to = Math.floor((index + 1) * totalColumns / items.length);
    if (to > from) { sheet.mergeCells(headerRow, from, headerRow, to); sheet.mergeCells(valueRow, from, valueRow, to); }
    sheet.getCell(headerRow, from).value = item.label;
    sheet.getCell(valueRow, from).value = numericOrNull(item.value);
    sheet.getCell(valueRow, from).numFmt = MONEY_FORMAT;
    sheet.getCell(valueRow, from).alignment = { horizontal: "right", vertical: "middle" };
  });
  sheet.getRow(headerRow).height = styles.spacing.header; sheet.getRow(valueRow).height = styles.spacing.data; sheet.getRow(finalRow).height = styles.spacing.data;
  styleRange(sheet, headerRow, 1, finalRow, totalColumns, { fontSize: styles.font.body });
  for (let col = 1; col <= totalColumns; col += 1) { applyFont(sheet.getCell(headerRow, col), styles.font.body, true); sheet.getCell(headerRow, col).alignment = { horizontal: "center", vertical: "middle", wrapText: true }; }
  const logicalAmountSpan = 1;
  const logicalLabelSpan = Math.max(1, Math.ceil((items.length - logicalAmountSpan) / 3));
  const logicalFormulaSpan = Math.max(1, items.length - logicalLabelSpan - logicalAmountSpan);
  const formulaSpan = Math.max(1, Math.floor(logicalFormulaSpan * totalColumns / items.length));
  const formulaAndLabelSpan = Math.max(formulaSpan + 1, Math.floor((logicalFormulaSpan + logicalLabelSpan) * totalColumns / items.length));
  const labelSpan = formulaAndLabelSpan - formulaSpan;
  const amountSpan = totalColumns - formulaAndLabelSpan;
  sheet.mergeCells(finalRow, 1, finalRow, formulaSpan);
  sheet.mergeCells(finalRow, formulaSpan + 1, finalRow, formulaSpan + labelSpan);
  if (amountSpan > 1) sheet.mergeCells(finalRow, totalColumns - amountSpan + 1, finalRow, totalColumns);
  sheet.getCell(finalRow, 1).value = giftFormula(state.giftTax.result);
  sheet.getCell(finalRow, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getCell(finalRow, formulaSpan + 1).value = "應納贈與稅";
  sheet.getCell(finalRow, formulaSpan + 1).alignment = { horizontal: "center", vertical: "middle" };
  const amountCell = sheet.getCell(finalRow, totalColumns - amountSpan + 1); amountCell.value = Math.round(state.giftTax.result.finalGiftTax); amountCell.numFmt = '#,##0" 元"'; amountCell.alignment = { horizontal: "right", vertical: "middle" }; applyFont(amountCell, styles.font.body + 1, true);
  return finalRow + 1;
}

function taxSummaryItems(state, totals) {
  if (!state.displayOptions.showTaxSummary) return [];
  const selected = state.displayOptions.taxSummaryItems;
  return [
    ...(state.displayOptions.showSelfUseTax && selected.selfUseTax ? [{ label: "自用增值稅", value: totals.selfUseTax }] : []),
    ...(selected.generalTax ? [{ label: "一般增值稅", value: totals.generalTax }] : []),
    ...(selected.deedTax ? [{ label: "契稅", value: calculateTotalDeedTax(state.houses) }] : []),
    ...(state.giftTax.enabled && selected.giftTax && state.giftTax.result ? [{ label: "贈與稅", value: state.giftTax.result.finalGiftTax }] : [])
  ];
}

function writeTaxSummary(sheet, startRow, state, totals, totalColumns, styles) {
  const items = taxSummaryItems(state, totals); if (!items.length) return startRow;
  addSectionTitle(sheet, startRow, "稅額摘要", totalColumns, styles.font.body + 0.5, styles.spacing.section);
  let row = startRow + 1;
  const writeItems = (summaryItems) => {
    if (!summaryItems.length) return;
    const labelRow = row; const valueRow = row + 1;
    summaryItems.forEach((item, index) => {
      const from = Math.floor(index * totalColumns / summaryItems.length) + 1; const to = Math.floor((index + 1) * totalColumns / summaryItems.length);
      if (to > from) { sheet.mergeCells(labelRow, from, labelRow, to); sheet.mergeCells(valueRow, from, valueRow, to); }
      sheet.getCell(labelRow, from).value = item.label; sheet.getCell(valueRow, from).value = numericOrNull(item.value); sheet.getCell(valueRow, from).numFmt = MONEY_FORMAT;
      sheet.getCell(valueRow, from).alignment = { horizontal: "right", vertical: "middle" };
    });
    sheet.getRow(labelRow).height = styles.spacing.data; sheet.getRow(valueRow).height = styles.spacing.data;
    styleRange(sheet, labelRow, 1, valueRow, totalColumns, { fontSize: styles.font.body }); row = valueRow + 1;
  };
  const groups = calculateTaxSummaryByOwner(state);
  if (groups.length <= 1) { writeItems(items); return row; }
  const selected = state.displayOptions.taxSummaryItems;
  const columns = [...(state.displayOptions.showSelfUseTax && selected.selfUseTax ? [{ key: "selfUseTax", label: "自用增值稅", total: totals.selfUseTax }] : []), ...(selected.generalTax ? [{ key: "generalTax", label: "一般增值稅", total: totals.generalTax }] : []), ...(selected.deedTax ? [{ key: "deedTax", label: "契稅", total: calculateTotalDeedTax(state.houses) }] : [])];
  if (columns.length) {
    const logicalColumns = columns.length + 1; const headerRow = row; const spans = [];
    for (let index = 0; index < logicalColumns; index += 1) { const from = Math.floor(index * totalColumns / logicalColumns) + 1; const to = Math.floor((index + 1) * totalColumns / logicalColumns); spans.push({ from, to }); if (to > from) sheet.mergeCells(row, from, row, to); }
    sheet.getCell(row, spans[0].from).value = "所有權人"; columns.forEach((column, index) => { sheet.getCell(row, spans[index + 1].from).value = column.label; }); row += 1;
    for (const group of groups) { spans.forEach(({ from, to }) => { if (to > from) sheet.mergeCells(row, from, row, to); }); sheet.getCell(row, spans[0].from).value = group.ownerName || "未命名所有權人"; columns.forEach((column, index) => { const cell = sheet.getCell(row, spans[index + 1].from); cell.value = group[column.key]; cell.numFmt = MONEY_FORMAT; cell.alignment = { horizontal: "right", vertical: "middle" }; }); row += 1; }
    if (state.displayOptions.showCaseTotal) { spans.forEach(({ from, to }) => { if (to > from) sheet.mergeCells(row, from, row, to); }); sheet.getCell(row, spans[0].from).value = "合計"; columns.forEach((column, index) => { const cell = sheet.getCell(row, spans[index + 1].from); cell.value = column.total; cell.numFmt = MONEY_FORMAT; cell.alignment = { horizontal: "right", vertical: "middle" }; }); row += 1; }
    for (let current = headerRow; current < row; current += 1) sheet.getRow(current).height = styles.spacing.data;
    styleRange(sheet, headerRow, 1, row - 1, totalColumns, { fontSize: styles.font.body }); for (let col = 1; col <= totalColumns; col += 1) applyFont(sheet.getCell(headerRow, col), styles.font.body, true);
  }
  if (state.giftTax.enabled && selected.giftTax && state.giftTax.result) { sheet.mergeCells(row, 1, row, totalColumns - 2); sheet.mergeCells(row, totalColumns - 1, row, totalColumns); sheet.getCell(row, 1).value = "案件贈與稅"; sheet.getCell(row, totalColumns - 1).value = state.giftTax.result.finalGiftTax; sheet.getCell(row, totalColumns - 1).numFmt = MONEY_FORMAT; row += 1; }
  return row;
}

function writeClauses(sheet, startRow, state, totalColumns, styles) {
  const selected = clauses.filter((clause) => state.selectedClauses.includes(clause.id));
  const customNotes = (state.customNotes ?? []).filter((note) => note.enabled !== false && String(note.content ?? "").trim());
  if (!selected.length && !customNotes.length) return startRow;
  addSectionTitle(sheet, startRow, "備註", totalColumns, styles.font.body + 0.5, styles.spacing.section);
  let row = startRow + 1;
  for (const clause of selected) {
    sheet.mergeCells(row, 1, row, totalColumns);
    const content = clause.id === "selfUse" ? `◆ ${clause.title}\n${clause.content.map((item, index) => `    ${index + 1}. ${item}`).join("\n")}` : `◆ ${clause.content.join("")}`;
    const cell = sheet.getCell(row, 1); cell.value = content; applyFont(cell, styles.font.body, false);
    cell.alignment = { horizontal: "left", vertical: "top", wrapText: true, indent: 0 };
    cell.border = { top: { style: "thin", color: { argb: COLORS.line } } };
    sheet.getRow(row).height = Math.max(styles.spacing.data, (content.split("\n").length * (styles.font.body + 7)));
    row += 1;
  }
  for (const note of customNotes) {
    sheet.mergeCells(row, 1, row, totalColumns);
    const title = String(note.title ?? "").trim(); const body = String(note.content ?? "").trim();
    const indentedBody = body.split("\n").map((line) => `    ${line}`).join("\n");
    const content = title ? `◆ ${title}：\n${indentedBody}` : `◆ ${body}`;
    const cell = sheet.getCell(row, 1); cell.value = content; applyFont(cell, styles.font.body, false);
    cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    cell.border = { top: { style: "thin", color: { argb: COLORS.line } } };
    sheet.getRow(row).height = Math.max(styles.spacing.data, content.split("\n").length * (styles.font.body + 7)); row += 1;
  }
  return row;
}

function applyPrintSettings(sheet, state, totalColumns, finalRow) {
  sheet.pageSetup = {
    paperSize: 9,
    orientation: state.displayOptions.orientation === "portrait" ? "portrait" : "landscape",
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.32, right: 0.32, top: 0.32, bottom: 0.32, header: 0, footer: 0 },
    printArea: `A1:${columnLetter(totalColumns)}${finalRow}`
  };
}

export async function buildExcelWorkbook(state, totals, ExcelJS = globalThis.ExcelJS) {
  if (!ExcelJS?.Workbook) throw new Error("ExcelJS 尚未載入。");
  const workbook = new ExcelJS.Workbook(); workbook.creator = "土地及房屋稅費試算"; workbook.created = new Date();
  const sheet = workbook.addWorksheet("試算表", { views: [{ showGridLines: false }] });
  const styles = { spacing: spacingConfig(state.displayOptions.tableSpacing), font: fontConfig(state.displayOptions.fontSize) };
  const columns = mainColumns(state.displayOptions.showSelfUseTax);
  const giftColumnCount = state.giftTax.enabled && state.giftTax.result ? giftItems(state).length : 0;
  const totalColumns = Math.max(columns.length, giftColumnCount, 3);
  sheet.mergeCells(1, 1, 1, totalColumns);
  const title = sheet.getCell(1, 1); title.value = state.caseName || "土地增值稅試算"; applyFont(title, styles.font.title, true); title.alignment = { horizontal: "center", vertical: "middle" }; sheet.getRow(1).height = styles.spacing.header + 6;

  const main = writeMainTable(sheet, 3, state, totals, styles);
  let row = main.nextRow + 1;
  row = writeGiftTax(sheet, row, state, totalColumns, styles);
  if (row > main.nextRow + 1) row += 1;
  row = writeTaxSummary(sheet, row, state, totals, totalColumns, styles);
  if (row > main.nextRow + 1) row += 1;
  row = writeClauses(sheet, row, state, totalColumns, styles);
  sheet.views = [{ state: "frozen", ySplit: main.headerRow, showGridLines: false }];
  applyPrintSettings(sheet, state, totalColumns, Math.max(1, row - 1));
  return workbook;
}

export function sanitizeExcelFilename(value) {
  const cleaned = String(value || "土地增值稅試算").trim().replace(/[\\/:*?"<>|－]/g, "_");
  return `${cleaned || "土地增值稅試算"}.xlsx`;
}

export async function exportExcel(state, totals) {
  const ExcelJS = await loadExcelJs();
  const workbook = await buildExcelWorkbook(state, totals, ExcelJS);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = sanitizeExcelFilename(state.caseName); anchor.style.display = "none";
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
