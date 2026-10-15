import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testExcelJs } from "./proration-excel-test-library.mjs";
import { readBatchExcel } from "./proration-batch-excel.js";
import { buildBatchCaseFile, parseBatchCaseFile, batchCaseFilename } from "./proration-batch-case-file.js";
import { createBatchWorkspace } from "./proration-batch-workspace.js";
import { evaluateBatch, setField } from "./proration-batch-state.js";

const ExcelJS = await testExcelJs();
const fixture = new URL("../reference/fixtures/proration-batch/", import.meta.url);
const common = JSON.parse(await readFile(new URL("common.json", fixture), "utf8"));
async function batchFrom(name = "golden.xlsx") {
  return (await readBatchExcel(await readFile(new URL(name, fixture)), { ExcelJS, common, filename: name })).batch;
}
const roundTrip = (batch) => parseBatchCaseFile(JSON.stringify(buildBatchCaseFile(batch, "2026-10-15T00:00:00.000Z")));

for (const count of [3, 30, 100]) test(`${count} households preserve raw fields, selection, source and calculation`, async () => {
  const batch = await batchFrom();
  const original = batch.rows[0];
  batch.common.shared.notes = [{ id: "shared-note", content: "共同備註" }];
  batch.rows = Array.from({ length: count }, (_, index) => {
    const row = structuredClone(original);
    row.id = `stable-${index}`;
    row.source.rowNumber = index + 2;
    row.selected = index % 3 !== 0;
    setField(row.values, "customer.label", `第${index + 1}戶`);
    setField(row.values, "customer.doorplate", `${index + 1}號六樓`);
    setField(row.values, "customer.houseTax.taxNote", `稅單 ${index + 1}`);
    setField(row.values, "customer.note", `個別備註 ${index + 1}`);
    if (index % 2) setField(row.values, "customer.landTax.declaredLandValue", 5760);
    return row;
  });
  const before = evaluateBatch(batch), file = buildBatchCaseFile(batch), restored = parseBatchCaseFile(JSON.stringify(file)), after = evaluateBatch(restored);
  assert.equal(file.version, 1);
  assert.equal(file.data.schemaVersion, 1);
  assert.deepEqual(restored, batch);
  assert.deepEqual(after.map((row) => row.results), before.map((row) => row.results));
  assert.deepEqual(after.map((row) => row.canOutput), before.map((row) => row.canOutput));
  assert.equal(after[0].results.house.prorationAmount, 11029);
  assert.equal(after[0].results.land.prorationAmount, 3698);
  assert.equal(after[0].results.total, -7331);
  assert.equal(restored.rows.at(-1).source.rowNumber, count + 1);
});

test("invalid rows and original Excel dates survive JSON and can be repaired", async () => {
  const batch = await batchFrom("mixed.xlsx");
  const date = new Date("2026-10-01T00:00:00.000Z");
  setField(batch.rows[0].values, "shared.handoverDate", date);
  batch.rows[0].source.cells.find((cell) => cell.path === "shared.handoverDate").raw = date;
  const restored = roundTrip(batch);
  assert.ok(restored.rows[0].values.shared.handoverDate instanceof Date);
  assert.ok(restored.rows[0].source.cells.find((cell) => cell.path === "shared.handoverDate").raw instanceof Date);
  assert.equal(restored.rows[1].values.customer.houseTax.amount, "wrong");
  assert.deepEqual(restored.rows[2].values.customer.houseTax.amount, { formula: "40000+6845", result: 46845 });
  const workspace = createBatchWorkspace(); workspace.replace(restored);
  assert.equal(workspace.evaluated[1].valid, false);
  assert.equal(workspace.evaluated[1].canOutput, false);
  workspace.updateField(workspace.batch.rows[1].id, "customer.houseTax.amount", "46845");
  assert.equal(workspace.evaluated[1].valid, true);
});

test("case identity, unsupported versions, missing fields and damaged JSON reject without replacing workspace", async () => {
  const batch = await batchFrom(), workspace = createBatchWorkspace(); workspace.replace(batch);
  const original = JSON.stringify(workspace.batch), file = buildBatchCaseFile(batch);
  for (const [change, message] of [
    [(value) => { value.version = 2; }, /不支援此批次案件檔版本/],
    [(value) => { value.data.schemaVersion = 2; }, /不支援此批次資料版本/],
    [(value) => { delete value.data.common; }, /缺少共用設定/],
    [(value) => { delete value.data.rows[0].id; }, /穩定 ID/],
    [(value) => { delete value.data.rows[0].values; }, /原始輸入值/],
    [(value) => { value.pageType = "tax-proration"; }, /不是.*批次案件檔/]
  ]) {
    const candidate = structuredClone(file); change(candidate);
    assert.throws(() => parseBatchCaseFile(JSON.stringify(candidate)), message);
    assert.equal(JSON.stringify(workspace.batch), original);
  }
  assert.throws(() => parseBatchCaseFile("{broken"), /JSON 內容已損壞/);
  assert.equal(JSON.stringify(workspace.batch), original);
});

test("direct schema-v1 batch data migrates safely; older and future schemas reject", async () => {
  const batch = await batchFrom();
  const direct = structuredClone(batch); delete direct.metadata;
  delete direct.common.shared.notes;
  const restored = parseBatchCaseFile(JSON.stringify(direct));
  assert.deepEqual(restored.metadata, {});
  assert.deepEqual(restored.common.shared.notes, []);
  assert.equal(evaluateBatch(restored)[0].results.total, -7331);
  direct.schemaVersion = 0;
  assert.throws(() => parseBatchCaseFile(JSON.stringify(direct)), /不支援此批次資料版本/);
});

test("case filename uses name or fallback and removes unsafe characters", () => {
  const date = new Date(2026, 9, 15);
  assert.equal(batchCaseFilename("立源建案", date), "立源建案_批次分算_2026-10-15.json");
  assert.equal(batchCaseFilename("", date), "地價稅房屋稅分算找補_批次案件_2026-10-15.json");
  assert.equal(batchCaseFilename("立源/建案:*", date), "立源_建案___批次分算_2026-10-15.json");
});
