import test from "node:test";
import assert from "node:assert/strict";
import { renderA4Report } from "./a4-report-renderer.js";
import { createDefaultReportConfiguration } from "./report-settings.js";

const config = createDefaultReportConfiguration();
const land = { id: "land-1", district: "大安", section: "學府", subsection: "三", landNumber: "436", area: 1, owner: "甲", ownerId: null, announcedValue: 1, shareNumerator: 1, shareDenominator: 1, currentValue: 1, zoning: "道路用地、第三種住宅區", previousTransfers: [{ date: "", previousValue: 0, priceIndex: 0, selfUseTax: 0, generalTax: 0 }, { date: "", previousValue: 0, priceIndex: 0, selfUseTax: 0, generalTax: 0 }] };
const base = { caseName: "測試", owners: [], houses: [], house: {}, lands: [land], caseCurrentValue: 1, ...config, selectedClauses: [], customNotes: [], giftTax: { ...config.giftTax, enabled: false } };

test("A4 stays unchanged when zoning display is disabled", () => { assert.doesNotMatch(renderA4Report(base).html, /report-zoning-row|使用分區：/); });
test("A4 renders one zoning supplement after all transfer rows", () => { const html = renderA4Report({ ...base, displayOptions: { ...base.displayOptions, showLandZoning: true } }).html; assert.equal((html.match(/report-zoning-row/g) ?? []).length, 1); assert.match(html, /使用分區：道路用地、第三種住宅區/); });
