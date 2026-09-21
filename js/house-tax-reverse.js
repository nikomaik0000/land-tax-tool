export const HOUSE_TAX_RATE_OPTIONS = Object.freeze([
  { label: "1.0%", value: 0.01 },
  { label: "1.2%", value: 0.012 },
  { label: "1.5%", value: 0.015 },
  { label: "2.0%", value: 0.02 },
  { label: "2.4%", value: 0.024 },
  { label: "3.6%", value: 0.036 },
  { label: "4.8%", value: 0.048 }
]);

export function estimateHouseValue(annualHouseTax, taxRate) {
  const tax = Number(annualHouseTax);
  const rate = Number(taxRate);
  return Number.isFinite(tax) && tax > 0 && Number.isFinite(rate) && rate > 0 ? Math.round(tax / rate) : null;
}

export function updateHouseReverseEstimate(house, { annualHouseTax = house.annualHouseTax, reverseTaxRate = house.reverseTaxRate } = {}) {
  house.annualHouseTax = annualHouseTax;
  house.reverseTaxRate = reverseTaxRate;
  house.estimatedHouseValue = estimateHouseValue(annualHouseTax, reverseTaxRate);
  return house.estimatedHouseValue;
}

export function applyEstimatedHouseValue(house) {
  const estimated = updateHouseReverseEstimate(house);
  if (estimated == null) return false;
  house.assessedValue = estimated;
  return true;
}
