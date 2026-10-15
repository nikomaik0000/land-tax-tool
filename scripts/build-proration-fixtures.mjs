import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { testExcelJs } from "../js/proration-excel-test-library.mjs";
import { BATCH_COLUMNS } from "../js/proration-batch-excel.js";
import { getField } from "../js/proration-batch-state.js";
import { goldenCase } from "../js/proration-fixtures.mjs";

const ExcelJS = await testExcelJs();
const root = process.env.PRORATION_FIXTURE_OUTPUT_DIR
  ? pathToFileURL(`${resolve(process.env.PRORATION_FIXTURE_OUTPUT_DIR)}/`)
  : new URL("../reference/fixtures/proration-batch/", import.meta.url);
await mkdir(root, { recursive: true });
// Keep these checked-in samples in the original 23-column format so they test
// backward compatibility. Current 24-column templates are built in the tests.
const legacyColumns = [
  ["selected", "是否輸出"], ["customer.label", "戶別"], ["customer.buyer", "買方"],
  ["customer.houseTax.amount", "房屋稅額"], ["customer.landTax.declaredLandValue", "申報地價（元／㎡）"],
  ["customer.landTax.area", "土地面積（㎡）"], ["customer.landTax.shareNumerator", "土地持分分子"],
  ["customer.landTax.shareDenominator", "土地持分分母"], ["customer.houseTax.taxNote", "房屋稅備註"],
  ["customer.note", "其他備註"], ["shared.caseName", "案件名稱（選填）"], ["shared.seller", "賣方（選填）"],
  ["shared.handoverDate", "交屋日／分算基準日（選填）"], ["customer.houseTax.taxableMonths", "房屋稅課稅月數（選填）"],
  ["customer.houseTax.taxStartDate", "房屋稅完整課稅開始日（選填）"],
  ["customer.houseTax.prorationStartDate", "房屋稅本次找補開始日（選填）"],
  ["customer.houseTax.prorationEndDate", "房屋稅本次找補結束日（選填）"], ["customer.houseTax.payer", "房屋稅支付方（選填）"],
  ["customer.landTax.taxYear", "地價稅課稅年度（選填）"],
  ["customer.landTax.prorationStartDate", "地價稅本次找補開始日（選填）"],
  ["customer.landTax.prorationEndDate", "地價稅本次找補結束日（選填）"],
  ["customer.landTax.rate", "地價稅率（%）（選填）"], ["customer.landTax.payer", "地價稅支付方（選填）"]
];
function legacyWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("批次資料").addRow(legacyColumns.map(([, label]) => label));
  workbook.addWorksheet("填寫說明").addRow(["範本版本", 1]);
  return workbook;
}
const golden = goldenCase();
const common = structuredClone(golden);
for (const key of ["id", "label", "buyer", "note"]) delete common.customer[key];
delete common.customer.houseTax.amount;
for (const key of ["declaredLandValue", "area", "shareNumerator", "shareDenominator", "legacyAmount"]) delete common.customer.landTax[key];
await writeFile(new URL("common.json", root), JSON.stringify(common, null, 2) + "\n");
const cellFor = (sheet, row, path) => sheet.getCell(row, legacyColumns.findIndex(([field]) => field === path) + 1);
function fillRow(sheet, row, label) {
  legacyColumns.forEach(([path], index) => {
    if (!BATCH_COLUMNS.find((field) => field.path === path)?.override) {
      sheet.getCell(row, index + 1).value = path === "selected" ? "是" : path === "customer.label" ? label : getField(golden, path) ?? "";
    }
  });
}
const empty = legacyWorkbook();
await writeFile(new URL("template.xlsx", root), await empty.xlsx.writeBuffer());
const goldenBook = legacyWorkbook();
fillRow(goldenBook.getWorksheet("批次資料"), 2, "6-A3");
await writeFile(new URL("golden.xlsx", root), await goldenBook.xlsx.writeBuffer());
const mixed = legacyWorkbook(), sheet = mixed.getWorksheet("批次資料");
fillRow(sheet, 2, "A1");
fillRow(sheet, 4, "A2"); cellFor(sheet, 4, "customer.houseTax.amount").value = "wrong";
fillRow(sheet, 5, "A3"); cellFor(sheet, 5, "customer.houseTax.amount").value = { formula: "40000+6845", result: 46845 };
fillRow(sheet, 6, "A4"); cellFor(sheet, 6, "customer.landTax.shareDenominator").value = 0;
fillRow(sheet, 7, "A5"); cellFor(sheet, 7, "shared.handoverDate").value = "115/2/30";
fillRow(sheet, 8, "A6"); cellFor(sheet, 8, "customer.landTax.rate").value = 0.01; cellFor(sheet, 8, "customer.landTax.rate").numFmt = "0%";
fillRow(sheet, 9, "A7"); cellFor(sheet, 9, "selected").value = false;
await writeFile(new URL("mixed.xlsx", root), await mixed.xlsx.writeBuffer());
for (const date1904 of [false, true]) {
  const workbook = legacyWorkbook(); workbook.properties.date1904 = date1904;
  const dates = workbook.getWorksheet("批次資料");
  fillRow(dates, 2, "serial"); cellFor(dates, 2, "shared.handoverDate").value = date1904 ? 44834 : 46296;
  fillRow(dates, 3, "date"); cellFor(dates, 3, "shared.handoverDate").value = new Date("2026-10-01T00:00:00Z"); cellFor(dates, 3, "shared.handoverDate").numFmt = "yyyy-mm-dd";
  await writeFile(new URL(`dates-${date1904 ? 1904 : 1900}.xlsx`, root), await workbook.xlsx.writeBuffer());
}
console.log("Created template and four XLSX regression fixtures with common.json.");
