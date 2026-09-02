import assert from "node:assert/strict";
import { renderA4Report } from "./a4-report-renderer.js";
import { createDefaultReportConfiguration } from "./report-settings.js";
import { hasEffectiveHouseData } from "./relationships.js";

const config = createDefaultReportConfiguration();
const baseState = {
  caseName: "測試", owners: [], lands: [], houses: [], house: {}, caseCurrentValue: 0,
  ...config, selectedClauses: [], customNotes: [], giftTax: { ...config.giftTax, enabled: false }
};

assert.equal(hasEffectiveHouseData([]), false);
assert.equal(hasEffectiveHouseData([{ address: "", assessedValue: 0 }]), false);
assert.equal(hasEffectiveHouseData([{ address: "臺北市測試路 1 號", assessedValue: 0 }]), true);
assert.equal(hasEffectiveHouseData([{ address: "", assessedValue: 1 }]), true);

const noHouseHtml = renderA4Report({ ...baseState, houses: [{ address: "", assessedValue: 0 }] }).html;
assert.doesNotMatch(noHouseHtml, />契稅</);
assert.match(noHouseHtml, /report-tax-count-2/);
const effectiveZeroTaxHtml = renderA4Report({ ...baseState, houses: [{ id: "house-1", address: "臺北市測試路 1 號", assessedValue: 0, shareNumerator: 1, shareDenominator: 1, ownerIds: [] }] }).html;
assert.match(effectiveZeroTaxHtml, />契稅</);
assert.match(effectiveZeroTaxHtml, />0</);

const owners = [{ id: "owner-a", name: "甲" }, { id: "owner-b", name: "乙" }];
const multiOwnerHtml = renderA4Report({
  ...baseState, owners, houses: [], lands: owners.map((owner, index) => ({
    id: `land-${index}`, district: "大安", section: "仁愛", subsection: "", landNumber: String(index + 1), area: 1,
    ownerId: owner.id, owner: owner.name, announcedValue: 1, shareNumerator: 1, shareDenominator: 1, currentValue: 1,
    previousTransfers: [{ date: "", previousValue: 0, priceIndex: 0, selfUseTax: 0, generalTax: index + 1 }]
  }))
}).html;
assert.match(multiOwnerHtml, /report-owner-tax-table/);
assert.doesNotMatch(multiOwnerHtml, />契稅</);
console.log("effective house summary tests passed");
