import { normalizeAuthorizationDocumentState } from "./case-document-authorizations.js";
import { normalizeCaseDocumentState } from "./case-documents-model.js";
import { normalizeRealPriceFilingDraft } from "./real-price-filing.js";

export const CASE_DOCUMENTS_DATA_VERSION = 1;

export function buildCaseDocumentsData(caseState, authorizationDocuments, realPriceFiling) {
  return {
    schemaVersion: CASE_DOCUMENTS_DATA_VERSION,
    caseState: structuredClone(caseState),
    authorizationDocuments: structuredClone(authorizationDocuments),
    realPriceFiling: structuredClone(realPriceFiling),
  };
}

export function normalizeCaseDocumentsData(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.schemaVersion && source.schemaVersion !== CASE_DOCUMENTS_DATA_VERSION) {
    throw new Error(`不支援此案件文件資料版本（${String(source.schemaVersion)}）。`);
  }
  const caseState = source.caseState || source;
  return {
    schemaVersion: CASE_DOCUMENTS_DATA_VERSION,
    caseState: normalizeCaseDocumentState(caseState),
    authorizationDocuments: normalizeAuthorizationDocumentState(source.authorizationDocuments),
    realPriceFiling: normalizeRealPriceFilingDraft(source.realPriceFiling),
  };
}
