import test from "node:test";
import assert from "node:assert/strict";
import { goldenCase } from "./proration-fixtures.mjs";
import { calculateHouseTax, calculateLandTax, calculateProration, calculateCombinedSettlement, settlementText } from "./proration-calculations.js";
import { normalizeProrationState } from "./proration-state.js";
import { buildCaseFile, parseCaseFile } from "./case-file.js";
import { renderProrationReport } from "./proration-report.js";

test("Golden opposite-direction offset and report use the same state", () => {
  const state = goldenCase();
  const house = calculateHouseTax(state.customer.houseTax), land = calculateLandTax(state.customer.landTax);
  const total = calculateCombinedSettlement(house, land);
  assert.deepEqual([house.totalTaxDays, house.prorationDays, house.prorationAmount, land.totalTaxDays, land.prorationDays, land.prorationAmount, total], [395, 93, 11029, 365, 274, 3698, -7331]);
  assert.equal(settlementText(total, state.customer.buyer, state.shared.seller), "立源應補鄭啟明 $7,331");
  const html = renderProrationReport(state, { house, land, total });
  for (const text of ["11,029", "3,698", "7,331", "立源應補鄭啟明", "鄭啟明應補立源"]) assert.ok(html.includes(text));
});
test("same-direction addition is distinct from Golden offset", () => {
  const { houseTax, landTax } = goldenCase().customer;
  for (const [payer, expected] of [["buyer", -14727], ["seller", 14727]]) {
    assert.equal(calculateCombinedSettlement(calculateHouseTax({ ...houseTax, payer }), calculateLandTax({ ...landTax, payer })), expected);
  }
});
for (const [start, months, end, days] of [
  ["2025-01-01", 12, "2025-12-31", 365], ["2024-01-01", 12, "2024-12-31", 366],
  ["2025-06-01", 13, "2026-06-30", 395], ["2023-06-01", 13, "2024-06-30", 396],
  ["2024-02-29", 12, "2025-02-27", 365], ["2026-01-31", 1, "2026-02-27", 28]
]) test(`calendar period ${start} / ${months} months`, () => {
  const result = calculateHouseTax({ amount: 100, taxableMonths: months, taxStartDate: start, prorationStartDate: start, prorationEndDate: end, payer: "seller" });
  assert.equal(result.valid, true); assert.equal(result.taxEndDate, end); assert.equal(result.totalTaxDays, days);
});
test("inclusive days, invalid dates, reversed and excessive periods", () => {
  const base = { amount: 100, totalTaxDays: 365, prorationStartDate: "2026-10-01", prorationEndDate: "2026-10-01" };
  assert.equal(calculateProration(base).prorationDays, 1);
  for (const date of ["2026-02-29", "2026-02-30", "115/10/1", "2026-13-01"]) assert.equal(calculateProration({ ...base, prorationStartDate: date }).valid, false);
  assert.equal(calculateProration({ ...base, prorationEndDate: "2026-09-30" }).valid, false);
  assert.equal(calculateProration({ ...base, prorationEndDate: "2027-10-01" }).valid, false);
});
test("rounding order is tax basis, full tax, then proration", () => {
  const result = calculateLandTax({ ...goldenCase().customer.landTax, declaredLandValue: 100.49, area: 1, shareNumerator: 1, shareDenominator: 1, rate: 0.5 });
  assert.equal(result.taxableLandValue, 100); assert.equal(result.taxAmount, 1); assert.equal(result.prorationAmount, 1);
  const base = { totalTaxDays: 2, prorationStartDate: "2026-01-01", prorationEndDate: "2026-01-01" };
  assert.equal(calculateProration({ ...base, amount: 2.5 }).prorationAmount, 2);
  assert.equal(calculateProration({ ...base, amount: 2.49 }).prorationAmount, 1);
});
for (const version of [2, 4, 5]) test(`saved single JSON version ${version} restores`, () => {
  const state = goldenCase(); state.schemaVersion = version;
  const restored = normalizeProrationState(parseCaseFile(JSON.stringify(buildCaseFile("tax-proration", state)), "tax-proration").data);
  assert.equal(calculateCombinedSettlement(calculateHouseTax(restored.customer.houseTax), calculateLandTax(restored.customer.landTax)), -7331);
});
test("legacy land amount and approved house amount survive old JSON import", () => {
  const state = goldenCase(); state.schemaVersion = 2;
  state.customer.houseTax.approvedAmount = state.customer.houseTax.amount; delete state.customer.houseTax.amount;
  state.customer.landTax = { amount: 4926, taxYear: 2026, prorationStartDate: "2026-01-01", prorationEndDate: "2026-10-01", payer: "seller" };
  const restored = normalizeProrationState(parseCaseFile(JSON.stringify(buildCaseFile("tax-proration", state)), "tax-proration").data);
  assert.equal(calculateHouseTax(restored.customer.houseTax).prorationAmount, 11029);
  assert.equal(calculateLandTax(restored.customer.landTax).prorationAmount, 3698);
});
