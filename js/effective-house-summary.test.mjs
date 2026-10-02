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
assert.equal(hasEffectiveHouseData([{ address: "臺北市測試路 1 號", assessedValue: null, shareNumerator: 1, shareDenominator: 1 }]), false);
assert.equal(hasEffectiveHouseData([{ address: "臺北市測試路 1 號", assessedValue: 0, shareNumerator: 1, shareDenominator: 1 }]), true);
assert.equal(hasEffectiveHouseData([{ address: "", assessedValue: 1, shareNumerator: 1, shareDenominator: 1 }]), true);

const noHouseHtml = renderA4Report({ ...baseState, houses: [{ address: "", assessedValue: null }] }).html;
assert.doesNotMatch(noHouseHtml, />契稅</);
assert.match(noHouseHtml, /report-tax-count-2/);
const deedEnabled = { ...baseState, displayOptions: { ...baseState.displayOptions, taxSummaryItems: { ...baseState.displayOptions.taxSummaryItems, deedTax: true } } };
const missingValueHtml = renderA4Report({ ...deedEnabled, houses: [{ id: "house-1", address: "臺北市測試路 1 號", assessedValue: null, shareNumerator: 1, shareDenominator: 1, ownerIds: [] }] }).html;
assert.match(missingValueHtml, />契稅</);
assert.match(missingValueHtml, /<strong>—<\/strong>/);
const effectiveZeroTaxHtml = renderA4Report({ ...deedEnabled, houses: [{ id: "house-1", address: "臺北市測試路 1 號", assessedValue: 0, shareNumerator: 1, shareDenominator: 1, ownerIds: [] }] }).html;
assert.match(effectiveZeroTaxHtml, />契稅</);
assert.match(effectiveZeroTaxHtml, />0</);
assert.match(effectiveZeroTaxHtml, /report-tax-count-3/);

const positiveDeedTaxHtml = renderA4Report({ ...deedEnabled, houses: [{ id: "house-2", address: "臺北市測試路 2 號", assessedValue: 100000, shareNumerator: 1, shareDenominator: 1, ownerIds: [] }] }).html;
assert.match(positiveDeedTaxHtml, /<span>契稅<\/span><strong>6,000<\/strong>/);

const onlyTwoItemsHtml = renderA4Report({
  ...baseState,
  displayOptions: { ...baseState.displayOptions, taxSummaryItems: { selfUseTax: true, generalTax: true, deedTax: false, giftTax: false } }
}).html;
assert.match(onlyTwoItemsHtml, /report-tax-count-2/);
assert.doesNotMatch(onlyTwoItemsHtml, />契稅</);
assert.doesNotMatch(onlyTwoItemsHtml, />贈與稅</);

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

const hiddenSummaryHtml = renderA4Report({ ...baseState, displayOptions: { ...baseState.displayOptions, showTaxSummary: false } }).html;
assert.doesNotMatch(hiddenSummaryHtml, /稅額摘要/);

const savedCheckboxes = JSON.parse(JSON.stringify(deedEnabled)).displayOptions;
assert.equal(savedCheckboxes.showTaxSummary, true);
assert.deepEqual(savedCheckboxes.taxSummaryItems, { selfUseTax: true, generalTax: true, deedTax: true, giftTax: false });
console.log("effective house summary tests passed");
