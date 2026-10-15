import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testExcelJs } from "./proration-excel-test-library.mjs";
import { readBatchExcel } from "./proration-batch-excel.js";
import { buildBatchPrintPages, prepareBatchPrint } from "./proration-batch-print.js";
import { setField } from "./proration-batch-state.js";

const ExcelJS = await testExcelJs();
const fixture = new URL("../reference/fixtures/proration-batch/", import.meta.url);
const common = JSON.parse(await readFile(new URL("common.json", fixture), "utf8"));
const golden = await readBatchExcel(await readFile(new URL("golden.xlsx", fixture)), { ExcelJS, common });

test("selected valid rows print in source order with existing complete report", () => {
  const batch = structuredClone(golden.batch), seed = batch.rows[0];
  batch.common.shared.notes = [{ id: "common", content: "共同備註" }];
  batch.rows = ["A", "B", "C"].map((name, index) => {
    const row = structuredClone(seed); row.id = name; row.selected = index !== 1;
    setField(row.values, "customer.label", name);
    setField(row.values, "customer.doorplate", `${index + 1}號`);
    setField(row.values, "customer.houseTax.taxNote", `房屋備註 ${name}`);
    setField(row.values, "customer.note", `個別備註 ${name}`);
    return row;
  });
  const pages = buildBatchPrintPages(batch);
  assert.deepEqual(pages.map((page) => page.id), ["A", "C"]);
  for (const [index, page] of pages.entries()) {
    const name = index ? "C" : "A", other = index ? "A" : "C";
    for (const text of [`${name}（${index ? 3 : 1}號）`, "鄭啟明", "立源", "房屋稅分算", "地價稅分算", "最終找補", "11,029", "3,698", "7,331", "共同備註", `房屋備註 ${name}`, `個別備註 ${name}`]) assert.ok(page.html.includes(text), text);
    assert.ok(!page.html.includes(`個別備註 ${other}`));
  }
});

test("invalid or unselected rows do not print, and user text is escaped", () => {
  const batch = structuredClone(golden.batch);
  setField(batch.rows[0].values, "customer.doorplate", '<img src=x onerror="alert(1)">');
  assert.equal(buildBatchPrintPages(batch).length, 1);
  assert.ok(buildBatchPrintPages(batch)[0].html.includes("&lt;img"));
  batch.rows[0].selected = false;
  assert.equal(buildBatchPrintPages(batch).length, 0);
  batch.rows[0].selected = true;
  setField(batch.rows[0].values, "customer.houseTax.amount", "bad");
  assert.equal(buildBatchPrintPages(batch).length, 0);
  assert.equal(prepareBatchPrint(batch).invalidSelected.length, 1);
  assert.match(prepareBatchPrint(batch).invalidSelected[0].reason, /數字|房屋稅/);
});
