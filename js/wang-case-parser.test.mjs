import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeWangExport,
  parseWangBuildingExport,
  parseWangLandExport,
} from "./wang-case-parser.js";

test("解析多筆共有部分，且不與主建物資料或關聯混用", () => {
  const result = parseWangBuildingExport([
    "HOU_CNSTRT_NO=00000001234000",
    "MAIN_BUILD_NO=01234000",
    "HOU_LOSN=",
    "TRAN_PRC=",
    "PUB_FACs=2",
    "PUB_FAC_CNSTRT_NO_1=05678000",
    "PUB_FAC_AREA_1=1778.91",
    "PUB_FAC_SHR_NMRT_1=1878",
    "PUB_FAC_SHR_DNT_1=100000",
    "PUB_FAC_CNSTRT_NO_2=05679000",
    "PUB_FAC_AREA_2=844.89",
    "PUB_FAC_SHR_NMRT_2=250",
    "PUB_FAC_SHR_DNT_2=12000",
  ].join("\r\n"));

  assert.equal(result.mainBuilding.buildingNumberRaw, "01234000");
  assert.equal(result.mainBuilding.taxNumber, null);
  assert.equal(result.mainBuilding.sourceCurrentValue, null);
  assert.equal(result.commonParts.length, 2);
  assert.deepEqual(result.commonParts[0], {
    index: 1,
    buildingNumberRaw: "05678000",
    buildingNumber: "567-8000",
    area: 1778.91,
    share: { numerator: 1878, denominator: 100000 },
    relatedMainBuildingNumbers: [],
    relationStatus: "not-provided",
  });
  assert.equal(result.commonParts[1].buildingNumberRaw, "05679000");
  assert.equal(result.commonParts[1].area, 844.89);
  assert.deepEqual(result.commonParts[1].share, { numerator: 250, denominator: 12000 });
});

test("空白數值保留為 null，明確的零仍保留為零", () => {
  const result = parseWangBuildingExport([
    "HOU_LOSN=",
    "TRAN_PRC=",
    "PUB_FACs=0",
    "OTH_BUILD_NOS=0",
    "HOU_FLOORs=1",
    "HOU_FLOOR_NO_1=測試層",
    "HOU_AREA_1=",
  ].join("\n"));

  assert.equal(result.mainBuilding.taxNumber, null);
  assert.equal(result.mainBuilding.sourceCurrentValue, null);
  assert.equal(result.mainBuilding.floorDetails[0].area, null);
  assert.equal(result.commonPartCount, 0);
  assert.equal(result.commonParts.length, 0);
  assert.equal(result.otherBuildingCount, 0);
});

test("共有部分列數隨實際索引增加，並回報計數不一致", () => {
  const result = parseWangBuildingExport([
    "PUB_FACs=2",
    "PUB_FAC_CNSTRT_NO_1=00001000",
    "PUB_FAC_CNSTRT_NO_2=00002000",
    "PUB_FAC_CNSTRT_NO_3=00003000",
  ].join("\n"));

  assert.equal(result.commonParts.length, 3);
  assert.ok(result.warnings.some((warning) => warning.code === "indexed-data-exceeds-count"));
});

test("土地原始總現值及前次移轉逐筆保存，不執行覆寫計算", () => {
  const result = parseWangLandExport([
    "TRAN_REAS=21",
    "TRAN_AREA=9.66",
    "ANNO_PR_VAL_PRC=625891",
    "TRAN_RATE_NMRT=3615",
    "TRAN_RATE_DNT=350000",
    "TRAN_PRC=6044363",
    "PRES=1",
    "PRE_1=TEST000001_01234000_11412_490874_3615_350000",
  ].join("\n"));

  assert.equal(result.parcel.sourceTotalCurrentValue, 6044363);
  assert.equal(result.parcel.previousTransfers.length, 1);
  assert.equal(result.parcel.previousTransfers[0].landNumberRaw, "01234000");
  assert.equal(result.parcel.previousTransfers[0].announcedCurrentValue, 490874);
  assert.deepEqual(result.parcel.previousTransfers[0].share, {
    numerator: 3615,
    denominator: 350000,
  });
});

test("Big5 位元組可在本機解碼", () => {
  const bytes = Uint8Array.from([
    0x53, 0x45, 0x43, 0x5f, 0x43, 0x48, 0x49, 0x5f, 0x4e, 0x4d, 0x3d,
    0xb4, 0xfa, 0xb8, 0xd5, 0x0d, 0x0a,
  ]);

  assert.equal(decodeWangExport(bytes), "SEC_CHI_NM=測試\r\n");
});

test("土地與建物當事人生日保留原始值", () => {
  const land = parseWangLandExport("O_HOLDERS=1\nOIDN_NM_1=甲\nOBORN_DATE_1=750312\nN_HOLDERS=0\nPRES=0");
  const building = parseWangBuildingExport("O_HOLDERS=0\nN_HOLDERS=1\nN_HOLDER_NM_1=乙\nNBORN_DATE_1=1141205\nPUB_FACs=0\nHOU_FLOORs=0");
  assert.equal(land.parties.oldOwners[0].birthDate, "750312");
  assert.equal(building.parties.newOwners[0].birthDate, "1141205");
});
