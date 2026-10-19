import {
  addBuildingFromParsed,
  addLandFromParsed,
  formatPartyInterests,
  formatRocDate,
  reconcileCaseDistrict,
  reconcileImportedPartyRoles,
  reconcilePartyShareVisibility,
  refreshCaseMetadataFromImportedFiles,
} from "./case-documents-model.js";
import { parseWangBuildingExport, parseWangKeyValueText, parseWangLandExport } from "./wang-case-parser.js";

export async function prepareImportedFile(name, bytes) {
  const fingerprint = await fingerprintFileContent(bytes);
  const { fields } = parseWangKeyValueText(bytes);
  if (fields.LND_MARK || (fields.LOC_NM && Object.hasOwn(fields, "TRAN_AREA"))) {
    const parsed = parseWangLandExport(bytes);
    return makeCandidate(name, fingerprint, "land", parsed, { lands: 1, buildings: 0, commonParts: 0 });
  }
  if (fields.HOU_CNSTRT_NO || fields.MAIN_BUILD_NO) {
    const parsed = parseWangBuildingExport(bytes);
    return makeCandidate(name, fingerprint, "building", parsed, { lands: 0, buildings: 1, commonParts: parsed.commonParts.length });
  }
  throw new Error("無法辨識檔案類型");
}

export function inspectImportConflict(importedFiles, candidate) {
  const duplicate = importedFiles.find((file) => file.fingerprint === candidate.fingerprint);
  if (duplicate) return { type: "duplicate-content", file: duplicate };
  const sameName = importedFiles.find((file) => file.name === candidate.name);
  if (sameName) return { type: "same-name-update", file: sameName };
  return { type: "none", file: null };
}

export function addImportedFile(state, candidate, { replaceFileId = "" } = {}) {
  const duplicate = state.importedFiles.find((file) => file.fingerprint === candidate.fingerprint);
  if (duplicate) return duplicate;
  const sameName = state.importedFiles.find((file) => file.name === candidate.name);
  if (sameName && !replaceFileId) throw new Error("同名檔案內容不同，必須先確認是否替換");
  if (replaceFileId) removeImportedFile(state, replaceFileId);
  state.importedFiles.push(candidate);
  if (candidate.type === "land") addLandFromParsed(state, candidate.parsed, { sourceFileId: candidate.id });
  if (candidate.type === "building") addBuildingFromParsed(state, candidate.parsed, { sourceFileId: candidate.id });
  return candidate;
}

export function removeImportedFile(state, fileId) {
  const target = state.importedFiles.find((file) => file.id === fileId);
  if (!target) return null;
  state.importedFiles = state.importedFiles.filter((file) => file.id !== fileId);
  state.lands = state.lands.filter((item) => item.sourceFileId !== fileId);
  state.buildings = state.buildings.filter((item) => item.sourceFileId !== fileId);
  state.commonParts = state.commonParts.filter((item) => item.sourceFileId !== fileId);
  state.caseInfo.districtSources = state.caseInfo.districtSources.filter((item) => item.sourceFileId !== fileId);
  state.parties = state.parties.filter((party) => {
    if (!party.imported) return true;
    party.originalSources = (party.originalSources || []).filter((source) => source.sourceFileId !== fileId);
    if (!party.originalSources.length) return false;
    refreshPartyFromRemainingSources(party);
    return true;
  });
  reconcileCaseDistrict(state);
  refreshCaseMetadataFromImportedFiles(state);
  reconcileImportedPartyRoles(state);
  reconcilePartyShareVisibility(state);
  return target;
}

export function hasManualSourceEdits(state, fileId) {
  return [state.lands, state.buildings, state.commonParts, state.parties].some((items) => items.some((item) => (
    (item.sourceFileId === fileId || item.originalSources?.some((source) => source.sourceFileId === fileId))
    && item.manualFields?.length
  )));
}

export function importedFileSummary(file) {
  const parts = [];
  if (file.counts.lands) parts.push(`土地 ${file.counts.lands} 筆`);
  if (file.counts.buildings) parts.push(`建物 ${file.counts.buildings} 筆`);
  if (file.type === "building") parts.push(`共有部分 ${file.counts.commonParts} 筆`);
  return parts.join("、");
}

export async function fingerprintFileContent(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function makeCandidate(name, fingerprint, type, parsed, counts) {
  return {
    id: `csv-${fingerprint.slice(0, 16)}`,
    name,
    fingerprint,
    type,
    parsed,
    counts,
    warningCount: parsed.warnings.length,
  };
}

function refreshPartyFromRemainingSources(party) {
  const sources = party.originalSources;
  const manual = new Set(party.manualFields || []);
  party.original = sources[0] || null;
  party.interests = uniqueInterests(sources.map(sourceToInterest).filter(Boolean));
  if (!party.shareManual && !manual.has("share")) party.share = formatPartyInterests(party.interests);
  if (!manual.has("name")) party.name = firstValue(sources, "name");
  if (!manual.has("birthDate")) party.birthDate = formatRocDate(firstValue(sources, "birthDate"));
  if (!manual.has("idNumber")) party.idNumber = firstValue(sources, "idNumber");
  if (!manual.has("address")) party.address = sources.map((source) => source.contactAddress).find(Boolean)
    || sources.map((source) => source.homeAddress).find(Boolean) || "";
  if (!manual.has("phoneNote")) party.phoneNote = firstValue(sources, "phone");
}

function sourceToInterest(source) {
  if (!source.shareNumerator || !source.shareDenominator) return null;
  return {
    kind: source.targetKind,
    targetNumber: source.targetNumber,
    targetNumberRaw: source.targetNumberRaw,
    numerator: source.shareNumerator,
    denominator: source.shareDenominator,
    sourceType: source.sourceType,
    sourceRole: source.sourceRole,
    sourceFileId: source.sourceFileId,
  };
}

function uniqueInterests(items) {
  return [...new Map(items.map((item) => [[item.kind, item.targetNumberRaw || item.targetNumber, item.numerator, item.denominator, item.sourceRole].join("|"), item])).values()];
}

function firstValue(items, key) {
  return items.map((item) => item[key]).find(Boolean) || "";
}
