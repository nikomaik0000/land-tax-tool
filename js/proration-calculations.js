const DAY_MS = 86400000;
const hasValue = (value) => value !== "" && value !== null && value !== undefined;
function parseDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "")); if (!match) return null; const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])); return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3] ? date : null; }
const inclusiveDays = (from, to) => Math.floor((to - from) / DAY_MS) + 1;
function requiredNumber(input, field, label, { positive = false } = {}, errors) { if (!hasValue(input[field])) { errors[field] = `請填寫${label}。`; return null; } const value = Number(input[field]); if (!Number.isFinite(value)) { errors[field] = `${label}格式不正確。`; return null; } if (positive ? value <= 0 : value < 0) { errors[field] = positive ? `${label}必須大於 0。` : `${label}不可為負數。`; return null; } return value; }
function invalid(input, fieldErrors, extra = {}) { const errors = [...new Set(Object.values(fieldErrors))]; return { valid: false, errors, error: errors[0] ?? "資料不完整。", fieldErrors, amount: 0, totalDays: 0, prorationStartDate: input.prorationStartDate || "", prorationEndDate: input.prorationEndDate || "", prorationDays: 0, prorationAmount: 0, payer: input.payer === "buyer" ? "buyer" : "seller", settlement: 0, ...extra }; }

export function calculateProration(input = {}) {
  const fieldErrors = {}; const amount = requiredNumber(input, "amount", "稅額", {}, fieldErrors); const totalTaxDays = requiredNumber(input, "totalTaxDays", "總課稅天數", { positive: true }, fieldErrors);
  const start = parseDate(input.prorationStartDate); const end = parseDate(input.prorationEndDate);
  if (!start) fieldErrors.prorationStartDate = "請填寫本次找補開始日。"; if (!end) fieldErrors.prorationEndDate = "請填寫本次找補結束日。";
  if (start && end && start > end) fieldErrors.prorationEndDate = "本次找補開始日不可晚於結束日。";
  const prorationDays = start && end && start <= end ? inclusiveDays(start, end) : 0;
  if (totalTaxDays !== null && prorationDays > totalTaxDays) fieldErrors.prorationEndDate = "本次找補天數不可大於總課稅天數。";
  if (Object.keys(fieldErrors).length) return invalid(input, fieldErrors);
  const roundedAmount = Math.round(amount); const prorationAmount = Math.round(roundedAmount * prorationDays / totalTaxDays); const payer = input.payer === "buyer" ? "buyer" : "seller";
  return { valid: true, errors: [], error: "", fieldErrors: {}, amount: roundedAmount, totalTaxDays, totalDays: totalTaxDays, prorationStartDate: input.prorationStartDate, prorationEndDate: input.prorationEndDate, prorationDays, prorationAmount, payer, settlement: payer === "seller" ? prorationAmount : -prorationAmount };
}
function addCalendarMonths(date, months) { const year = date.getUTCFullYear(); const month = date.getUTCMonth() + months; const day = date.getUTCDate(); const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); return new Date(Date.UTC(year, month, Math.min(day, lastDay))); }
const isoDate = (date) => date.toISOString().slice(0, 10);
export function calculateHouseTax(input = {}) {
  const fieldErrors = {}; const taxableMonths = requiredNumber(input, "taxableMonths", "課稅月數", { positive: true }, fieldErrors); const taxStart = parseDate(input.taxStartDate);
  if (!taxStart) fieldErrors.taxStartDate = "請填寫完整課稅開始日。";
  if (taxableMonths !== null && !Number.isInteger(taxableMonths)) fieldErrors.taxableMonths = "課稅月數必須為整數。";
  if (Object.keys(fieldErrors).length) return invalid(input, fieldErrors, { taxableMonths, taxStartDate: input.taxStartDate || "", taxEndDate: "" });
  const taxEnd = new Date(addCalendarMonths(taxStart, taxableMonths).getTime() - DAY_MS); const totalTaxDays = inclusiveDays(taxStart, taxEnd);
  const result = calculateProration({ ...input, totalTaxDays });
  return { ...result, taxableMonths, taxStartDate: input.taxStartDate, taxEndDate: isoDate(taxEnd), totalTaxDays, totalDays: totalTaxDays };
}
export function calculateLandTax(input = {}) {
  const taxYear = Number(input.taxYear); const validYear = Number.isInteger(taxYear) && taxYear >= 1912; const totalTaxDays = validYear && new Date(Date.UTC(taxYear, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  if (!hasValue(input.declaredLandValue) && hasValue(input.legacyAmount)) return { ...calculateProration({ ...input, totalTaxDays, amount: input.legacyAmount }), taxableLandValue: null, taxAmount: Math.round(Number(input.legacyAmount)), taxYear, totalTaxDays, totalDays: totalTaxDays, amountSource: "legacy" };
  const fieldErrors = {}; const value = requiredNumber(input, "declaredLandValue", "申報地價", {}, fieldErrors); const area = requiredNumber(input, "area", "土地面積", {}, fieldErrors); const numerator = requiredNumber(input, "shareNumerator", "土地持分分子", {}, fieldErrors); const denominator = requiredNumber(input, "shareDenominator", "土地持分分母", { positive: true }, fieldErrors); const rate = requiredNumber(input, "rate", "地價稅率", {}, fieldErrors);
  if (!validYear) fieldErrors.taxYear = "請填寫有效課稅年度。";
  if (numerator !== null && denominator !== null && numerator > denominator) fieldErrors.shareNumerator = "土地持分分子不可大於分母。";
  const taxableLandValue = Object.keys(fieldErrors).length ? null : Math.round(value * area * numerator / denominator); const taxAmount = taxableLandValue === null ? null : Math.round(taxableLandValue * rate / 100);
  if (Object.keys(fieldErrors).length) return invalid(input, fieldErrors, { taxableLandValue, taxAmount });
  return { ...calculateProration({ ...input, totalTaxDays, amount: taxAmount }), taxableLandValue, taxAmount, taxYear, totalTaxDays, totalDays: totalTaxDays, amountSource: "calculated" };
}
export const calculateCombinedSettlement = (house, land) => (house?.valid ? house.settlement : 0) + (land?.valid ? land.settlement : 0);
export function settlementText(value, buyer = "買方", seller = "賣方") { const amount = Math.abs(Math.round(Number(value) || 0)).toLocaleString("zh-TW"); if (value > 0) return `${buyer || "買方"}應補${seller || "賣方"} $${amount}`; if (value < 0) return `${seller || "賣方"}應補${buyer || "買方"} $${amount}`; return "雙方無須找補"; }
