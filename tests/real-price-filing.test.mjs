import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMMON_FILING_NOTE,
  FILING_DRAFT_STORAGE_KEY,
  buildRealPriceGovernmentJson,
  createCandidateBasename,
  createRealPriceFilingDraft,
  createSingleFileZip,
  inferTransactionTypeFromCase,
  loadRealPriceFilingDraft,
  parseGovernmentCodeCsv,
  selectSavedFilingAgent,
  splitGovernmentAddress,
  syncRealPriceFilingFromCase,
  syncTransactionTypeFromCase,
  validateRealPriceFiling,
} from "../js/real-price-filing.js";

const csv = await readFile(new URL("../material/real-price-government-codes-20230218.csv", import.meta.url), "utf8");
const codeRows = parseGovernmentCodeCsv(csv);
const sectionSnapshot = JSON.parse(await readFile(new URL("../material/real-price-section-codes-20261022.json", import.meta.url), "utf8"));
const sectionRows = sectionSnapshot.sections;

function syntheticCase() {
  return {
    caseInfo: { district: "中正區" },
    parties: [
      { id: "buyer-1", title: "權利人", name: "合成買方甲", idNumber: "TESTBUY001", phoneNote: "0200000001", address: "臺北市中正區測試路1號" },
      { id: "buyer-duplicate", title: "權利人", name: "合成買方甲", idNumber: "TESTBUY001", phoneNote: "0200000001", address: "臺北市中正區測試路1號" },
      { id: "seller-1", title: "義務人", name: "合成賣方乙", idNumber: "TESTSEL001", phoneNote: "0200000002", address: "臺北市中正區測試路2號" },
    ],
    lands: [{ id: "land-1", locationRaw: "臺北市中正區公園段二小段00010000", section: "公園", subsection: "二", landNumber: "0001-0000", shareNumerator: "1", shareDenominator: "1" }],
    buildings: [],
  };
}

function completeDraft() {
  const draft = createRealPriceFilingDraft();
  syncRealPriceFilingFromCase(draft, syntheticCase(), codeRows);
  draft.location.officeCode = "AB";
  draft.location.officeName = "建成地政事務所";
  draft.applicantKind = "13";
  draft.transaction = { propertyType: "normal", contractDate: "1151022", totalPrice: "12345678" };
  draft.building = { rooms: "", halls: "", bathrooms: "", noPartitions: true, management: "0", elevator: "0" };
  draft.parking.hasParking = "no";
  return draft;
}

test("官方管轄代碼快照可解析，並依土地坐落唯一帶入縣市、行政區與地所", () => {
  const draft = createRealPriceFilingDraft();
  syncRealPriceFilingFromCase(draft, syntheticCase(), codeRows);
  assert.equal(draft.location.cityCode, "A");
  assert.equal(draft.location.districtCode, "03");
  assert.equal(draft.location.officeCode, "");
  assert.equal(draft.buyers.length, 1, "同角色同證號不得重複");
  assert.equal(draft.sellers.length, 1);
});

test("多地所候選保持未選，唯一候選才預選", () => {
  const draft = createRealPriceFilingDraft();
  const state = syntheticCase();
  state.caseInfo.district = "大安區";
  state.lands[0].locationRaw = "臺北市大安區仁愛段一小段00010000";
  syncRealPriceFilingFromCase(draft, state, codeRows);
  assert.equal(draft.location.officeCode, "AF");
});

test("地址只從前綴拆分，不重複截取路名中的行政區文字", () => {
  const split = splitGovernmentAddress("臺北市中正區中正區街3號", codeRows);
  assert.equal(split.cityCode, "A");
  assert.equal(split.districtCode, "03");
  assert.equal(split.addressRemainder, "中正區街3號");
});

test("常用代理人資料為複製值，後續編輯不改來源物件", () => {
  const draft = createRealPriceFilingDraft();
  const source = { id: "agent-1", name: "合成代理人", idNumber: "TESTAGT001", phone: "0200000003", address: "臺北市大安區測試路3號" };
  selectSavedFilingAgent(draft, source, codeRows);
  draft.agent.phone = "0999000000";
  assert.equal(source.phone, "0200000003");
  assert.equal(draft.agent.districtCode, "02");
});

test("新申報預設代理人申報，已儲存草稿的選擇不被覆蓋", () => {
  const fresh = createRealPriceFilingDraft();
  assert.equal(fresh.applicantKind, "16");
  assert.equal(buildRealPriceGovernmentJson(fresh).case_master.case_kind, "16");
  fresh.applicantKind = "13";
  const storage = { getItem: (key) => key === FILING_DRAFT_STORAGE_KEY ? JSON.stringify(fresh) : null };
  const restored = loadRealPriceFilingDraft(storage);
  assert.equal(restored.applicantKind, "13");
  assert.equal(buildRealPriceGovernmentJson(restored).case_master.case_kind, "13");
});

