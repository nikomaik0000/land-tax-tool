import assert from "node:assert/strict";
import { compareLandNumbers, orderLandsByDocuments, sortDocumentsByLand } from "./document-order.js";

assert.ok(compareLandNumbers("441-2", "441-10") < 0);
assert.deepEqual(["441", "441-10", "441-2", "441-1"].sort(compareLandNumbers), ["441", "441-1", "441-2", "441-10"]);

const files = ["495", "436", "452", "441-1", "441"].map((name) => ({ id: name, file: { name: `${name}.pdf` } }));
const lands = files.map((entry) => ({ id: `land-${entry.id}`, sourceFileId: entry.id, district: "大安", section: "仁愛", subsection: "一", landNumber: entry.id }));
const sorted = sortDocumentsByLand(files, lands);
assert.deepEqual(sorted.map((entry) => entry.id), ["436", "441", "441-1", "452", "495"]);
assert.deepEqual(orderLandsByDocuments(lands, sorted).map((land) => land.sourceFileId), ["436", "441", "441-1", "452", "495"]);

const cityFiles = ["new-taipei-banqiao", "taipei-shilin", "new-taipei-xindian", "taipei-daan-2", "taipei-daan-1"].map((id) => ({ id, file: { name: `${id}.pdf` } }));
const cityLands = [
  ["new-taipei-banqiao", "板橋", "文化", "10"], ["taipei-shilin", "士林", "天母", "1"],
  ["new-taipei-xindian", "新店", "中央", "1"], ["taipei-daan-2", "大安", "信義", "2"], ["taipei-daan-1", "大安", "信義", "1"]
].map(([sourceFileId, district, section, landNumber]) => ({ sourceFileId, district, section, subsection: "", landNumber }));
assert.deepEqual(sortDocumentsByLand(cityFiles, cityLands).map((entry) => entry.id), ["taipei-shilin", "taipei-daan-1", "taipei-daan-2", "new-taipei-banqiao", "new-taipei-xindian"]);

const invalidFiles = [...files.slice(0, 2), { id: "invalid-a", file: { name: "a.pdf" } }, { id: "invalid-b", file: { name: "b.pdf" } }];
assert.deepEqual(sortDocumentsByLand(invalidFiles, lands).slice(-2).map((entry) => entry.id), ["invalid-a", "invalid-b"]);
console.log("document order tests passed");
