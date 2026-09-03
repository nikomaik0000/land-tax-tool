import { giftTaxConfig } from "./gift-tax-config.js?v=20260818-16";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nonNegativeMoney(value) {
  return Math.max(0, Math.round(finiteNumber(value)));
}

// 舊表欄名為「契稅 6%」，範例 536,166 × 6% = 32,170（四捨五入）。
export const DEED_TAX_RATE = 0.06;

function validShare(numerator, denominator) {
  const n = Number(numerator); const d = Number(denominator);
  return Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? { numerator: n, denominator: d } : null;
}

export function transferShare(land, transfer) {
  return validShare(transfer?.shareNumerator, transfer?.shareDenominator)
    ?? validShare(land?.shareNumerator, land?.shareDenominator)
    ?? { numerator: 0, denominator: 1 };
}

const gcd = (a, b) => { let x = Math.abs(a); let y = Math.abs(b); while (y) [x, y] = [y, x % y]; return x || 1; };
const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);

export function calculateCombinedTransferShare(land, { reduce = false } = {}) {
  const transfers = (land?.previousTransfers ?? []).filter((transfer) => validShare(transfer?.shareNumerator, transfer?.shareDenominator));
  if (!transfers.length) return transferShare(land, null);
  const denominator = transfers.reduce((value, transfer) => lcm(value, Number(transfer.shareDenominator)), 1);
  const numerator = transfers.reduce((sum, transfer) => sum + Number(transfer.shareNumerator) * (denominator / Number(transfer.shareDenominator)), 0);
  if (!reduce) return { numerator, denominator };
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function calculateTransferCurrentValue(land, transfer) {
  const area = finiteNumber(land?.area); const announcedValue = finiteNumber(land?.announcedValue);
  const { numerator, denominator } = transferShare(land, transfer);
  return denominator ? Math.round(area * announcedValue * numerator / denominator) : 0;
}

export function calculateLandCurrentValue(land) {
  const transfers = (land?.previousTransfers ?? []).filter((transfer) => validShare(transfer?.shareNumerator, transfer?.shareDenominator));
  if (transfers.length) return transfers.reduce((sum, transfer) => sum + calculateTransferCurrentValue(land, transfer), 0);
  return calculateTransferCurrentValue(land, null);
}

export function calculateTotalLandCurrentValue(lands) {
  if (!Array.isArray(lands)) return 0;
  return lands.reduce((sum, land) => sum + calculateLandCurrentValue(land), 0);
}

export function calculateHouseCurrentValue(house) {
  const assessedValue = finiteNumber(house?.assessedValue);
  const numerator = finiteNumber(house?.shareNumerator);
  const denominator = finiteNumber(house?.shareDenominator);
  if (denominator === 0) return 0;
  return Math.round(assessedValue * (numerator / denominator));
}

export function calculateTotalHouseCurrentValue(houses) {
  const seen = new Set();
  return (Array.isArray(houses) ? houses : []).reduce((sum, house) => {
    const key = house?.id ?? house; if (seen.has(key)) return sum; seen.add(key);
    return sum + calculateHouseCurrentValue(house) * Math.max(1, house?.ownerIds?.length ?? (house?.ownerId ? 1 : 0));
  }, 0);
}

export function calculateCaseCurrentValue(lands, house) {
  const houseValue = Array.isArray(house) ? calculateTotalHouseCurrentValue(house) : calculateHouseCurrentValue(house);
  return Math.round(calculateTotalLandCurrentValue(lands) + houseValue);
}

export function calculateTransferTaxTotals(lands) {
  return (Array.isArray(lands) ? lands : []).reduce((totals, land) => {
    for (const transfer of land.previousTransfers ?? []) {
      totals.selfUseTax += Math.round(finiteNumber(transfer.selfUseTax));
      totals.generalTax += Math.round(finiteNumber(transfer.generalTax));
    }
    return totals;
  }, { selfUseTax: 0, generalTax: 0 });
}

export function calculateDeedTax(data) {
  const assessedValue = finiteNumber(data?.house?.assessedValue ?? data?.assessedValue);
  return Math.round(assessedValue * DEED_TAX_RATE);
}

export function calculateHouseOwnerDeedTax(house, ownerIndex = 0) {
  const ownerCount = Math.max(1, house?.ownerIds?.length ?? (house?.ownerId ? 1 : 0));
  const totalTax = Math.round(calculateHouseCurrentValue(house) * ownerCount * DEED_TAX_RATE);
  const base = Math.floor(totalTax / ownerCount); const remainder = totalTax - base * ownerCount;
  return base + (ownerIndex < remainder ? 1 : 0);
}

export function calculateTotalDeedTax(houses) {
  const seen = new Set();
  return (Array.isArray(houses) ? houses : []).reduce((sum, house) => {
    const key = house?.id ?? house; if (seen.has(key)) return sum; seen.add(key);
    const ownerCount = Math.max(1, house?.ownerIds?.length ?? (house?.ownerId ? 1 : 0));
    return sum + Math.round(calculateHouseCurrentValue(house) * ownerCount * DEED_TAX_RATE);
  }, 0);
}

export function calculateTaxSummaryByOwner(state) {
  const groups = new Map();
  const ensure = (ownerId) => {
    if (!ownerId) return null;
    if (!groups.has(ownerId)) groups.set(ownerId, { ownerId, ownerName: state?.owners?.find((owner) => owner.id === ownerId)?.name ?? "", selfUseTax: 0, generalTax: 0, deedTax: 0, landCount: 0, houseCount: 0 });
    return groups.get(ownerId);
  };
  for (const land of state?.lands ?? []) {
    const group = ensure(land.ownerId); if (!group) continue;
    group.landCount += 1;
    for (const transfer of land.previousTransfers ?? []) {
      group.selfUseTax += Math.round(finiteNumber(transfer.selfUseTax));
      group.generalTax += Math.round(finiteNumber(transfer.generalTax));
    }
  }
  const countedHouses = new Set();
  for (const house of state?.houses ?? []) {
    const houseKey = house?.id ?? house; if (countedHouses.has(houseKey)) continue; countedHouses.add(houseKey);
    const isReferenced = (state?.lands ?? []).some((land) => land.houseId === house.id);
    if (!isReferenced && !String(house.address ?? "").trim() && finiteNumber(house.assessedValue) <= 0) continue;
    const ownerIds = house.ownerIds?.length ? house.ownerIds : house.ownerId ? [house.ownerId] : [];
    for (const [ownerIndex, ownerId] of ownerIds.entries()) {
      const group = ensure(ownerId); if (!group) continue;
      group.houseCount += 1; group.deedTax += calculateHouseOwnerDeedTax(house, ownerIndex);
    }
  }
  return [...groups.values()].filter((group) => group.landCount || group.houseCount);
}

export function calculateCurrentGiftAmount(state) {
  const landCurrentValue = calculateTotalLandCurrentValue(state?.lands);
  const houseCurrentValue = calculateTotalHouseCurrentValue(state?.houses?.length ? state.houses : [state?.house]);
  const otherCurrentGiftAmount = nonNegativeMoney(state?.giftTax?.otherCurrentGiftAmount);
  return Math.round(landCurrentValue + houseCurrentValue + otherCurrentGiftAmount);
}

export function calculateGiftTaxDeductions(giftTax = {}) {
  const landValueTaxDeduction = nonNegativeMoney(giftTax.landValueTaxDeduction);
  const deedTaxDeduction = nonNegativeMoney(giftTax.deedTaxDeduction);
  const otherDeduction = nonNegativeMoney(giftTax.otherDeduction);
  return {
    landValueTaxDeduction,
    deedTaxDeduction,
    otherDeduction,
    totalDeduction: Math.round(landValueTaxDeduction + deedTaxDeduction + otherDeduction)
  };
}

export function calculateGiftTaxAmount(taxableGift, config = giftTaxConfig) {
  const taxable = Math.max(0, Math.round(finiteNumber(taxableGift)));
  const bracket = config.brackets.find((item) => taxable <= item.upTo) ?? config.brackets.at(-1);
  const amount = Math.round(bracket.baseTax + Math.max(0, taxable - bracket.excessOver) * bracket.rate);
  return { amount, bracket };
}

export function calculateGiftTax(state, config = giftTaxConfig) {
  const giftTax = state?.giftTax ?? {};
  const landCurrentValue = calculateTotalLandCurrentValue(state?.lands);
  const houseCurrentValue = calculateTotalHouseCurrentValue(state?.houses?.length ? state.houses : [state?.house]);
  const otherCurrentGiftAmount = nonNegativeMoney(giftTax.otherCurrentGiftAmount);
  const currentGiftAmount = calculateCurrentGiftAmount(state);
  const previousGiftAmount = nonNegativeMoney(giftTax.previousGiftAmount);
  const annualGiftAmount = Math.round(currentGiftAmount + previousGiftAmount);
  const excludedGiftAmount = nonNegativeMoney(giftTax.excludedGiftAmount);
  const deductions = calculateGiftTaxDeductions(giftTax);
  const exemption = nonNegativeMoney(config.exemption);
  const taxableGift = Math.max(0, Math.round(annualGiftAmount - excludedGiftAmount - exemption - deductions.totalDeduction));
  const { amount: calculatedAnnualTax, bracket } = calculateGiftTaxAmount(taxableGift, config);
  const previousPaidTaxCredit = nonNegativeMoney(giftTax.previousPaidTaxCredit);
  const finalGiftTax = Math.max(0, Math.round(calculatedAnnualTax - previousPaidTaxCredit));

  return {
    landCurrentValue,
    houseCurrentValue,
    otherCurrentGiftAmount,
    currentGiftAmount,
    previousGiftAmount,
    annualGiftAmount,
    excludedGiftAmount,
    exemption,
    ...deductions,
    taxableGift,
    bracketRate: bracket.rate,
    bracketLabel: bracket.label,
    bracketBaseTax: bracket.baseTax,
    bracketExcessOver: bracket.excessOver,
    calculatedAnnualTax,
    previousPaidTaxCredit,
    finalGiftTax,
    calculationSteps: [
      { label: "本次贈與總額", value: currentGiftAmount },
      { label: "本年度贈與總額", value: annualGiftAmount },
      { label: "扣除額合計", value: deductions.totalDeduction },
      { label: "課稅贈與淨額", value: taxableGift },
      { label: "全年應納贈與稅", value: calculatedAnnualTax },
      { label: "本次應納贈與稅", value: finalGiftTax }
    ]
  };
}
