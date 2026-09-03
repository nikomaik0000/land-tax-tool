import assert from "node:assert/strict";
import { calculateCombinedTransferShare, calculateLandCurrentValue, calculateTransferTaxTotals } from "./calculations.js";
import { compareRocYearMonth, parseNormalizedTextItems, sortPreviousTransfersOldestFirst } from "./pdf-parser.js";
import { formatShareForPrint, renderA4Report } from "./a4-report-renderer.js";
import { createEmptyLand, migrateTransferShares } from "./state.js";
import { mainTransferValues } from "./excel-export.js";

const item = (text, x, y) => ({ text, normalizedText: text.replaceAll(" ", ""), x, y, width: Math.max(10, text.length * 9), height: 10, page: 1 });
const taipeiSyntheticItems = (count) => [
  item("臺北地政雲", 10, 800), item("臺北市(02)大安區", 10, 780), item("(0223)學府段三小段", 10, 760), item("0436-0000地號", 160, 760), item("土地面積", 10, 740), item("30", 251, 740), item("公告現值", 10, 720), item("448000", 251, 720),
  ...Array.from({ length: count }, (_, index) => {
    const y = 680 - index * 120; const denominator = 14400 * (index + 1); const year = String(81 + index).padStart(3, "0");
    return [item("前次移轉現值(元/平方公尺)", 36, y), item(String(120000 + index), 251, y), item("原地價年月", 36, y - 20), item(`${year}年09月`, 251, y - 20), item("歷次權利範圍", 36, y - 40), item(`${denominator}分之112`, 251, y - 40), item("物價指數", 36, y - 60), item(String(159.7 - index), 251, y - 60), item("自用住宅用地應納稅額", 36, y - 80), item(String(100 + index), 251, y - 80), item("一般土地應納稅額", 36, y - 100), item(String(200 + index), 251, y - 100)];
  }).flat()
];
const items = [
  item("generic fixture", 10, 800), item("地號", 10, 770), item("632", 100, 770), item("土地面積", 10, 750), item("100", 100, 750), item("公告現值", 180, 750), item("56,200", 270, 750),
  item("前次移轉年月", 10, 700), item("前次移轉現值", 150, 700), item("持分", 290, 700), item("物價指數", 390, 700), item("自用增值稅", 490, 700), item("一般/工業用地稅額", 610, 700),
  ...[
    ["112年5月", "50,900", "1/15", "107", "32,945.44", "65,890.89"],
    ["66年10月", "520", "91/144000", "321", "9,804.09", "30,832.92"],
    ["109年1月", "39,158.8", "190/144000", "113.5", "4,412.57", "8,825.14"],
    ["105年10月", "43,000", "367/144000", "115.1", "4,863.16", "9,726.32"]
  ].flatMap((row, index) => row.map((text, column) => item(text, [10, 150, 290, 390, 490, 610][column], 660 - index * 45)))
];

const result = parseNormalizedTextItems(items, "new-taipei-four.pdf");
const land = result.lands[0];
assert.equal(parseNormalizedTextItems(items, "張寶玉.pdf").lands[0].owner, "張寶玉");
assert.equal(parseNormalizedTextItems(taipeiSyntheticItems(1), "436.pdf").lands[0].owner, "");
assert.equal(land.previousTransfers.length, 4, "the fourth row beyond the old 90pt header window must survive");
assert.deepEqual(land.previousTransfers.map(({ date, previousValue, shareNumerator, shareDenominator, priceIndex }) => ({ date, previousValue, shareNumerator, shareDenominator, priceIndex })), [
  { date: "66年10月", previousValue: 520, shareNumerator: 91, shareDenominator: 144000, priceIndex: 321 },
  { date: "105年10月", previousValue: 43000, shareNumerator: 367, shareDenominator: 144000, priceIndex: 115.1 },
  { date: "109年1月", previousValue: 39158.8, shareNumerator: 190, shareDenominator: 144000, priceIndex: 113.5 },
  { date: "112年5月", previousValue: 50900, shareNumerator: 1, shareDenominator: 15, priceIndex: 107 }
]);
assert.deepEqual(calculateCombinedTransferShare(land), { numerator: 10248, denominator: 144000 });
assert.equal(calculateLandCurrentValue(land), 399957);
assert.deepEqual(calculateTransferTaxTotals([land]), { selfUseTax: 52025, generalTax: 115275 });

