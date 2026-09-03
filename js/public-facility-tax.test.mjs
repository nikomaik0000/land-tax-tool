import assert from "node:assert/strict";
import test from "node:test";
import { calculateTaxSummaryByOwner, calculateTransferTaxTotals } from "./calculations.js";
import { renderA4Report } from "./a4-report-renderer.js";
import { mainTransferValues } from "./excel-export.js";
import { getFinalTransferTaxes, isPublicFacilityLand } from "./land-zoning.js";
import { createDefaultReportConfiguration } from "./report-settings.js";

const transfers = [
  { date: "81年9月", selfUseTax: 100, generalTax: 300, calculatedSelfUseTax: 110, calculatedGeneralTax: 310 },
  { date: "113年12月", selfUseTax: 200, generalTax: 600, calculatedSelfUseTax: 210, calculatedGeneralTax: 610 }
];
const land = (zoning = "") => ({
  id: "land", district: "", section: "", subsection: "", landNumber: "436", area: 1, announcedValue: 1,
  ownerId: "owner", zoning, zonings: zoning ? [zoning] : [], previousTransfers: transfers
});

test("full zoning text detects public facility land in either zoning source", () => {
  assert.equal(isPublicFacilityLand(land("道路用地(公共設施用地)")), true);
  assert.equal(isPublicFacilityLand(land("公園用地（公共設施用地）")), true);
  assert.equal(isPublicFacilityLand({ zoning: "第三種住宅區", zonings: ["第三種住宅區", "道路用地(公共設施用地)"] }), true);
  assert.equal(isPublicFacilityLand(land("第三種住宅區")), false);
  assert.equal(isPublicFacilityLand(land("")), false);
});

test("all transfers use zero final tax without overwriting calculated tax and restore dynamically", () => {
  const target = land("公共設施用地");
  for (const transfer of target.previousTransfers) {
    assert.deepEqual(getFinalTransferTaxes(target, transfer), {
      calculatedSelfUseTax: transfer.calculatedSelfUseTax,
      calculatedGeneralTax: transfer.calculatedGeneralTax,
      finalSelfUseTax: 0,
      finalGeneralTax: 0
    });
  }
  assert.equal(target.previousTransfers[0].calculatedGeneralTax, 310);
  target.zoning = "第三種住宅區"; target.zonings = [target.zoning];
  assert.deepEqual(getFinalTransferTaxes(target, target.previousTransfers[0]), {
    calculatedSelfUseTax: 110, calculatedGeneralTax: 310, finalSelfUseTax: 110, finalGeneralTax: 310
  });
});

test("totals, owner summary, and Excel all consume final tax", () => {
  const target = land("道路用地(公共設施用地)");
  assert.deepEqual(calculateTransferTaxTotals([target]), { selfUseTax: 0, generalTax: 0 });
  const groups = calculateTaxSummaryByOwner({ lands: [target], owners: [{ id: "owner", name: "甲" }], houses: [] });
  assert.deepEqual([groups[0].selfUseTax, groups[0].generalTax], [0, 0]);
  assert.deepEqual([mainTransferValues(target, target.previousTransfers[0]).selfUseTax, mainTransferValues(target, target.previousTransfers[0]).generalTax], [0, 0]);
});

test("short A4 zoning display does not affect full-text exemption", () => {
  const configuration = createDefaultReportConfiguration();
  configuration.displayOptions.showLandZoning = true;
  configuration.displayOptions.zoningTextMode = "short";
  const target = land("道路用地(公共設施用地)");
  const html = renderA4Report({ caseName: "test", lands: [target], owners: [{ id: "owner", name: "甲" }], houses: [], caseCurrentValue: 0, ...configuration }).html;
  assert.match(html, /使用分區：道路用地/);
  assert.doesNotMatch(html, /使用分區：道路用地\(公共設施用地\)/);
  assert.equal((html.match(/class="report-money">0<\/td>/g) ?? []).length >= 4, true);
});
