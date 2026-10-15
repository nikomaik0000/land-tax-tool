// Shared regression inputs; production calculations remain in proration-calculations.js.
export function goldenCase() {
  return {
    schemaVersion: 5,
    shared: { caseName: "立源富立方", seller: "立源", handoverDate: "2026-10-01", notes: [] },
    customer: {
      id: "golden", label: "6-A3", buyer: "鄭啟明", note: "",
      houseTax: { amount: 46845, taxableMonths: 13, taxStartDate: "2025-06-01", prorationStartDate: "2026-07-01", prorationEndDate: "2026-10-01", payer: "buyer", taxNote: "" },
      landTax: { declaredLandValue: 5760, area: 9795.24, shareNumerator: 873, shareDenominator: 100000, rate: 1, taxYear: 2026, prorationStartDate: "2026-01-01", prorationEndDate: "2026-10-01", payer: "seller", legacyAmount: "" }
    }
  };
}
