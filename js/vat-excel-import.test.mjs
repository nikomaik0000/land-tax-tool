import assert from "node:assert/strict";
import test from "node:test";
import { detectVatExcelHeader, fillMissingVatExcelCpi, normalizeVatExcel } from "./vat-excel-import.js";

const ids = (() => { let value = 0; return (prefix) => `${prefix}-${++value}`; })();

test("VAT Excel detects a non-first header and groups Taipei 436 transfers", () => {
  const rows = [
    ["土地增值稅匯入範例"], [],
    ["縣市", "行政區", "段名", "小段名", "地號", "土地面積", "所有權人", "當期公告現值", "持分", "前次移轉年月", "原規定地價", "CPI"],
    ["臺北市", "大安區", "學府段", "三小段", "0436-0000", 30, "黃某", 448000, "112/14400", "81年9月", 120000, 159.7],
    ["台北市", "大安", "學府", "三", "436", 30, "黃某", 448000, "112 / 72000", "113年12月", 432000, 103.2]
  ];
  assert.equal(detectVatExcelHeader(rows).index, 2);
  const result = normalizeVatExcel(rows, { idFactory: ids });
  assert.equal(result.lands.length, 1); assert.equal(result.transferCount, 2);
  assert.deepEqual(result.lands[0].previousTransfers.map(({ date, previousValue, shareNumerator, shareDenominator, priceIndex }) => ({ date, previousValue, shareNumerator, shareDenominator, priceIndex })), [
    { date: "81年9月", previousValue: 120000, shareNumerator: 112, shareDenominator: 14400, priceIndex: 159.7 },
    { date: "113年12月", previousValue: 432000, shareNumerator: 112, shareDenominator: 72000, priceIndex: 103.2 }
  ]);
});

test("explicit share columns win and mixed owners receive distinct ownerIds", () => {
  const rows = [["區", "段", "地號", "姓名", "持分", "持分分子", "持分分母", "前次移轉現值"], ["大安", "學府", "1", "甲", "1/2", 3, 5, 100], ["內湖", "碧湖", "2", "乙", "1/4", "", "", 200]];
  const result = normalizeVatExcel(rows, { idFactory: ids });
  assert.deepEqual(result.owners.map((owner) => owner.name), ["甲", "乙"]);
  assert.notEqual(result.lands[0].ownerId, result.lands[1].ownerId);
  assert.deepEqual([result.lands[0].previousTransfers[0].shareNumerator, result.lands[0].previousTransfers[0].shareDenominator], [3, 5]);
  assert.deepEqual([result.lands[1].previousTransfers[0].shareNumerator, result.lands[1].previousTransfers[0].shareDenominator], [1, 4]);
});

test("manual zoning is preserved and invalid rows or conflicts produce warnings", () => {
  const rows = [["城市", "區", "段", "地號", "面積", "土地使用分區", "前次移轉現值"], ["臺北市", "大安", "學府", "436", 30, "道路用地(公共設施用地)", 100], ["臺北市", "大安", "學府", "436", 31, "道路用地(公共設施用地)", 200], ["臺北市", "大安", "學府", "", 1, "", 300]];
  const result = normalizeVatExcel(rows, { idFactory: ids });
  assert.equal(result.lands[0].zoningManual, true); assert.equal(result.lands[0].area, 30);
  assert.equal(result.skippedRows, 1); assert.equal(result.warnings.length, 2);
});

test("unrecognized workbooks fail clearly", () => assert.throws(() => normalizeVatExcel([["foo", "bar"], [1, 2]]), /找不到可辨識的土地資料欄位/));

test("CPI fallback fills only missing values from the shared CPI lookup", () => {
  const lands = [{ previousTransfers: [{ date: "81年9月", priceIndex: null }, { date: "113年12月", priceIndex: 103.2, cpiSource: "manual" }] }];
  fillMissingVatExcelCpi(lands, { values: new Map([["81-9", 159.7], ["113-12", 999]]) });
  assert.deepEqual(lands[0].previousTransfers.map(({ priceIndex, cpiSource }) => ({ priceIndex, cpiSource })), [{ priceIndex: 159.7, cpiSource: "lookup" }, { priceIndex: 103.2, cpiSource: "manual" }]);
});
