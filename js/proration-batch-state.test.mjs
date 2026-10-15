import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { goldenCase } from "./proration-fixtures.mjs";
import { isBlank, normalizeInput, normalizeDate } from "./proration-input-normalization.js";
import { createBatchState, createBatchRow, evaluateBatchRow, evaluateBatch } from "./proration-batch-state.js";
import { calculateHouseTax, calculateLandTax, calculateCombinedSettlement } from "./proration-calculations.js";
import { renderProrationReport } from "./proration-report.js";

test("merge, override, clear, zero, false and common changes preserve raw data", () => {
  const common = goldenCase(), row = createBatchRow({ customer: { label: "A1", houseTax: { amount: 0 } } }, { selected: false });
  const before = structuredClone({ common, row });
  let result = evaluateBatchRow(common, row);
  assert.equal(result.valid, true); assert.equal(result.state.customer.houseTax.amount, 0); assert.equal(result.selected, false);
  assert.equal(result.origins["customer.houseTax.amount"], "individual");
  assert.deepEqual({ common, row }, before);
  common.customer.houseTax.amount = 900;
  assert.equal(evaluateBatchRow(common, row).state.customer.houseTax.amount, 0);
  row.values.customer.houseTax.amount = "  ";
  assert.equal(evaluateBatchRow(common, row).state.customer.houseTax.amount, 900);
  assert.equal(isBlank(false), false); assert.equal(isBlank(0), false);
});
test("invalid individual never falls back; missing fields never gain single-case defaults", () => {
  const row = createBatchRow({ customer: { houseTax: { amount: "oops" } } });
  const result = evaluateBatchRow(goldenCase(), row);
  assert.equal(result.valid, false); assert.equal(result.state.customer.houseTax.amount, "");
  assert.equal(row.values.customer.houseTax.amount, "oops");
  const empty = evaluateBatchRow({}, createBatchRow());
  for (const path of ["customer.landTax.shareNumerator", "customer.landTax.shareDenominator", "customer.houseTax.payer", "customer.landTax.payer"]) assert.ok(empty.errors.some((e) => e.path === path));
});
test("common notes and individual notes are separate and both reach existing renderer", () => {
  const common = goldenCase(); common.shared.notes = [{ id: "n", content: "共用備註" }];
  const row = createBatchRow({ customer: { note: "個別備註" } });
  const result = evaluateBatchRow(common, row);
  assert.equal(common.shared.notes.length, 1); assert.equal(row.values.customer.note, "個別備註");
  const html = renderProrationReport(result.state, result.results);
  assert.ok(html.includes("共用備註")); assert.ok(html.includes("個別備註"));
});
test("Golden batch and single calculation have full result parity", () => {
  const state = goldenCase(), result = evaluateBatchRow(state, createBatchRow());
  const house = calculateHouseTax(state.customer.houseTax), land = calculateLandTax(state.customer.landTax);
  assert.equal(result.valid, true);
  assert.deepEqual(result.results, { house, land, total: calculateCombinedSettlement(house, land) });
  assert.equal(result.results.total, -7331);
});
test("doorplate remains separate text and batch report title uses the existing renderer", () => {
  const common = goldenCase();
  const row = createBatchRow({ customer: { label: "6樓A3", doorplate: "1之2號六樓" } });
  const result = evaluateBatchRow(common, row);
  assert.equal(result.valid, true);
  assert.equal(result.state.customer.label, "6樓A3");
  assert.equal(result.state.customer.doorplate, "1之2號六樓");
  assert.equal(row.values.customer.doorplate, "1之2號六樓");
  assert.match(renderProrationReport(result.state, result.results, { batch: true }), /<h2>6樓A3（1之2號六樓） 立源富立方<\/h2>/);
  assert.match(renderProrationReport(result.state, result.results), /<h2>立源富立方<\/h2>/);
  result.state.customer.doorplate = "";
  assert.match(renderProrationReport(result.state, result.results, { batch: true }), /<h2>6樓A3 立源富立方<\/h2>/);
  result.state.shared.caseName = "";
  assert.match(renderProrationReport(result.state, result.results, { batch: true }), /<h2>6樓A3 地價稅房屋稅 分算找補<\/h2>/);
  result.state.customer.label = ""; result.state.customer.doorplate = "1之2號六樓"; result.state.shared.caseName = "";
  assert.match(renderProrationReport(result.state, result.results, { batch: true }), /<h2>（1之2號六樓） 地價稅房屋稅 分算找補<\/h2>/);
  assert.match(renderProrationReport(result.state, result.results), /<h2>地價稅房屋稅 分算找補<\/h2>/);
  result.state.customer.label = "<b>"; result.state.customer.doorplate = '<img src=x onerror="alert(1)">';
  result.state.shared.caseName = '<script>alert(1)</script>';
  const escaped = renderProrationReport(result.state, result.results, { batch: true });
  assert.match(escaped, /<h2>&lt;b&gt;（&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;） &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h2>/);
  assert.ok(!escaped.includes("<img") && !escaped.includes("<script>"));
  assert.equal(result.results.total, -7331);
});
test("numeric or date doorplate is rejected without changing label validation", () => {
  const common = goldenCase();
  for (const doorplate of [123, new Date("2026-10-01T00:00:00Z")]) {
    const row = createBatchRow({ customer: { label: "A1", doorplate } });
    const result = evaluateBatchRow(common, row);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === "customer.doorplate"));
    assert.equal(row.values.customer.label, "A1");
    assert.deepEqual(row.values.customer.doorplate, doorplate);
  }
});
test("invalid rows and duplicate labels do not block other rows", () => {
  const batch = createBatchState(goldenCase());
  batch.rows = [createBatchRow({ customer: { label: "A1" } }), createBatchRow({ customer: { label: "A2", landTax: { shareDenominator: 0 } } }), createBatchRow({ customer: { label: "A3" } }), createBatchRow({ customer: { label: "A3" } })];
  assert.deepEqual(evaluateBatch(batch).map((row) => row.canOutput), [true, false, false, false]);
});
test("negative, fractional months, unsafe ranges and unknown payer rejected", () => {
  for (const houseTax of [{ amount: -1 }, { taxableMonths: 1.5 }, { taxableMonths: 999999999 }, { payer: "unknown" }, { amount: false }]) {
    assert.equal(evaluateBatchRow(goldenCase(), createBatchRow({ customer: { houseTax } })).valid, false);
  }
});
for (const value of ["2026/10/1", "2026-10-01", "115/10/1", "0115/10/01", 46296, new Date("2026-10-01T00:00:00Z")]) test(`date normalization ${String(value)}`, () => {
  assert.equal(normalizeDate(value).value, "2026-10-01");
});
test("1904 system, fractional serial, leap dates and invalid dates", () => {
  assert.equal(normalizeDate(44834, { date1904: true }).value, "2026-10-01");
  assert.equal(normalizeDate(46296.5).warnings.length, 1);
  assert.equal(normalizeDate("113/2/29").value, "2024-02-29");
  for (const value of [60, "115/2/29", "2026/2/30", "2026/13/1", "1796/10/1", new Date(NaN), Infinity, false]) assert.throws(() => normalizeDate(value));
});
test("Date normalization is independent of host timezone", () => {
  const moduleUrl = new URL("./proration-input-normalization.js", import.meta.url).href;
  for (const TZ of ["Asia/Taipei", "America/Los_Angeles", "UTC"]) {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import { normalizeDate } from ${JSON.stringify(moduleUrl)}; console.log(normalizeDate(new Date('2026-10-01T00:00:00Z')).value);`], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(output.trim(), "2026-10-01");
  }
});
test("strict numbers, percent units, payer and boolean", () => {
  assert.equal(normalizeInput("46,845", "number").value, 46845);
  assert.equal(normalizeInput("1", "number").value, 1);
  assert.equal(normalizeInput("115", "year").value, 2026);
  assert.equal(normalizeInput("賣方", "payer").value, "seller");
  assert.equal(normalizeInput(false, "boolean").value, false);
  for (const value of ["123abc", "1%", "1,2", "NaN", "Infinity", true, {}, { formula: "1+1", result: 2 }]) assert.throws(() => normalizeInput(value, "number"));
});
