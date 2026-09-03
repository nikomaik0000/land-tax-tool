import { parseLandTaxPdfDetailed } from "./pdf-parser.js?v=20260903-5";
import { renderA4Report } from "./a4-report-renderer.js?v=20260903-4";

const load = async (path) => {
  const response = await fetch(path); const blob = await response.blob();
  return parseLandTaxPdfDetailed(new File([blob], decodeURIComponent(path.split("/").at(-1)), { type: "application/pdf" }));
};
const pick = (transfer) => ({
  date: transfer.date, previousValue: transfer.previousValue, shareNumerator: transfer.shareNumerator,
  shareDenominator: transfer.shareDenominator, sourcePriceIndex: transfer.sourcePriceIndex, priceIndex: transfer.priceIndex,
  sourceAppreciationAmount: transfer.sourceAppreciationAmount,
  sourceSelfUseTax: transfer.sourceSelfUseTax, sourceGeneralTax: transfer.sourceGeneralTax,
  currentValue: transfer.currentValue
});
const equal = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}\nEXPECTED ${JSON.stringify(expected)}\nACTUAL ${JSON.stringify(actual)}`);
};

const taipei = (await load("../reference/測試用/taipei/436.pdf")).lands[0];
equal({ city: taipei.city, district: taipei.district, owner: taipei.owner }, { city: "臺北市", district: "大安", owner: "黃**" }, "Taipei identity and filename owner guard");
equal(taipei.previousTransfers.map(pick), [
  { date: "081年09月", previousValue: 120000, shareNumerator: 112, shareDenominator: 14400, sourcePriceIndex: 159.7, priceIndex: 159.7, sourceAppreciationAmount: null, sourceSelfUseTax: 5896, sourceGeneralTax: 12835, currentValue: 104533 },
  { date: "113年12月", previousValue: 432000, shareNumerator: 112, shareDenominator: 72000, sourcePriceIndex: 103.2, priceIndex: 103.2, sourceAppreciationAmount: null, sourceSelfUseTax: 11, sourceGeneralTax: 22, currentValue: 20907 }
], "Taipei 436.pdf");

const newTaipei = (await load("../reference/測試用/newtaipei/張寶玉.pdf")).lands[0];
equal({ city: newTaipei.city, district: newTaipei.district, owner: newTaipei.owner, area: newTaipei.area }, { city: "新北市", district: "樹林區", owner: "張寶玉", area: 2845.03 }, "New Taipei identity, area, and filename owner fallback");
equal(newTaipei.previousTransfers.map(pick), [
  { date: "66年10月", previousValue: 520, shareNumerator: 91, shareDenominator: 144000, priceIndex: 321, sourceAppreciationAmount: 98040.97, sourceSelfUseTax: 9804.09, sourceGeneralTax: 30832.92, currentValue: 101042 },
  { date: "105年10月", previousValue: 43000, shareNumerator: 367, shareDenominator: 144000, priceIndex: 115.1, sourceAppreciationAmount: 48631.61, sourceSelfUseTax: 4863.16, sourceGeneralTax: 9726.32, currentValue: 407499 },
  { date: "109年1月", previousValue: 39158.8, shareNumerator: 190, shareDenominator: 144000, priceIndex: 113.5, sourceAppreciationAmount: 44125.71, sourceSelfUseTax: 4412.57, sourceGeneralTax: 8825.14, currentValue: 210967 },
  { date: "112年5月", previousValue: 50900, shareNumerator: 1, shareDenominator: 15, priceIndex: 107, sourceAppreciationAmount: 329454.47, sourceSelfUseTax: 32945.44, sourceGeneralTax: 65890.89, currentValue: 10659379 }
], "New Taipei 張寶玉.pdf");

const reportState = (land) => ({
  caseName: "golden", lands: [{ ...land, id: "golden", currentValue: land.previousTransfers.reduce((sum, transfer) => sum + transfer.currentValue, 0) }],
  owners: [], houses: [], house: {}, caseCurrentValue: land.previousTransfers.reduce((sum, transfer) => sum + transfer.currentValue, 0), selectedClauses: [], customNotes: [],
  displayOptions: { showSelfUseTax: true, showLandZoning: false, zoningPrintLayout: "row", zoningTextMode: "full", printLandColumns: {}, showTaxSummary: false, taxSummaryItems: {} }, giftTax: { enabled: false }
});
const taipeiHtml = renderA4Report(reportState(taipei)).html;
if (!taipeiHtml.includes("104,533") || !taipeiHtml.includes("20,907") || /report-current-value[^>]*rowspan/.test(taipeiHtml)) throw new Error("Taipei A4 currentValue rows are not transfer-level");
const newTaipeiHtml = renderA4Report(reportState(newTaipei)).html;
if ((newTaipeiHtml.match(/report-current-value/g) ?? []).length !== 4 || /report-current-value[^>]*rowspan/.test(newTaipeiHtml)) throw new Error("New Taipei A4 currentValue rows are not transfer-level");

document.querySelector("#result").textContent = JSON.stringify({ taipei: taipei.previousTransfers.map(pick), newTaipei: newTaipei.previousTransfers.map(pick) }, null, 2);
document.body.dataset.status = "passed";
