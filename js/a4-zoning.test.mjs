import test from "node:test";
import assert from "node:assert/strict";
import { renderA4Report } from "./a4-report-renderer.js";
import { createDefaultReportConfiguration } from "./report-settings.js";
import { formatZoningForPrint, getShortZoningLabel } from "./zoning-print.js";

const config = createDefaultReportConfiguration();
const land = { id: "land-1", district: "大安", section: "學府", subsection: "三", landNumber: "436", area: 1, owner: "甲", ownerId: null, announcedValue: 1, shareNumerator: 1, shareDenominator: 1, currentValue: 1, zoning: "道路用地、第三種住宅區", previousTransfers: [{ date: "", previousValue: 0, priceIndex: 0, selfUseTax: 0, generalTax: 0 }, { date: "", previousValue: 0, priceIndex: 0, selfUseTax: 0, generalTax: 0 }] };
const base = { caseName: "測試", owners: [], houses: [], house: {}, lands: [land], caseCurrentValue: 1, ...config, selectedClauses: [], customNotes: [], giftTax: { ...config.giftTax, enabled: false } };

test("A4 stays unchanged when zoning display is disabled", () => { assert.doesNotMatch(renderA4Report(base).html, /report-zoning-row|使用分區：/); });
test("A4 renders one zoning supplement after all transfer rows", () => { const html = renderA4Report({ ...base, displayOptions: { ...base.displayOptions, showLandZoning: true } }).html; assert.equal((html.match(/report-zoning-row/g) ?? []).length, 1); assert.match(html, /使用分區：道路用地、第三種住宅區/); });

test("short zoning removes explanatory text but preserves formal qualifiers", () => {
  assert.equal(getShortZoningLabel("第參種商業區(依都市計畫說明書圖規定辦理,始得作第參種商業區使用)(原屬第貳種商業區)"), "第參種商業區");
  assert.equal(getShortZoningLabel("第三種住宅區（特）（依都市計畫說明書圖規定辦理）"), "第三種住宅區（特）");
  assert.equal(getShortZoningLabel("敦化南北路特定專用區(A區)(依都市計畫說明書圖規定辦理)"), "敦化南北路特定專用區(A區)");
  assert.equal(getShortZoningLabel("道路用地（公共設施用地）"), "道路用地");
  assert.equal(formatZoningForPrint(["道路用地(公共設施用地)", "道路用地（其他說明）"], "short"), "道路用地");
});

test("column layout adds zoning as the last column after general tax without supplement row", () => {
  const html = renderA4Report({ ...base, displayOptions: { ...base.displayOptions, showLandZoning: true, zoningPrintLayout: "column", zoningTextMode: "short" } }).html;
  assert.match(html, /<th>一般<br>增值稅<\/th><th>使用分區<\/th>/);
  assert.equal((html.match(/report-zoning-column/g) ?? []).length, 1);
  assert.doesNotMatch(html, /report-zoning-row/);
  assert.match(html, /rowspan="2">道路用地、第三種住宅區<\/td>/);
});

test("print-only land visibility removes each selected A4 column and keeps dynamic spans valid", () => {
  const html = renderA4Report({
    ...base,
    houses: [{ id: "house-1", address: "測試路", shareNumerator: 1, shareDenominator: 1, currentValue: 2 }],
    lands: [{ ...land, houseId: "house-1" }],
    displayOptions: { ...base.displayOptions, showLandZoning: true, printLandColumns: { district: false, section: false, subsection: false, owner: false } }
  }).html;
  assert.doesNotMatch(html, /<th>區<\/th>|<th>段<\/th>|<th>小段<\/th>|所有<br>權人/);
  assert.match(html, /report-house-address[^>]*>房屋座落/);
  assert.match(html, /report-zoning-row"><td colspan="10"/);
  assert.match(html, /report-total-row/);
});

test("default print settings preserve all legacy A4 land columns", () => {
  assert.deepEqual(config.displayOptions.printLandColumns, { district: true, section: true, subsection: true, owner: true });
  assert.equal(config.displayOptions.zoningPrintLayout, "row");
  assert.equal(config.displayOptions.zoningTextMode, "full");
  const html = renderA4Report(base).html;
  for (const heading of ["區", "段", "小段", "所有<br>權人"]) assert.match(html, new RegExp(`<th>${heading}</th>`));
});
