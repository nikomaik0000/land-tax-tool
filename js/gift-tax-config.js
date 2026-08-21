// Taiwan gift tax configuration.
// Current values apply to gifts on/after 2025-01-01.
// Keep tax thresholds configurable because Ministry of Finance
// may announce future inflation-adjusted amounts.
export const giftTaxConfig = {
  effectiveFrom: "2025-01-01",
  exemption: 2440000,
  brackets: [
    { label: "第一級", upTo: 28110000, rate: 0.10, baseTax: 0, excessOver: 0 },
    { label: "第二級", upTo: 56210000, rate: 0.15, baseTax: 2811000, excessOver: 28110000 },
    { label: "第三級", upTo: Infinity, rate: 0.20, baseTax: 7026000, excessOver: 56210000 }
  ]
};
