import { sanitizeFilename } from "./case-file.js";

export function removeNameWhitespace(value) {
  return String(value ?? "").replace(/[\p{White_Space}\u200B\uFEFF]+/gu, "");
}

export function caseCardPdfFilename(parties = []) {
  return partyPairFilename("案件資料卡", {
    obligors: namesByRole(parties, "義務人"),
    rights: namesByRole(parties, "權利人"),
  }, "pdf");
}

export function houseTaxPdfFilename(preview = {}) {
  return filename("房屋稅籍申請書", uniqueNames([preview.principal?.name]), "pdf");
}

export function realPricePdfFilename(preview = {}) {
  const entrustors = Array.isArray(preview.entrustors) ? preview.entrustors : [];
  return partyPairFilename("實價登錄委托書", {
    obligors: namesByRole(entrustors, "義務人"),
    rights: namesByRole(entrustors, "權利人"),
  }, "pdf");
}

export function realPriceZipFilename(draft = {}) {
  return partyPairFilename("實價登錄", {
    obligors: uniqueNames((draft.sellers || []).map((party) => party?.name)),
    rights: uniqueNames((draft.buyers || []).map((party) => party?.name)),
  }, "zip");
}

export function caseDataJsonFilename(parties = [], date = new Date()) {
  const rights = namesByRole(parties, "權利人").join("、");
  const obligors = namesByRole(parties, "義務人").join("、");
  const partyLabel = [rights, obligors].filter(Boolean).join("X");
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${sanitizeFilename([partyLabel, "案件資料", day].filter(Boolean).join("_"))}.json`;
}

function namesByRole(parties, role) {
  return uniqueNames((Array.isArray(parties) ? parties : [])
    .filter((party) => party?.title === role)
    .map((party) => party?.name));
}

function uniqueNames(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(removeNameWhitespace)
    .filter(Boolean))];
}

function partyPairFilename(prefix, { obligors = [], rights = [] }, extension) {
  const partyLabel = [obligors.join("、"), rights.join("、")].filter(Boolean).join("X");
  return filename(prefix, partyLabel ? [partyLabel] : [], extension);
}

function filename(prefix, names, extension) {
  const suffix = uniqueNames(names).join("、");
  return `${sanitizeFilename(suffix ? `${prefix}_${suffix}` : prefix)}.${extension}`;
}