test("缺漏資料列為可確認後下載的提醒，格式錯誤才阻擋", () => {
  const warnings = validateRealPriceFiling(createRealPriceFilingDraft(), codeRows, sectionRows);
  assert.ok(warnings.some((issue) => issue.key === "contractDate" && issue.severity === "warning"));
  assert.ok(warnings.some((issue) => issue.key === "totalPrice" && issue.severity === "warning"));
  assert.ok(warnings.some((issue) => issue.key === "agentEnabled" && issue.severity === "warning"));
  assert.equal(warnings.some((issue) => issue.severity === "error"), false);
  const invalid = createRealPriceFilingDraft();
  invalid.transaction.contractDate = "1150231";
  invalid.transaction.totalPrice = "12.5";
  assert.ok(validateRealPriceFiling(invalid, codeRows, sectionRows).some((issue) => issue.severity === "error"));
});

test("土地、土地加建物及僅建物 CSV 依規則推斷交易類型", () => {
  const land = { importedFiles: [{ type: "land", fingerprint: "land-a" }] };
  const both = { importedFiles: [{ type: "land", fingerprint: "land-a" }, { type: "building", fingerprint: "build-a" }] };
  const building = { importedFiles: [{ type: "building", fingerprint: "build-b" }] };
  assert.equal(inferTransactionTypeFromCase(land).propertyType, "land-only");
  assert.equal(inferTransactionTypeFromCase(both).propertyType, "normal");
  const buildingResult = inferTransactionTypeFromCase(building);
  assert.equal(buildingResult.propertyType, "normal");
  assert.match(buildingResult.hint, /無法判斷是否為僅車位交易/);
});

test("手動交易類型在同一案件保留，完全不同案件才重新判斷", () => {
  const draft = createRealPriceFilingDraft();
  syncTransactionTypeFromCase(draft, { importedFiles: [{ type: "land", fingerprint: "land-a" }] });
  assert.equal(draft.transaction.propertyType, "land-only");
  draft.transaction.propertyType = "parking-only";
  draft.transaction.propertyTypeManual = true;
  syncTransactionTypeFromCase(draft, { importedFiles: [{ type: "land", fingerprint: "land-a" }, { type: "building", fingerprint: "build-a" }] });
  assert.equal(draft.transaction.propertyType, "parking-only", "同一案件加入建物檔不可覆蓋手動選擇");
  syncTransactionTypeFromCase(draft, { importedFiles: [{ type: "building", fingerprint: "build-new" }] });
  assert.equal(draft.transaction.propertyType, "normal", "沒有來源重疊時視為不同案件並重新推斷");
  assert.equal(draft.transaction.propertyTypeManual, false);
});

test("既有草稿的交易類型優先於首次載入時的 CSV 推斷", () => {
  const saved = createRealPriceFilingDraft();
  saved.transaction.propertyType = "parking-only";
  delete saved.transaction.propertyTypeManual;
  delete saved.transaction.sourceFileKeys;
  const storage = { getItem: (key) => key === FILING_DRAFT_STORAGE_KEY ? JSON.stringify(saved) : null };
  const restored = loadRealPriceFilingDraft(storage);
  syncTransactionTypeFromCase(restored, { importedFiles: [{ type: "building", fingerprint: "saved-building" }] });
  assert.equal(restored.transaction.propertyType, "parking-only");
  assert.equal(restored.transaction.propertyTypeManual, true);
});

test("最終交易類型只產生一致的 caseflag3、caseflag5 與車位特殊代碼", () => {
  const draft = createRealPriceFilingDraft();
  draft.transaction.propertyType = "land-only";
  let content = buildRealPriceGovernmentJson(draft).case_detail.tab1.case_content;
  assert.equal(content.caseflag3, "3");
  assert.equal(content.caseflag5, "");
  assert.equal(content.p1sp_code0801, "");
  draft.transaction.propertyType = "parking-only";
  content = buildRealPriceGovernmentJson(draft).case_detail.tab1.case_content;
  assert.equal(content.caseflag3, "");
  assert.equal(content.caseflag5, "5");
  assert.equal(content.p1sp_code0801, "Y");
  draft.transaction.propertyType = "normal";
  content = buildRealPriceGovernmentJson(draft).case_detail.tab1.case_content;
  assert.equal(content.caseflag3, "");
  assert.equal(content.caseflag5, "");
});

test("簡化備註選項正確輸出 p1ma_note，無備註時維持空字串", () => {
  const draft = createRealPriceFilingDraft();
  assert.equal(buildRealPriceGovernmentJson(draft).case_detail.tab1.case_content.p1ma_note, "");
  draft.special.noteMode = "common";
  draft.special.note = COMMON_FILING_NOTE;
  assert.equal(buildRealPriceGovernmentJson(draft).case_detail.tab1.case_content.p1ma_note, "新建案管委會籌組中");
  draft.special.noteMode = "custom";
  draft.special.note = "合成自由備註";
  assert.equal(buildRealPriceGovernmentJson(draft).case_detail.tab1.case_content.p1ma_note, "合成自由備註");
});

