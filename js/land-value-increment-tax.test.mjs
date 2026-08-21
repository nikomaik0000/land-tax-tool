import assert from "node:assert/strict";
import {
  calculateLandValueIncrementTax,
  getHoldingPeriodReduction,
  getLandTaxBracket
} from "./land-value-increment-tax.js";

const closeTo = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const b = 1_000_000;
const holdingCases = [
  { years: 20, rates: [0.20, 0.30, 0.40], factors: [0, 0.10, 0.30] },
  { years: 25, rates: [0.20, 0.28, 0.36], factors: [0, 0.08, 0.24] },
  { years: 35, rates: [0.20, 0.27, 0.34], factors: [0, 0.07, 0.21] },
  { years: 41, rates: [0.20, 0.26, 0.32], factors: [0, 0.06, 0.18] }
];

assert.equal(getLandTaxBracket(0.9999), 1);
assert.equal(getLandTaxBracket(1), 2);
assert.equal(getLandTaxBracket(1.9999), 2);
assert.equal(getLandTaxBracket(2), 3);
assert.deepEqual(getHoldingPeriodReduction(20), { reductionRate: 0, secondLevelProgressiveFactor: 0.10, thirdLevelProgressiveFactor: 0.30 });
assert.equal(getHoldingPeriodReduction(30).reductionRate, 0.20);
assert.equal(getHoldingPeriodReduction(40).reductionRate, 0.30);
assert.equal(getHoldingPeriodReduction(40.0001).reductionRate, 0.40);

for (const { years, rates, factors } of holdingCases) {
  for (const [index, a] of [b * 0.5, b * 1.5, b * 2.5].entries()) {
    const expected = a * rates[index] - b * factors[index];
    const startYear = 2026 - years - 1911;
    const result = calculateLandValueIncrementTax({
      area: 1,
      announcedValue: b + a,
      shareNumerator: 1,
      shareDenominator: 1,
      previousValue: b,
      priceIndex: 100,
      previousTransferDate: `${startYear}年8月`,
      calculationDate: "2026-08-20"
    });
    closeTo(result.assessedTax, expected);
    assert.equal(result.generalTax, Math.round(expected));
  }
}

// reference/土地增值稅試算 PDF 範例.pdf（新北不動產愛連網）
const government = calculateLandValueIncrementTax({
  area: 1093.02,
  announcedValue: 23300,
  shareNumerator: 1,
  shareDenominator: 1,
  previousValue: 1100,
  priceIndex: 178.2,
  previousTransferDate: "79年6月",
  calculationDate: "2026-08-17",
  creditableLandTax: 0
});
assert.equal(government.valid, true);
closeTo(government.currentLandValue, 25467366);
closeTo(government.adjustedPreviousValue, 2142537.804);
closeTo(government.landIncreaseAmount, 23324828.196);
assert.equal(government.bracket, 3);
assert.equal(government.selfUseTax, 2332483);
assert.equal(government.generalTax, 7480509);

const cpi321 = calculateLandValueIncrementTax({
  area: 1,
  announcedValue: 5000,
  shareNumerator: 1,
  shareDenominator: 1,
  previousValue: 1000,
  priceIndex: 321,
  previousTransferDate: "66年10月",
  calculationDate: "2026-08-20"
});
assert.equal(cpi321.cpiMultiplier, 3.21);
assert.equal(cpi321.adjustedPreviousValue, 3210);

const incomplete = calculateLandValueIncrementTax({ area: 1 });
assert.equal(incomplete.valid, false);
assert.equal(incomplete.selfUseTax, undefined);
assert.equal(incomplete.generalTax, undefined);

console.log("land-value-increment-tax: all official quick-table and government PDF regressions passed");
