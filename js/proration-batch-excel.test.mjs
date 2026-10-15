import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExcelJs } from "./proration-excel-test-library.mjs";
import { goldenCase } from "./proration-fixtures.mjs";
import { buildBatchTemplate, BATCH_COLUMNS, readBatchExcel, parseBatchWorkbook } from "./proration-batch-excel.js";
import { evaluateBatch } from "./proration-batch-state.js";
import { buildProrationWorkbook } from "./proration-excel.js";
import { calculateHouseTax, calculateLandTax, calculateCombinedSettlement, settlementText } from "./proration-calculations.js";

const ExcelJS = await testExcelJs();
const root = new URL("../reference/fixtures/proration-batch/", import.meta.url);
const common = JSON.parse(await readFile(new URL("common.json", root), "utf8"));
const load = (name, options = {}) => readFile(new URL(name, root)).then((buffer) => readBatchExcel(buffer, { common, ExcelJS, ...options }));
const workbookFrom = async (name = "golden.xlsx") => { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(new URL(name, root))); return workbook; };
const column = (path) => BATCH_COLUMNS.findIndex((field) => field.path === path) + 1;
const legacyPaths = ["selected", "customer.label", "customer.buyer", "customer.houseTax.amount", "customer.landTax.declaredLandValue", "customer.landTax.area", "customer.landTax.shareNumerator", "customer.landTax.shareDenominator", "customer.houseTax.taxNote", "customer.note", "shared.caseName", "shared.seller", "shared.handoverDate", "customer.houseTax.taxableMonths", "customer.houseTax.taxStartDate", "customer.houseTax.prorationStartDate", "customer.houseTax.prorationEndDate", "customer.houseTax.payer", "customer.landTax.taxYear", "customer.landTax.prorationStartDate", "customer.landTax.prorationEndDate", "customer.landTax.rate", "customer.landTax.payer"];
const legacyColumn = (path) => legacyPaths.indexOf(path) + 1;

