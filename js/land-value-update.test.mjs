import assert from "node:assert/strict";
import { formatLandNumber } from "./formatters.js";
import { buildLandValueDiagnosticKey, buildLandValueKey, compareLandValueRecord, normalizeLandValueRecord } from "./land-value-normalization.js";
import { LAND_VALUE_DATA } from "./land-value-sources.js";

for (const [raw, expected] of [["00010000", "1"], ["00010001", "1-1"]]) {
  assert.equal(formatLandNumber(raw), expected);
}

const source = normalizeLandValueRecord({ city: "台北市", district: "士林區", section: "天母段一小段", landNumber: "00010001", officialValue: 550000, officialPrice: 145000 });
assert.equal(source.officialPrice, 145000);
const key = buildLandValueKey(source);
assert.equal(key, "臺北市|士林|天母|1|1-1");
assert.equal(buildLandValueDiagnosticKey(source), "臺北市|天母|1|1-1");
assert.equal(LAND_VALUE_DATA.taipei.path, "./material/taipei_value.csv");
assert.equal(LAND_VALUE_DATA.newTaipei.path, "./material/newtaipei_value.csv");
const index = new Map([[key, source]]);
assert.equal(compareLandValueRecord({ ...source, originalAnnouncedValue: 550000 }, index).lookupStatus, "same");
assert.equal(compareLandValueRecord({ ...source, originalAnnouncedValue: 540000 }, index).lookupStatus, "changed");
assert.equal(compareLandValueRecord({ ...source, landNumber: "99", originalAnnouncedValue: 1 }, index).lookupStatus, "not-found");
assert.equal(normalizeLandValueRecord({ ...source, officialValue: "1,200" }).officialValue, 1200);

for (const [officialLandNumber, queryLandNumber] of [["00370000", "37"], ["00370001", "37-1"]]) {
  const taipeiRecord = normalizeLandValueRecord({ city: "臺北市", district: " 士林區", section: "天母段一小段", landNumber: officialLandNumber, officialValue: 365000 });
  const taipeiIndex = new Map([[buildLandValueKey(taipeiRecord), taipeiRecord]]);
  const result = compareLandValueRecord({ city: "臺北市", district: "士林", section: "天母", subsection: "一", landNumber: queryLandNumber, originalAnnouncedValue: null }, taipeiIndex);
  assert.equal(result.latestAnnouncedValue, 365000);
  assert.equal(result.lookupStatus, "changed");
}

const hundred = Array.from({ length: 100 }, (_, indexValue) => ({ ...source, originalAnnouncedValue: 550000, landNumber: indexValue === 0 ? "1-1" : String(indexValue + 1000) }));
assert.equal(hundred.map((record) => compareLandValueRecord(record, index)).filter((result) => result.lookupStatus === "same").length, 1);
console.log("land-value-update tests passed");
