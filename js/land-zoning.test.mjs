import test from "node:test";
import assert from "node:assert/strict";
import { applyLandZoningResults, setManualLandZoning } from "./land-zoning.js";

test("multiple zoning results stay on one land in source order", () => {
  const lands = [{ zoning: "", zonings: [], zoningManual: false }];
  applyLandZoningResults(lands, [{ status: "multiple", matches: [{ zoning: "第三種住宅區" }, { zoning: "道路用地" }, { zoning: "第三種住宅區" }] }]);
  assert.deepEqual(lands[0].zonings, ["第三種住宅區", "道路用地"]);
  assert.equal(lands[0].zoning, "第三種住宅區、道路用地");
});

test("automatic lookup never overwrites a manual zoning", () => {
  const land = setManualLandZoning({ zoning: "", zonings: [] }, "人工確認分區");
  applyLandZoningResults([land], [{ status: "found", matches: [{ zoning: "住宅區" }] }]);
  assert.equal(land.zoning, "人工確認分區"); assert.equal(land.zoningManual, true);
});

test("unsupported results leave New Taipei zoning blank", () => {
  const land = { zoning: "舊值", zonings: ["舊值"], zoningManual: false };
  applyLandZoningResults([land], [{ status: "unsupported", matches: [] }]);
  assert.equal(land.zoning, ""); assert.deepEqual(land.zonings, []); assert.equal(land.zoningStatus, "unsupported");
});
