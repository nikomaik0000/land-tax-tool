import { createDefaultReportConfiguration } from "./report-settings.js";
import { loadSessionState } from "./session-state.js";
import { migrateRelationshipState } from "./relationships.js";

const reportConfiguration = createDefaultReportConfiguration();
export const LAND_TAX_STORAGE_KEY = "landTool.landTaxState";
const restored = loadSessionState(LAND_TAX_STORAGE_KEY) ?? {};
const defaultHouse = { address: "", assessedValue: 0, shareNumerator: 1, shareDenominator: 1, currentValue: 0, deedTax: 0 };

export const state = {
  caseName: "土地增值稅試算",
  owner: "",
  owners: [], houses: [], house: { address: "", assessedValue: 0, shareNumerator: 1, shareDenominator: 1, currentValue: 0, deedTax: 0 },
  files: [],
  documentOrderMode: "auto",
  lands: [],
  totalLandCurrentValue: 0,
  caseCurrentValue: 0,
  ...reportConfiguration
};

Object.assign(state, restored, {
  files: [],
  house: { ...defaultHouse, ...(restored.house ?? {}) },
  displayOptions: {
    ...reportConfiguration.displayOptions,
    ...(restored.displayOptions ?? {}),
    taxSummaryItems: { ...reportConfiguration.displayOptions.taxSummaryItems, ...(restored.displayOptions?.taxSummaryItems ?? {}) },
    printLandColumns: { ...reportConfiguration.displayOptions.printLandColumns, ...(restored.displayOptions?.printLandColumns ?? {}) }
  },
  giftTax: { ...reportConfiguration.giftTax, ...(restored.giftTax ?? {}) },
  selectedClauses: restored.selectedClauses ?? reportConfiguration.selectedClauses
});
state.documentOrderMode = restored.documentOrderMode === "manual" ? "manual" : "auto";
migrateRelationshipState(state);

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyTransfer() {
  return { date: "", previousValue: 0, priceIndex: 0, selfUseTax: 0, generalTax: 0 };
}

export function createEmptyLand(overrides = {}) {
  return {
    id: createId(), sourceFileId: null, city: "臺北市", district: "", section: "", subsection: "",
    landNumber: "", rawLandNumber: "", area: 0, owner: state.owner, ownerId: state.owners[0]?.id ?? null, houseId: null, announcedValue: 0,
    shareNumerator: 1, shareDenominator: 1, previousTransfers: [],
    currentValue: 0, zoning: "", zonings: [], zoningStatus: "", zoningManual: false, ...overrides
  };
}

state.lands = (state.lands ?? []).map((land) => ({
  ...land,
  zoning: String(land.zoning ?? ""),
  zonings: Array.isArray(land.zonings) ? land.zonings : (land.zoning ? [String(land.zoning)] : []),
  zoningStatus: String(land.zoningStatus ?? ""),
  zoningManual: Boolean(land.zoningManual)
}));
