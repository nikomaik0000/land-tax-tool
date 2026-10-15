import test from "node:test";
import assert from "node:assert/strict";
import { goldenCase } from "./proration-fixtures.mjs";
import { createBatchRow, createBatchState } from "./proration-batch-state.js";
import { createBatchWorkspace, commonFromSingle } from "./proration-batch-workspace.js";

const ready = () => {
  const workspace = createBatchWorkspace(), batch = createBatchState(commonFromSingle(goldenCase()));
  batch.rows = [createBatchRow(goldenCase(), { id: "a" }), createBatchRow({ ...goldenCase(), customer: { ...goldenCase().customer, label: "B" } }, { id: "b" })];
  for (const row of batch.rows) { delete row.values.customer.houseTax.payer; delete row.values.shared; }
  workspace.replace(batch); return workspace;
};
test("copy single only copies common fields and notes with no shared references", () => {
  const single = goldenCase(); single.shared.notes.push({ id: "n", content: "原備註" });
  const common = commonFromSingle(single);
  for (const field of ["label", "buyer", "id"]) assert.equal(common.customer[field], undefined);
  assert.equal(common.customer.houseTax.amount, undefined);
  assert.equal(common.customer.landTax.area, single.customer.landTax.area);
  assert.equal(common.customer.landTax.shareDenominator, single.customer.landTax.shareDenominator);
  assert.equal(common.customer.landTax.declaredLandValue, single.customer.landTax.declaredLandValue);
  common.shared.notes[0].content = "改變"; assert.equal(single.shared.notes[0].content, "原備註");
});
test("common changes, overrides, invalid overrides and clearing use existing resolver", () => {
  const w = ready(); assert.equal(w.evaluated[0].results.total, -7331);
  w.updateField("b", "customer.houseTax.payer", "buyer"); w.setCommon("customer.houseTax.payer", "seller");
  assert.deepEqual(w.evaluated.map((r) => r.results.total), [14727, -7331]);
  w.updateField("b", "customer.houseTax.payer", "bad"); assert.equal(w.evaluated[1].valid, false);
  w.updateField("b", "customer.houseTax.payer", ""); assert.equal(w.evaluated[1].results.total, 14727);
});
test("invalid rows cannot select and repaired rows require explicit reselection", () => {
  const w = ready(); w.updateField("a", "customer.houseTax.amount", "bad");
  assert.equal(w.select("a", true), false); assert.equal(w.batch.rows[0].selected, false);
  w.updateField("a", "customer.houseTax.amount", 46845); assert.equal(w.evaluated[0].canOutput, false);
  w.selectAll(true); assert.equal(w.counts.selected, 2);
  w.selectAll(false); assert.equal(w.counts.selected, 0);
});
test("duplicate labels refresh every affected row and recover after edit", () => {
  const w = ready(); w.updateField("b", "customer.label", "6-A3"); assert.equal(w.counts.invalid, 2);
  w.updateField("b", "customer.label", "B"); assert.equal(w.counts.valid, 2); assert.equal(w.counts.selected, 0);
});
test("import and row edits do not mutate source snapshot or single state", () => {
  const w = createBatchWorkspace(), single = goldenCase(), before = structuredClone(single);
  const batch = createBatchState(commonFromSingle(single)); batch.rows = [createBatchRow(single, { id: "a" })];
  w.replace(batch); w.updateField("a", "customer.buyer", "修改"); w.setCommon("shared.seller", "共用修改");
  assert.deepEqual(single, before); assert.equal(batch.rows[0].values.customer.buyer, "鄭啟明");
});
test("explicit web edit retires Excel percent-format error without discarding source raw", () => {
  const w = ready(), row = w.batch.rows[0]; row.values.customer.landTax.rate = 0.01;
  row.source.cells = [{ path: "customer.landTax.rate", raw: 0.01, numberFormat: "0%" }]; w.refresh(); assert.equal(w.evaluated[0].valid, false);
  w.updateField("a", "customer.landTax.rate", "1"); assert.equal(w.evaluated[0].valid, true); assert.equal(row.source.cells[0].raw, 0.01);
});
test("shared land defaults inherit, override, report invalid individual and respond to common edits", () => {
  const w = createBatchWorkspace(), batch = createBatchState({ shared: { seller: "立源", notes: [] }, customer: { houseTax: goldenCase().customer.houseTax, landTax: { ...goldenCase().customer.landTax, area: 9795.24, shareDenominator: 100000, declaredLandValue: 5760 } } });
  batch.rows = [createBatchRow({ customer: { label: "A1", buyer: "鄭啟明", landTax: { shareNumerator: 873 } } }, { id: "a" }), createBatchRow({ customer: { label: "A2", buyer: "鄭啟明", landTax: { shareNumerator: 873, declaredLandValue: 5760 } } }, { id: "b" })];
  w.replace(batch);
  assert.deepEqual(w.evaluated.map((r) => r.results.total), [-7331, -7331]);
  assert.equal(w.evaluated[0].origins["customer.landTax.area"], "common");
  w.setCommon("customer.landTax.declaredLandValue", 5000);
  assert.notEqual(w.evaluated[0].results.land.taxAmount, w.evaluated[1].results.land.taxAmount);
  w.updateField("a", "customer.landTax.declaredLandValue", "bad");
  assert.equal(w.evaluated[0].valid, false);
  assert.equal(w.evaluated[0].origins["customer.landTax.declaredLandValue"], "individual");
  w.updateField("a", "customer.landTax.declaredLandValue", "");
  assert.equal(w.evaluated[0].valid, true);
  w.setCommon("customer.landTax.area", ""); assert.equal(w.evaluated[0].valid, false);
  w.updateField("a", "customer.landTax.area", 9795.24); assert.equal(w.evaluated[0].valid, true);
  w.setCommon("customer.landTax.shareDenominator", ""); assert.equal(w.evaluated[0].valid, false);
});
