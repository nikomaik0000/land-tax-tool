import test from "node:test";
import assert from "node:assert/strict";
import { applyZoningLookup, createTaipeiZoningLookup, parseZoningWorkbookRecords } from "./zoning-core.js";

test("Taipei official rows normalize into a parcel lookup", () => {
  const csv = "district,section,subsection,mainNumber,subNumber,zoning\n萬華區,直興,1,4,0,第四種商業區\n";
  const parsed = parseZoningWorkbookRecords([["縣市", "區", "段", "小段", "地號"], ["臺北市", "萬華區", "直興段", "一小段", "4"]]);
  const indexes = new Map([["臺北市|萬華", createTaipeiZoningLookup(csv)]]);
  const [record] = applyZoningLookup(parsed.records, indexes);
  assert.equal(record.status, "found"); assert.equal(record.matches[0].zoning, "第四種商業區"); assert.equal(record.matches[0].landType, "都市土地");
});

test("New Taipei rows are explicit unsupported results", () => {
  const parsed = parseZoningWorkbookRecords([["縣市", "區", "段", "地號"], ["新北市", "板橋區", "文化段", "123-4"]]);
  assert.equal(applyZoningLookup(parsed.records, new Map())[0].status, "unsupported");
});

test("Chinese-number subsection matches Taipei numeric source data", () => {
  const csv = "district,section,subsection,mainNumber,subNumber,zoning\n大安區,學府,3,436,0,第三種住宅區\n";
  const parsed = parseZoningWorkbookRecords([["縣市", "區", "段", "小段", "地號"], ["臺北市", "大安區", "學府段", "三小段", "436"]]);
  const indexes = new Map([["臺北市|大安", createTaipeiZoningLookup(csv)]]);
  assert.equal(applyZoningLookup(parsed.records, indexes)[0].matches[0].zoning, "第三種住宅區");
});
