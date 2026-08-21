const REQUIRED_FIELDS = Object.freeze([
  "area",
  "announcedValue",
  "shareNumerator",
  "shareDenominator",
  "previousValue",
  "priceIndex",
  "previousTransferDate",
  "calculationDate"
]);

const FIELD_LABELS = Object.freeze({
  area: "面積",
  announcedValue: "公告現值",
  shareNumerator: "持分分子",
  shareDenominator: "持分分母",
  previousValue: "前次移轉現值",
  priceIndex: "物價指數",
  previousTransferDate: "前次移轉日期",
  calculationDate: "試算日期"
});

function finite(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRocMonth(value) {
  const text = String(value ?? "").normalize("NFKC").replace(/^民國/, "").replace(/\s+/g, "");
  const match = text.match(/^(\d{2,3})(?:年|[.\/-])(\d{1,2})月?$/);
  if (!match) return null;
  const rocYear = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(rocYear) || rocYear < 1 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year: rocYear + 1911, month };
}

function parseCalculationDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

export function calculateHoldingYears(previousTransferDate, calculationDate) {
  const start = parseRocMonth(previousTransferDate);
  const end = parseCalculationDate(calculationDate);
  if (!start || !end) return null;
  // 謄本只有年月；依官方試算說明以原地價年月到試算年月計算，忽略日，避免月界造成級距漂移。
  const elapsedMonths = (end.year - start.year) * 12 + (end.month - start.month);
  return elapsedMonths < 0 ? null : elapsedMonths / 12;
}

export function getHoldingPeriodReduction(holdingYears) {
  const years = finite(holdingYears);
  if (years === null || years < 0) return null;
  if (years > 40) return { reductionRate: 0.40, secondLevelProgressiveFactor: 0.06, thirdLevelProgressiveFactor: 0.18 };
  if (years > 30) return { reductionRate: 0.30, secondLevelProgressiveFactor: 0.07, thirdLevelProgressiveFactor: 0.21 };
  if (years > 20) return { reductionRate: 0.20, secondLevelProgressiveFactor: 0.08, thirdLevelProgressiveFactor: 0.24 };
  return { reductionRate: 0, secondLevelProgressiveFactor: 0.10, thirdLevelProgressiveFactor: 0.30 };
}

export function getLandTaxBracket(priceIncreaseMultiple) {
  const multiple = finite(priceIncreaseMultiple);
  if (multiple === null || multiple < 0) return null;
  if (multiple < 1) return 1;
  if (multiple < 2) return 2;
  return 3;
}

export function calculateSelfUseLandValueIncrementTax(landIncreaseAmount) {
  const amount = finite(landIncreaseAmount);
  return amount === null ? null : Math.round(Math.max(0, amount) * 0.10);
}

export function validateLandValueIncrementTaxInput(data) {
  const missingFields = [];
  for (const field of REQUIRED_FIELDS) {
    if (field === "previousTransferDate") {
      if (!parseRocMonth(data?.[field])) missingFields.push(field);
    } else if (field === "calculationDate") {
      if (!parseCalculationDate(data?.[field])) missingFields.push(field);
    } else if (finite(data?.[field]) === null) missingFields.push(field);
  }
  if (finite(data?.shareDenominator) === 0 && !missingFields.includes("shareDenominator")) missingFields.push("shareDenominator");
  if (finite(data?.priceIndex) !== null && finite(data?.priceIndex) <= 0 && !missingFields.includes("priceIndex")) missingFields.push("priceIndex");
  return { valid: missingFields.length === 0, missingFields, missingLabels: missingFields.map((field) => FIELD_LABELS[field]) };
}

export function calculateLandValueIncrementTax(data) {
  const validation = validateLandValueIncrementTaxInput(data);
  if (!validation.valid) return { valid: false, ...validation };

  const area = finite(data.area);
  const announcedValue = finite(data.announcedValue);
  const numerator = finite(data.shareNumerator);
  const denominator = finite(data.shareDenominator);
  const previousValue = finite(data.previousValue);
  const priceIndex = finite(data.priceIndex);
  const share = numerator / denominator;
  const currentLandValue = area * announcedValue * share;
  const cpiMultiplier = priceIndex / 100;
  const adjustedPreviousValue = area * previousValue * cpiMultiplier * share;
  const deductibleCosts = Math.max(0, finite(data.deductibleCosts) ?? 0);
  const landIncreaseAmount = Math.max(0, currentLandValue - adjustedPreviousValue - deductibleCosts);
  const priceIncreaseMultiple = adjustedPreviousValue > 0 ? landIncreaseAmount / adjustedPreviousValue : Number.POSITIVE_INFINITY;
  const holdingYears = calculateHoldingYears(data.previousTransferDate, data.calculationDate);
  const holdingReduction = getHoldingPeriodReduction(holdingYears);
  const bracket = getLandTaxBracket(priceIncreaseMultiple);

  let taxRate = 0.20;
  let progressiveFactor = 0;
  if (bracket === 2) {
    taxRate = 0.30 - (0.30 - 0.20) * holdingReduction.reductionRate;
    progressiveFactor = holdingReduction.secondLevelProgressiveFactor;
  } else if (bracket === 3) {
    taxRate = 0.40 - (0.40 - 0.20) * holdingReduction.reductionRate;
    progressiveFactor = holdingReduction.thirdLevelProgressiveFactor;
  }

  const progressiveDeduction = adjustedPreviousValue * progressiveFactor;
  const assessedTax = Math.max(0, landIncreaseAmount * taxRate - progressiveDeduction);
  const assessedTaxReductionRate = Math.min(1, Math.max(0, finite(data.assessedTaxReductionRate) ?? 0));
  const creditableLandTax = Math.max(0, finite(data.creditableLandTax) ?? 0);
  const generalTax = Math.max(0, Math.round(assessedTax - assessedTax * assessedTaxReductionRate - creditableLandTax));
  const selfUseTax = calculateSelfUseLandValueIncrementTax(landIncreaseAmount);

  return {
    valid: true,
    missingFields: [],
    missingLabels: [],
    currentLandValue,
    adjustedPreviousValue,
    landIncreaseAmount,
    priceIncreaseMultiple,
    cpiMultiplier,
    holdingYears,
    reductionRate: holdingReduction.reductionRate,
    bracket,
    taxRate,
    progressiveDeduction,
    assessedTax,
    assessedTaxReductionRate,
    creditableLandTax,
    generalTax,
    selfUseTax
  };
}