test("real XLSX Golden -> common resolve -> existing single calculators", async () => {
  const { batch, evaluated } = await load("golden.xlsx");
  const state = goldenCase(), house = calculateHouseTax(state.customer.houseTax), land = calculateLandTax(state.customer.landTax);
  assert.equal(evaluated[0].valid, true);
  assert.deepEqual(evaluated[0].results, { house, land, total: calculateCombinedSettlement(house, land) });
  assert.deepEqual([house.prorationAmount, land.prorationAmount, evaluated[0].results.total], [11029, 3698, -7331]);
  assert.equal(settlementText(evaluated[0].results.total, evaluated[0].state.customer.buyer, evaluated[0].state.shared.seller), "立源應補鄭啟明 $7,331");
  assert.equal(batch.rows[0].source.rowNumber, 2);
  assert.equal(evaluated[0].state.customer.doorplate, "");
  assert.equal(evaluated[0].origins["customer.houseTax.taxableMonths"], "common");
});
test("real mixed workbook keeps invalid raw rows and ignores blank row", async () => {
  const { batch, evaluated } = await load("mixed.xlsx");
  assert.deepEqual(batch.rows.map((row) => row.source.rowNumber), [2, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(evaluated.map((row) => row.valid), [true, false, false, false, false, false, true]);
  assert.equal(evaluated[6].canOutput, false);
  assert.equal(batch.rows[1].values.customer.houseTax.amount, "wrong");
  assert.deepEqual(batch.rows[2].values.customer.houseTax.amount, { formula: "40000+6845", result: 46845 });
  assert.ok(evaluated[2].errors.some((error) => /公式/.test(error.message)));
  assert.equal(evaluateBatch(batch)[5].valid, false, "reevaluation must retain percent-format issue");
  batch.rows[1].values.customer.houseTax.amount = 46845;
  assert.equal(evaluateBatch(batch)[1].valid, true, "editing repairs original row");
});
for (const system of [1900, 1904]) test(`real ${system} workbook date serial and Date cell`, async () => {
  const { evaluated } = await load(`dates-${system}.xlsx`);
  assert.deepEqual(evaluated.map((row) => row.state.shared.handoverDate), ["2026-10-01", "2026-10-01"]);
  assert.ok(evaluated.every((row) => row.valid));
});
test("column reordering survives XLSX write/read", async () => {
  const original = await workbookFrom(), sheet = original.getWorksheet("批次資料");
  const headers = legacyPaths.map((_, index) => sheet.getCell(1, index + 1).value).reverse();
  const values = legacyPaths.map((_, index) => sheet.getCell(2, index + 1).value).reverse();
  sheet.getRow(1).values = headers; sheet.getRow(2).values = values;
  const result = await readBatchExcel(await original.xlsx.writeBuffer(), { common, ExcelJS });
  assert.equal(result.evaluated[0].results.total, -7331);
});
test("invalid override cannot fall back and clearing inherits again", async () => {
  const workbook = await workbookFrom(), sheet = workbook.getWorksheet("批次資料");
  const cell = sheet.getCell(2, legacyColumn("customer.houseTax.payer")); cell.value = "unknown";
  assert.equal(parseBatchWorkbook(workbook, { common }).evaluated[0].valid, false);
  cell.value = "賣方";
  assert.equal(parseBatchWorkbook(workbook, { common }).evaluated[0].results.total, 14727);
  cell.value = "";
  assert.equal(parseBatchWorkbook(workbook, { common }).evaluated[0].results.total, -7331);
});
test("empty, corrupt, no data, missing, duplicate and unknown headers", async () => {
  await assert.rejects(() => readBatchExcel(new Uint8Array(), { ExcelJS }), /為空/);
  await assert.rejects(() => readBatchExcel(new Uint8Array([1, 2, 3]), { ExcelJS }), /無法讀取/);
  await assert.rejects(() => load("template.xlsx"), /沒有資料列/);
  for (const mode of ["missing", "duplicate", "unknown"]) {
    const workbook = await workbookFrom(), sheet = workbook.getWorksheet("批次資料");
    sheet.getCell(1, 2).value = mode === "missing" ? null : mode === "duplicate" ? "買方" : "戶別錯字";
    assert.throws(() => parseBatchWorkbook(workbook, { common }), /缺少|重複|無法辨識/);
  }
});
test("template columns and snapshot do not overwrite supplied common", async () => {
  const workbook = buildBatchTemplate(common, ExcelJS);
  assert.equal(workbook.getWorksheet("批次資料").columnCount, 24);
  const book = await workbookFrom(); book.getWorksheet("填寫說明").getCell("B7").value = "untrusted snapshot";
  assert.equal(parseBatchWorkbook(book, { common }).evaluated[0].state.shared.caseName, common.shared.caseName);
  book.getWorksheet("填寫說明").getCell("B1").value = 999;
  assert.throws(() => parseBatchWorkbook(book, { common }), /版本/);
});
test("new 24-column template has three header tiers, colors, filters and O-X grouping", async () => {
  assert.deepEqual(BATCH_COLUMNS.map((field) => field.path), [
    "selected", "customer.label", "customer.doorplate", "customer.buyer", "customer.houseTax.amount", "customer.landTax.shareNumerator", "customer.houseTax.taxNote", "customer.note",
    "customer.houseTax.prorationStartDate", "customer.houseTax.prorationEndDate", "customer.houseTax.payer", "customer.landTax.prorationStartDate", "customer.landTax.prorationEndDate", "customer.landTax.payer",
    "shared.caseName", "shared.seller", "shared.handoverDate", "customer.houseTax.taxableMonths", "customer.houseTax.taxStartDate", "customer.landTax.declaredLandValue", "customer.landTax.area", "customer.landTax.shareDenominator", "customer.landTax.taxYear", "customer.landTax.rate"
  ]);
  const current = JSON.parse(JSON.stringify(common));
  current.customer.landTax.area = 9795.24;
  current.customer.landTax.shareDenominator = 100000;
  current.customer.landTax.declaredLandValue = 5760;
  const workbook = buildBatchTemplate(current, ExcelJS);
  const bytes = await workbook.xlsx.writeBuffer(), reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(bytes);
  const sheet = reopened.getWorksheet("批次資料");
  assert.equal(sheet.properties.outlineLevelCol, 1);
  assert.equal(sheet.autoFilter, "A3:X3");
  assert.deepEqual([...sheet.model.merges].sort(), ["A1:D1", "E1:H1", "A2:D2", "G2:H2", "I1:N1", "I2:K2", "L2:N2", "O1:X1", "O2:Q2", "R2:S2", "T2:X2"].sort());
  assert.equal(sheet.views[0].xSplit, 4);
  assert.equal(sheet.properties.defaultRowHeight, 30);
  assert.equal(sheet.getRow(4).height, 30);
  assert.equal(sheet.getRow(3).height, 54);
  for (let index = 1; index <= 24; index += 1) {
    assert.equal(sheet.getColumn(index).hidden, index >= 15, `visibility column ${index}`);
    assert.equal(sheet.getColumn(index).outlineLevel, index >= 15 ? 1 : 0, `group column ${index}`);
    assert.equal(sheet.getColumn(index).collapsed, index >= 15, `collapse column ${index}`);
    const label = BATCH_COLUMNS[index - 1].label;
    assert.equal(sheet.getCell(3, index).value, index >= 9 && index <= 14 ? label.replace(/\s*（選填）\s*/g, "").trim() : label);
    for (const row of [1, 2, 3]) {
      assert.equal(sheet.getCell(row, index).alignment.horizontal, "center");
      assert.equal(sheet.getCell(row, index).alignment.vertical, "middle");
    }
    assert.equal(sheet.getCell(3, index).alignment.wrapText, true);
    assert.equal(sheet.getCell(4, index).alignment.horizontal, [5, 6, 18, 20, 21, 22, 23, 24].includes(index) ? "right" : "center");
    assert.equal(sheet.getCell(4, index).alignment.vertical, "middle");
    const color = index <= 8 ? "FFE4EBE7" : index <= 14 ? "FFE5EBF3" : "FFF0ECE6";
    assert.equal(sheet.getCell(1, index).fill.fgColor.argb, color);
    assert.equal(sheet.getCell(2, index).fill.fgColor.argb, color);
    assert.equal(sheet.getCell(4, index).fill?.fgColor?.argb, undefined);
  }
  assert.deepEqual([sheet.getCell("A1").value, sheet.getCell("E1").value, sheet.getCell("I1").value, sheet.getCell("O1").value], ["主要填寫", "主要填寫", "視情況填寫", "共用設定優先"]);
  assert.equal(sheet.getCell("A1").fill.fgColor.argb, sheet.getCell("E1").fill.fgColor.argb);
  // Expand the group, fill one override, and round-trip through the same parser.
  for (let index = 15; index <= 24; index += 1) sheet.getColumn(index).hidden = false;
  const golden = goldenCase();
  sheet.getCell(4, column("customer.label")).value = golden.customer.label;
  sheet.getCell(4, column("customer.doorplate")).value = "1之2號六樓";
  sheet.getCell(4, column("customer.buyer")).value = golden.customer.buyer;
  sheet.getCell(4, column("customer.houseTax.amount")).value = golden.customer.houseTax.amount;
  sheet.getCell(4, column("customer.landTax.shareNumerator")).value = golden.customer.landTax.shareNumerator;
  sheet.getCell(4, column("customer.houseTax.payer")).value = "買方";
  const directory = await mkdtemp(join(tmpdir(), "proration-batch-v2-"));
  let imported;
  try {
    const filename = join(directory, "v2-golden.xlsx");
    await writeFile(filename, await sheet.workbook.xlsx.writeBuffer());
    imported = await readBatchExcel(await readFile(filename), { ExcelJS, common: current, filename });
  } finally { await rm(directory, { recursive: true, force: true }); }
  assert.equal(imported.evaluated[0].results.total, -7331);
  assert.equal(imported.batch.rows[0].source.rowNumber, 4);
  assert.equal(imported.batch.rows[0].source.sheetName, "批次資料");
  assert.equal(imported.batch.rows[0].source.cells.find((cell) => cell.path === "customer.doorplate").address, "C4");
  assert.equal(imported.evaluated[0].state.customer.doorplate, "1之2號六樓");
  assert.equal(imported.batch.metadata.headerRowNumber, 3);
  assert.equal(imported.batch.metadata.dataStartRow, 4);
  assert.equal(imported.evaluated[0].origins["customer.landTax.area"], "common");
  assert.equal(imported.evaluated[0].origins["customer.houseTax.payer"], "individual");
});
test("prior three-tier optional headers remain importable", async () => {
  const workbook = buildBatchTemplate(goldenCase(), ExcelJS), sheet = workbook.getWorksheet("批次資料");
  for (let index = 9; index <= 14; index += 1) sheet.getCell(3, index).value = ` ${BATCH_COLUMNS[index - 1].label} `;
  sheet.getCell(4, column("customer.label")).value = "6樓A3";
  sheet.getCell(4, column("customer.buyer")).value = "鄭啟明";
  sheet.getCell(4, column("customer.houseTax.amount")).value = 46845;
  sheet.getCell(4, column("customer.landTax.shareNumerator")).value = 873;
  const { evaluated } = await readBatchExcel(await workbook.xlsx.writeBuffer(), { ExcelJS, common: goldenCase() });
  assert.equal(evaluated[0].valid, true);
  assert.deepEqual([evaluated[0].results.house.prorationAmount, evaluated[0].results.land.prorationAmount, evaluated[0].results.total], [11029, 3698, -7331]);
});
test("old ungrouped Golden XLSX still imports with current shared land defaults", async () => {
  const old = await workbookFrom("golden.xlsx"), sheet = old.getWorksheet("批次資料");
  assert.equal(sheet.getCell(1, legacyColumn("customer.landTax.area")).value, "土地面積（㎡）");
  assert.equal(sheet.getColumn(11).hidden, false);
  const current = JSON.parse(JSON.stringify(common));
  current.customer.landTax.area = 9795.24;
  current.customer.landTax.shareDenominator = 100000;
  current.customer.landTax.declaredLandValue = 5760;
  for (const path of ["customer.landTax.area", "customer.landTax.shareDenominator", "customer.landTax.declaredLandValue"]) sheet.getCell(2, legacyColumn(path)).value = "";
  const imported = await readBatchExcel(await old.xlsx.writeBuffer(), { ExcelJS, common: current });
  assert.equal(imported.evaluated[0].results.total, -7331);
  assert.equal(imported.evaluated[0].state.customer.doorplate, "");
});
test("new header mapping and row-local errors retain original cells", async () => {
  const workbook = buildBatchTemplate(goldenCase(), ExcelJS), sheet = workbook.getWorksheet("批次資料");
  for (const row of [4, 6]) {
    sheet.getCell(row, column("customer.label")).value = `A${row}`;
    sheet.getCell(row, column("customer.buyer")).value = "鄭啟明";
    sheet.getCell(row, column("customer.houseTax.amount")).value = 46845;
    sheet.getCell(row, column("customer.landTax.shareNumerator")).value = 873;
  }
  sheet.getCell(4, column("customer.doorplate")).value = "1之2號六樓";
  sheet.getCell(6, column("customer.doorplate")).value = 123;
  // Reorder two text columns; the parser must use row-3 names rather than positions.
  for (const row of [3, 4, 6]) {
    const left = sheet.getCell(row, 3), right = sheet.getCell(row, 4);
    [left.value, right.value] = [right.value, left.value];
  }
  const { batch, evaluated } = await readBatchExcel(await workbook.xlsx.writeBuffer(), { ExcelJS, common: goldenCase() });
  assert.deepEqual(batch.rows.map((row) => row.source.rowNumber), [4, 6]);
  assert.deepEqual(evaluated.map((row) => row.valid), [true, false]);
  assert.equal(evaluated[0].state.customer.doorplate, "1之2號六樓");
  assert.equal(evaluated[0].state.customer.label, "A4");
  assert.equal(batch.rows[1].values.customer.doorplate, 123);
  assert.equal(batch.rows[1].source.cells.find((cell) => cell.path === "customer.doorplate").address, "D6");
  assert.ok(evaluated[1].errors.some((error) => error.path === "customer.doorplate" && error.source.rowNumber === 6));
});
test("single Excel report export remains readable and retains Golden total", async () => {
  const state = goldenCase(), house = calculateHouseTax(state.customer.houseTax), land = calculateLandTax(state.customer.landTax);
  const workbook = await buildProrationWorkbook(state, { house, land, total: -7331 }, ExcelJS);
  const restored = new ExcelJS.Workbook(); await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  const rows = []; restored.getWorksheet("分算找補").eachRow((row) => rows.push(row.values));
  assert.ok(rows.some((row) => row.includes(7331)));
  assert.ok(rows.some((row) => row.includes("立源應補鄭啟明")));
});

test("all requested date text variants and invalid leap serial survive actual XLSX boundaries", async () => {
  for (const raw of ["2026/10/1", "2026-10-01", "115/10/1", "0115/10/01", 46296, new Date("2026-10-01T00:00:00Z")]) {
    const workbook = await workbookFrom(), sheet = workbook.getWorksheet("批次資料");
    const cell = sheet.getCell(2, legacyColumn("shared.handoverDate")); cell.value = raw;
    if (raw instanceof Date) cell.numFmt = "yyyy-mm-dd";
    const { evaluated } = await readBatchExcel(await workbook.xlsx.writeBuffer(), { common, ExcelJS });
    assert.equal(evaluated[0].valid, true); assert.equal(evaluated[0].state.shared.handoverDate, "2026-10-01");
  }
  for (const format of ["General", "yyyy-mm-dd"]) {
    const workbook = await workbookFrom(); const cell = workbook.getWorksheet("批次資料").getCell(2, legacyColumn("shared.handoverDate"));
    cell.value = 60; cell.numFmt = format;
    const { evaluated } = await readBatchExcel(await workbook.xlsx.writeBuffer(), { common, ExcelJS });
    assert.equal(evaluated[0].valid, false);
  }
});
test("invalid per-row dates, shares, rates and payer remain local to their row", async () => {
  for (const [path, value] of [["customer.landTax.rate", "1%"], ["customer.landTax.rate", -1], ["customer.landTax.shareNumerator", 100001], ["customer.houseTax.prorationEndDate", "2026-06-30"], ["customer.landTax.payer", "立源"], ["customer.houseTax.amount", ""]]) {
    const workbook = await workbookFrom(), sheet = workbook.getWorksheet("批次資料");
    sheet.getCell(2, legacyColumn(path)).value = value;
    const { evaluated } = await readBatchExcel(await workbook.xlsx.writeBuffer(), { common, ExcelJS });
    assert.equal(evaluated[0].valid, false, path); assert.equal(evaluated[0].canOutput, false);
  }
});
test("extra unlabelled data is retained as a row error without rejecting valid rows", async () => {
  const workbook = await workbookFrom(), sheet = workbook.getWorksheet("批次資料");
  sheet.getCell("X4").value = "額外資料";
  const { batch, evaluated } = await readBatchExcel(await workbook.xlsx.writeBuffer(), { common, ExcelJS });
  assert.deepEqual(evaluated.map((row) => row.valid), [true, false]);
  assert.equal(batch.rows[1].source.unmappedCells[0].raw, "額外資料");
});
