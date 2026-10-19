import test from "node:test";
import assert from "node:assert/strict";
import { createCaseDocumentState } from "./case-documents-model.js";
import { parseWangBuildingExport, parseWangLandExport } from "./wang-case-parser.js";
import {
  addImportedFile,
  fingerprintFileContent,
  inspectImportConflict,
  removeImportedFile,
} from "./case-documents-import.js";

function landFile(id, name, fingerprint, number = "07900000") {
  return { id, name, fingerprint, type: "land", counts: { lands: 1, buildings: 0, commonParts: 0 }, warningCount: 0,
    parsed: parseWangLandExport(`LOC_NM=大同區玉泉一${number}\nTRAN_REAS=21\nPRES=0\nO_HOLDERS=1\nOIDN_BAN_1=A1\nOIDN_NM_1=甲\nO_HOLDER_CADDR_1=通訊地址\nN_HOLDERS=0`) };
}

function buildingFile(id, name, fingerprint, main = "03261000") {
  return { id, name, fingerprint, type: "building", counts: { lands: 0, buildings: 1, commonParts: 2 }, warningCount: 0,
    parsed: parseWangBuildingExport(`MAIN_BUILD_NO=${main}\nHOU_FLOORs=1\nHOU_FLOOR_NO_1=三層\nHOU_AREA_1=80\nPUB_FACs=2\nPUB_FAC_CNSTRT_NO_1=03328000\nPUB_FAC_AREA_1=100\nPUB_FAC_SHR_NMRT_1=4050\nPUB_FAC_SHR_DNT_1=100000\nPUB_FAC_CNSTRT_NO_2=03329000\nPUB_FAC_AREA_2=200\nPUB_FAC_SHR_NMRT_2=1\nPUB_FAC_SHR_DNT_2=2\nO_HOLDERS=1\nO_HOLDER_IDN_BAN_1=A1\nO_HOLDER_NM_1=甲\nN_HOLDERS=0`) };
}

test("內容指紋依位元組判斷，不依檔名", async () => {
  const a = await fingerprintFileContent(new TextEncoder().encode("same"));
  const b = await fingerprintFileContent(new TextEncoder().encode("same"));
  const c = await fingerprintFileContent(new TextEncoder().encode("different"));
  assert.equal(a, b); assert.notEqual(a, c);
  assert.equal(inspectImportConflict([{ name: "old.csv", fingerprint: a }], { name: "new.csv", fingerprint: b }).type, "duplicate-content");
});

test("同一檔案連續加入不重複，同名不同內容必須明確替換", () => {
  const state = createCaseDocumentState();
  const first = landFile("f1", "case.csv", "hash-a");
  addImportedFile(state, first); addImportedFile(state, { ...first, name: "copy.csv" });
  assert.equal(state.importedFiles.length, 1); assert.equal(state.lands.length, 1);
  const updated = landFile("f2", "case.csv", "hash-b", "08000000");
  assert.equal(inspectImportConflict(state.importedFiles, updated).type, "same-name-update");
  assert.throws(() => addImportedFile(state, updated), /必須先確認/);
  assert.equal(state.importedFiles[0].id, "f1"); assert.equal(state.lands[0].landNumber, "790");
  addImportedFile(state, updated, { replaceFileId: "f1" });
  assert.equal(state.importedFiles.length, 1); assert.equal(state.lands.length, 1); assert.equal(state.lands[0].landNumber, "800");
});

test("移除單一來源保留其他標的與共用當事人", () => {
  const state = createCaseDocumentState();
  addImportedFile(state, landFile("land", "land.csv", "land-hash"));
  addImportedFile(state, buildingFile("building", "building.csv", "building-hash"));
  assert.equal(state.parties.length, 1); assert.equal(state.parties[0].originalSources.length, 2);
  removeImportedFile(state, "land");
  assert.equal(state.lands.length, 0); assert.equal(state.buildings.length, 1); assert.equal(state.commonParts.length, 2);
  assert.equal(state.parties.length, 1); assert.equal(state.parties[0].originalSources.length, 1);
});

test("相同公設建號對應不同主建號或持分是合法資料，不在檔案層去重", () => {
  const state = createCaseDocumentState();
  const first = buildingFile("b1", "b1.csv", "h1", "03261000");
  const second = buildingFile("b2", "b2.csv", "h2", "03271000");
  second.parsed.commonParts[0].share.numerator = 1878;
  addImportedFile(state, first); addImportedFile(state, second);
  assert.equal(state.commonParts.length, 4);
  assert.deepEqual(state.commonParts.filter((item) => item.buildingNumber === "332-8000").map((item) => [item.relatedMainBuildingNumber, item.shareNumerator]), [["326-1000", "4050"], ["327-1000", "1878"]]);
});
