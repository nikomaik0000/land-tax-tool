import { formatLandNumber } from "./formatters.js";

const CJK_DIGITS = Object.freeze({ 零: "0", 〇: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" });

export function normalizeCity(value) {
  const text = String(value ?? "").trim().replaceAll("台", "臺");
  if (!text) return "";
  if (/^(?:臺北|臺北市)$/.test(text)) return "臺北市";
  if (/^(?:新北|新北市)$/.test(text)) return "新北市";
  return text.endsWith("市") || text.endsWith("縣") ? text : `${text}市`;
}

export function normalizeDistrict(value) {
  return String(value ?? "").trim().replace(/^[臺台]北市|^新北市/, "").replace(/[區鄉鎮市]$/, "");
}

function normalizeSubsection(value) {
  const text = String(value ?? "").trim().replace(/小段$/, "");
  return CJK_DIGITS[text] ?? text;
}

export function splitSectionAndSubsection(sectionValue, subsectionValue = "") {
  let section = String(sectionValue ?? "").trim();
  let subsection = String(subsectionValue ?? "").trim();
  const combined = section.match(/^(.*?段)([^段]+小段)$/);
  if (combined) {
    section = combined[1];
    if (!subsection) subsection = combined[2];
  }
  return {
    section: section.replace(/段$/, "").trim(),
    subsection: normalizeSubsection(subsection)
  };
}

export function normalizeLandNumber(value) {
  return formatLandNumber(String(value ?? "").trim());
}

export function buildLandValueKey(input) {
  const { section, subsection } = splitSectionAndSubsection(input.section, input.subsection);
  return [
    normalizeCity(input.city),
    normalizeDistrict(input.district),
    section,
    subsection,
    normalizeLandNumber(input.landNumber)
  ].join("|");
}

export function buildLandValueDiagnosticKey(input) {
  const { section, subsection } = splitSectionAndSubsection(input.section, input.subsection);
  return [normalizeCity(input.city), section, subsection, normalizeLandNumber(input.landNumber)].join("|");
}

export function normalizeLandValueRecord(input) {
  const { section, subsection } = splitSectionAndSubsection(input.section, input.subsection);
  const numericValue = (value) => Number(String(value ?? "").replaceAll(",", "").trim());
  return {
    city: normalizeCity(input.city),
    district: normalizeDistrict(input.district),
    section,
    subsection,
    landNumber: normalizeLandNumber(input.landNumber),
    area: input.area === null || input.area === undefined || input.area === "" ? null : numericValue(input.area),
    officialValue: numericValue(input.officialValue),
    officialPrice: numericValue(input.officialPrice)
  };
}

export function compareLandValueRecord(record, index) {
  const match = index.get(buildLandValueKey(record));
  if (!match) return { latestAnnouncedValue: null, lookupStatus: "not-found" };
  const latestAnnouncedValue = Number(match.officialValue);
  return {
    latestAnnouncedValue,
    lookupStatus: Number(record.originalAnnouncedValue) === latestAnnouncedValue ? "same" : "changed"
  };
}
