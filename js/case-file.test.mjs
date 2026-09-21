import assert from "node:assert/strict";
import { buildCaseFile, caseFilename, migrateSavedCase, parseCaseFile, sanitizeFilename, validateCaseFile } from "./case-file.js";

const samples = {
  "land-tax": { lands: [{ id: "l1", previousTransfers: [{ priceIndex: 123, generalTax: 9 }] }], owners: [{ id: "o1" }], displayOptions: { orientation: "landscape" }, documentOrderMode: "manual" },
  transcript: { lands: [{ zonings: ["住宅區"], previousTransfers: [{ priceIndex: 111, calculatedGeneralTax: 8 }] }], tryLandTax: true, displayOptions: { showLandZoning: true } },
  "land-value-update": { workbookRows: [["區", "地號"]], records: [{ status: "not-found" }], showOriginalValue: false },
  "land-number-converter": { direction: "old-to-new", records: [{ status: "multiple", matches: [{ landNumber: "1" }, { landNumber: "2" }] }] },
  zoning: { records: [{ status: "multiple", matches: [{ zoning: "住宅區" }, { zoning: "商業區" }] }], orientation: "landscape" }
};
for (const [pageType, data] of Object.entries(samples)) {
  const restored = parseCaseFile(JSON.stringify(buildCaseFile(pageType, data)), pageType).data;
  assert.deepEqual(restored, data, `${pageType} round trip`);
}
assert.throws(() => validateCaseFile(buildCaseFile("land-tax", {}), "zoning"), /無法在使用分區查詢頁導入/);
assert.throws(() => parseCaseFile("{bad", "land-tax"), /格式錯誤/);
assert.throws(() => migrateSavedCase({ app: "land-tax-tool", version: 0, pageType: "land-tax", data: {} }), /不支援此案件檔版本/);
assert.equal(sanitizeFilename('a/b:*?"<>|'), "a_b_______");
assert.match(caseFilename("土地", "案件", new Date(2026, 8, 21)), /^土地_案件_2026-09-21\.json$/);
console.log("case-file regression: 8 cases passed");
