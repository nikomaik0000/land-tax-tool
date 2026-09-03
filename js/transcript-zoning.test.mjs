import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTranscriptZoningRecord } from "./transcript-zoning.js";
import { zoningLookupKey } from "./zoning-core.js";

test("transcript zoning adapter fills Taipei only from a known manifest district", () => {
  const record = normalizeTranscriptZoningRecord({ district: "內湖區", section: "碧湖段", subsection: "五小段", landNumber: "0085-0000" }, ["大安區", "內湖區"]);
  assert.deepEqual([record.city, record.district, record.section, record.subsection, record.landNumber], ["臺北市", "內湖", "碧湖", "5", "85"]);
  assert.equal(zoningLookupKey(record), "內湖|碧湖|5|85|0");
});

test("transcript zoning adapter does not guess an unknown or explicit New Taipei district", () => {
  assert.equal(normalizeTranscriptZoningRecord({ district: "板橋區" }, ["大安區", "內湖區"]).city, "");
  assert.equal(normalizeTranscriptZoningRecord({ city: "新北市", district: "板橋區" }, ["大安區"]).city, "新北市");
});
