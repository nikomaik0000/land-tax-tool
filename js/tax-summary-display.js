import { formatMoney } from "./formatters.js?v=20260819-25";
import { hasEffectiveHouseData } from "./relationships.js";

export const NO_DATA_DISPLAY = "—";

export function getTaxSummaryDisplayValue({ enabled, hasRequiredData, value }) {
  if (!enabled) return null;
  if (!hasRequiredData) return NO_DATA_DISPLAY;
  return formatMoney(value);
}

export function hasEffectiveLandTaxData(state) {
  return (state?.lands ?? []).some((land) => (land?.previousTransfers ?? []).length > 0);
}

export function getVisibleTaxSummaryItems(state, totals, giftResult, calculateDeedTax) {
  if (!state?.displayOptions?.showTaxSummary) return [];
  const selected = state.displayOptions.taxSummaryItems ?? {};
  const hasLandTaxData = hasEffectiveLandTaxData(state);
  const hasHouseData = hasEffectiveHouseData(state);
  return [
    selected.selfUseTax
      ? { key: "selfUseTax", label: "自用增值稅", hasRequiredData: hasLandTaxData, value: totals.selfUseTax }
      : null,
    selected.generalTax
      ? { key: "generalTax", label: "一般增值稅", hasRequiredData: hasLandTaxData, value: totals.generalTax }
      : null,
    selected.deedTax
      ? { key: "deedTax", label: "契稅", hasRequiredData: hasHouseData, value: hasHouseData ? calculateDeedTax(state.houses) : null }
      : null,
    selected.giftTax
      ? { key: "giftTax", label: "贈與稅", hasRequiredData: Boolean(state.giftTax?.enabled && giftResult), value: giftResult?.finalGiftTax ?? null }
      : null
  ].filter(Boolean);
}