const state = { caseName: "測試", lands: [{ ...land, id: "land", currentValue: calculateLandCurrentValue(land) }], owners: [], houses: [], house: {}, caseCurrentValue: 399957, totalLandCurrentValue: 399957, selectedClauses: [], customNotes: [], displayOptions: { showSelfUseTax: true, showLandZoning: false, zoningPrintLayout: "row", zoningTextMode: "full", printLandColumns: {}, showTaxSummary: false, taxSummaryItems: {} }, giftTax: { enabled: false } };
const html = renderA4Report(state).html;
assert.match(html, />1 \/ 15</);
for (const numerator of [91, 190, 367]) assert.match(html, new RegExp(`report-share-single-line">${numerator} \\/ 144000<\\/span>`));
assert.equal((html.match(/report-current-value/g) ?? []).length, 4, "each transfer renders its own current value");
const twoLineHtml = renderA4Report({ ...state, displayOptions: { ...state.displayOptions, sharePrintLayout: "two-line" } }).html;
for (const numerator of [91, 190, 367]) assert.match(twoLineHtml, new RegExp(`<span>${numerator} \\/<\\/span><span>144000<\\/span>`));
assert.match(twoLineHtml, /<span>1 \/<\/span><span>15<\/span>/);

const legacySingle = migrateTransferShares({ shareNumerator: 2, shareDenominator: 7, previousTransfers: [{ date: "100年1月" }] });
assert.deepEqual([legacySingle.previousTransfers[0].shareNumerator, legacySingle.previousTransfers[0].shareDenominator, legacySingle.shareNeedsReview], [2, 7, false]);
const legacyMultiple = createEmptyLand({ shareNumerator: 1, shareDenominator: 2, previousTransfers: [{ date: "100年1月" }, { date: "101年1月" }] });
assert.equal(legacyMultiple.shareNeedsReview, true);
assert.equal(legacyMultiple.previousTransfers[1].shareNumerator, null, "a legacy land share must not be copied to every transfer");
assert.ok(compareRocYearMonth("081年09月", "113年12月") < 0);
assert.deepEqual(sortPreviousTransfersOldestFirst([{ date: "" }, { date: "112年5月" }, { date: "bad" }, { date: "66年10月" }]).map((transfer) => transfer.date), ["66年10月", "112年5月", "", "bad"]);
assert.match(formatShareForPrint(91, 144000), /report-share-single-line/);
assert.match(formatShareForPrint(190, 144000), /report-share-single-line/);
assert.match(formatShareForPrint(367, 144000), /report-share-single-line/);
assert.match(formatShareForPrint(1, 15), /report-share-single-line/);
assert.match(formatShareForPrint(1, 15, "two-line"), /report-share-two-line/);

const taipeiLand = { area: 30, announcedValue: 448000, previousTransfers: [
  { date: "081年09月", previousValue: 120000, shareNumerator: 112, shareDenominator: 14400, priceIndex: 159.7, currentValue: 104533, selfUseTax: 5896, generalTax: 12835 },
  { date: "113年12月", previousValue: 432000, shareNumerator: 112, shareDenominator: 72000, priceIndex: 103.2, currentValue: 20907, selfUseTax: 11, generalTax: 22 }
] };
assert.equal(calculateLandCurrentValue(taipeiLand), 125440);
assert.deepEqual(taipeiLand.previousTransfers.map((transfer) => mainTransferValues(taipeiLand, transfer)), [
  { share: "112 / 14400", currentValue: 104533, date: "081年09月", previousValue: 120000, priceIndex: 159.7, selfUseTax: 5896, generalTax: 12835 },
  { share: "112 / 72000", currentValue: 20907, date: "113年12月", previousValue: 432000, priceIndex: 103.2, selfUseTax: 11, generalTax: 22 }
]);
for (let count = 1; count <= 4; count += 1) {
  const parsed = parseNormalizedTextItems(taipeiSyntheticItems(count), `taipei-${count}.pdf`);
  assert.equal(parsed.lands[0].previousTransfers.length, count, `Taipei adapter supports ${count} transfer blocks`);
  assert.deepEqual(parsed.lands[0].previousTransfers.map((transfer) => transfer.shareDenominator), Array.from({ length: count }, (_, index) => 14400 * (index + 1)));
}

console.log("multi-transfer parser, share, current-value, totals, and A4 regressions passed");
