import assert from "node:assert/strict";
import fs from "node:fs";
import { buildLandNumberLookupKey } from "./land-value-normalization.js";
import { applyLookup, createDistrictLookup, detectLandNumberHeaderRow, expandResultRows, parseWorkbookRecords } from "./land-number-converter-core.js";

assert.equal(buildLandNumberLookupKey({ city: "新北", district: " 汐止區 ", section: "汐止段汐止小段", landNumber: "00060002" }), "新北市|汐止|汐止|汐止|6-2");
assert.equal(buildLandNumberLookupKey({ city: "新北市", district: "汐　止", section: "汐 止段", subsection: "汐止小段", landNumber: "０００６－０００２" }), "新北市|汐止|汐止|汐止|6-2");
assert.equal(buildLandNumberLookupKey({ city: "台北", district: "大同區", section: "圓環段一小段", landNumber: "1" }), "臺北市|大同|圓環|1|1");

const workbookRows = [
  ["案件名稱", "測試"],
  [],
  ["所有權人", "行政區", "段", "小段", "地號", "備註"],
  ["王小明", "汐止區", "汐止段", "汐止小段", "0006-0002", "保留"]
];
const header = detectLandNumberHeaderRow(workbookRows);
assert.equal(header.index, 2);
const parsed = parseWorkbookRecords(workbookRows, header);
assert.equal(parsed.records[0].originalRow[0], "王小明");
assert.equal(parsed.records[0].landNumber, "6-2");

const xizhiCsv = fs.readFileSync(new URL("../material/land-number/new-taipei/xizhi.csv", import.meta.url), "utf8");
const oldLookup = createDistrictLookup(xizhiCsv, "old-to-new", "新北市").index;
const oldResult = applyLookup(parsed.records, new Map([["新北市|汐止", oldLookup]]), "old-to-new");
assert.equal(oldResult[0].status, "multiple");
assert.deepEqual(oldResult[0].matches.map((item) => item.landNumberNew).sort(), ["11", "52"]);
assert.equal(expandResultRows(oldResult, "old-to-new").length, 2);

const newLookup = createDistrictLookup(xizhiCsv, "new-to-old", "新北市").index;
const maximumReverseMappings = Math.max(...newLookup.values().map((items) => items.length));
assert.equal(maximumReverseMappings, 36);

const missing = applyLookup([{ ...parsed.records[0], landNumber: "999999" }], new Map([["新北市|汐止", oldLookup]]), "old-to-new");
assert.equal(missing[0].status, "not-found");
assert.equal(expandResultRows(missing, "old-to-new").length, 1);

const datongCsv = fs.readFileSync(new URL("../material/land-number/taipei/datong.csv", import.meta.url), "utf8");
const taipeiOldLookup = createDistrictLookup(datongCsv, "old-to-new", "臺北市").index;
const taipeiRecord = { city: "臺北市", district: "大同", section: "下奎府三小", subsection: "", landNumber: "34-21" };
const taipeiOldResult = applyLookup([taipeiRecord], new Map([["臺北市|大同", taipeiOldLookup]]), "old-to-new");
assert.equal(taipeiOldResult[0].status, "multiple");
assert.deepEqual(taipeiOldResult[0].matches.map((item) => `${item.sectionNew}|${item.subsectionNew}|${item.landNumberNew}`).sort(), ["圓環|一|480", "圓環|二|2"]);
const taipeiNewLookup = createDistrictLookup(datongCsv, "new-to-old", "臺北市").index;
const taipeiNewResult = applyLookup([{ city: "台北市", district: "大同區", section: "圓環", subsection: "一", landNumber: "1" }], new Map([["臺北市|大同", taipeiNewLookup]]), "new-to-old");
assert.equal(taipeiNewResult[0].status, "found");
assert.equal(taipeiNewResult[0].matches[0].landNumberOld, "57-1");

const mixedRows = [["縣市", "區", "段", "小段", "地號"], ["台北市", "大同區", "圓環段", "一小段", "1"], ["新北市", "汐止區", "汐止段", "汐止小段", "6-2"]];
const mixedHeader = detectLandNumberHeaderRow(mixedRows);
const mixed = parseWorkbookRecords(mixedRows, mixedHeader, "新北市").records;
assert.deepEqual(mixed.map((record) => record.city), ["臺北市", "新北市"]);

console.log("land-number-converter tests passed");