test("舊草稿的既有備註載入後保留為自行填寫", () => {
  const legacy = createRealPriceFilingDraft();
  delete legacy.special.noteMode;
  legacy.special.note = "既有合成備註";
  const storage = { getItem: (key) => key === FILING_DRAFT_STORAGE_KEY ? JSON.stringify(legacy) : null };
  const restored = loadRealPriceFilingDraft(storage);
  assert.equal(restored.special.noteMode, "custom");
  assert.equal(restored.special.note, "既有合成備註");
});

test("完整合成案件產生候選 JSON，申報人身分不由代理人資料推斷", () => {
  const draft = completeDraft();
  draft.agent.enabled = true;
  selectSavedFilingAgent(draft, { id: "agent-1", name: "合成代理人", idNumber: "TESTAGT001", phone: "0200000003", address: "臺北市大安區測試路3號" }, codeRows);
  assert.deepEqual(validateRealPriceFiling(draft, codeRows, sectionRows), []);
  const json = buildRealPriceGovernmentJson(draft);
  assert.equal(json.case_master.case_kind, "13");
  assert.equal(json.case_detail.tab1.case_content.agent_entrust2, "2");
  assert.equal(json.case_detail.tab1.case_content.p1ma_date, "1151022");
  assert.equal(json.case_detail.tab1.buyer.length, 1);
  assert.equal(json.case_detail.tab1.seller.length, 1);
  assert.equal("case_land" in json.case_detail.tab1, false);
  assert.equal("case_build" in json.case_detail.tab1, false);
  assert.equal("case_base" in json.case_detail.tab1, false);
});

test("備註清冊只有啟用且段碼符合目前地所時才產生", () => {
  const draft = completeDraft();
  draft.location.officeCode = "AB";
  draft.location.officeName = "建成地政事務所";
  const section = sectionRows.find((row) => row.cityCode === "A" && row.districtCode === "03" && row.officeCode === "AB" && row.code === "0252");
  assert.ok(section);
  draft.lists.land.enabled = true;
  draft.lists.land.items = [{ sectionCode: section.code, sectionName: section.name, number: "0001-0000", numerator: "1", denominator: "1", cityCode: "A", districtCode: "03" }];
  assert.deepEqual(validateRealPriceFiling(draft, codeRows, sectionRows), []);
  const row = buildRealPriceGovernmentJson(draft).case_detail.tab1.case_land[0];
  assert.equal(row.land_x48, "0252");
  assert.equal(row.land_x48c, "中正區-公園段二小段");
  assert.equal(row.land_rightDeno, "1");
  assert.equal(row.land_rightNume, "1");
});

test("完整條件結構維持 Phase 4A 盤點的 154 個純量路徑", () => {
  const draft = completeDraft();
  const section = sectionRows.find((row) => row.cityCode === "A" && row.districtCode === "03" && row.officeCode === "AB" && row.code === "0252");
  draft.parking.hasParking = "yes";
  draft.parking.pricingMode = "1";
  draft.parking.items = [{ type: "1", typeText: "", floor: "B1", price: "", area: "12.5" }];
  draft.lists.land = { enabled: true, items: [{ sectionCode: section.code, sectionName: section.name, number: "0001-0000", numerator: "1", denominator: "1", cityCode: "A", districtCode: "03" }] };
  draft.lists.build = { enabled: true, items: [{ sectionCode: section.code, sectionName: section.name, number: "00001-000", cityCode: "A", districtCode: "03" }] };
  draft.lists.base = { enabled: true, items: [{ sectionCode: section.code, sectionName: section.name, number: "0001-0000", numerator: "1", denominator: "1", cityCode: "A", districtCode: "03" }] };
  const json = buildRealPriceGovernmentJson(draft);
  const scalarCount = Object.keys(json.case_master).length
    + Object.keys(json.case_detail.tab1.case_content).length
    + Object.keys(json.case_detail.tab1.buyer[0]).length
    + Object.keys(json.case_detail.tab1.seller[0]).length
    + Object.keys(json.case_detail.tab1.case_park[0]).length
    + Object.keys(json.case_detail.tab1.case_land[0]).length
    + Object.keys(json.case_detail.tab1.case_build[0]).length
    + Object.keys(json.case_detail.tab1.case_base[0]).length;
  assert.equal(scalarCount, 154);
  assert.equal(json.case_detail.tab1.case_park[0].car_price, "", "未單獨計價時不得殘留車位個別價格");
});

test("候選 ZIP 為根目錄單一同名 JSON，檔名規則包含第一買方證號", () => {
  const draft = completeDraft();
  draft.location.officeCode = "AB";
  draft.location.officeName = "建成地政事務所";
  const now = new Date(2026, 9, 22, 12, 34, 56);
  const basename = createCandidateBasename(draft, now);
  const jsonText = JSON.stringify(buildRealPriceGovernmentJson(draft), null, 2);
  const bytes = createSingleFileZip(`${basename}.json`, jsonText, now);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const nameLength = view.getUint16(26, true);
  const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
  assert.equal(name, `${basename}.json`);
  assert.match(name, /^RPS0401_TESTBUY001_1151022123456\.json$/);
  assert.equal(new TextDecoder().decode(bytes.slice(30 + nameLength, 30 + nameLength + view.getUint32(18, true))), jsonText);
});
