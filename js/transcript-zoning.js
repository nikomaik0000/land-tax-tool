import { normalizeCity, normalizeDistrict, normalizeLandNumber, splitSectionAndSubsection } from "./land-value-normalization.js";

export function normalizeTranscriptZoningRecord(land, taipeiDistrictNames = []) {
  const district = normalizeDistrict(land?.district);
  const parts = splitSectionAndSubsection(land?.section, land?.subsection);
  const knownTaipeiDistrict = taipeiDistrictNames.some((name) => normalizeDistrict(name) === district);
  return {
    ...land,
    city: normalizeCity(land?.city) || (knownTaipeiDistrict ? "臺北市" : ""),
    district,
    section: parts.section,
    subsection: parts.subsection,
    landNumber: normalizeLandNumber(land?.landNumber),
    matches: []
  };
}
