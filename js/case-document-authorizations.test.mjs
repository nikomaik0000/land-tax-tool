import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addBlankBuilding, addBlankLand, addBlankParty, createCaseDocumentState } from "./case-documents-model.js";
import {
  AGENT_STORAGE_KEY,
  buildHouseTaxPreviewData,
  buildRealPricePreviewData,
  buildCaseDocumentFieldMap,
  createAuthorizationDocumentState,
  formatRealPriceAddress,
  getHouseTaxPrincipalCandidates,
  getRealPriceEntrustors,
  getRealPriceLayoutRule,
  loadAgents,
  removeAgent,
  saveAgents,
  syncAuthorizationDefaults,
  upsertAgent,
  validateHouseTaxDocument,
  validateRealPriceDocument,
} from "./case-document-authorizations.js";

function anonymousCase() {
  const state = createCaseDocumentState();
  state.caseInfo.district = "中正區";
  state.caseInfo.registrationReason = "買賣";
  state.caseInfo.reasonDate = "115.09.18";
  addBlankParty(state, { title: "權利人", name: "測試買方", idNumber: "A100000001", address: "臺北市中正區匿名路1號", phoneNote: "02-2000-0001" });
  addBlankParty(state, { title: "義務人", name: "測試賣方", idNumber: "B200000002", birthDate: "70.01.02", address: "臺北市中正區匿名路2號", phoneNote: "02-2000-0002" });
  const building = addBlankBuilding(state);
  Object.assign(building, { buildingNumber: "100-1", address: "臺北市中正區匿名路100號", shareNumerator: "1", shareDenominator: "1" });
  const land = addBlankLand(state);
  Object.assign(land, { district: "中正區", section: "測試", subsection: "一", landNumber: "100-1", shareNumerator: "1", shareDenominator: "2" });
  return state;
}

test("房屋稅籍委任人只取義務人，實價登錄帶入雙方且同角色去重", () => {
  const state = anonymousCase();
  addBlankParty(state, { title: "權利人", name: "重複買方", idNumber: "A100000001" });
  addBlankParty(state, { title: "其他", name: "不適用者", idNumber: "C300000003" });
  assert.deepEqual(getHouseTaxPrincipalCandidates(state).map((item) => item.name), ["測試賣方"]);
  assert.deepEqual(getRealPriceEntrustors(state).map((item) => [item.title, item.name]), [["權利人", "測試買方"], ["義務人", "測試賣方"]]);
});

test("共用欄位映射沿用案件模型，組合土地、建物、縣市、行政區及登記資料", () => {
  const map = buildCaseDocumentFieldMap(anonymousCase());
  assert.equal(map.location.city, "臺北市");
  assert.equal(map.location.district, "中正區");
  assert.match(map.propertyDescription, /^不動產坐落：\n/);
  assert.match(map.propertyDescription, /臺北市中正區測試段一小段100-1地號　持分：1\/2/);
  assert.match(map.propertyDescription, /臺北市中正區匿名路100號　持分：1\/1/);
  assert.deepEqual(map.registration, { reason: "買賣", reasonDate: "115.09.18" });
});

test("土地縣市只使用案件可確認值，無法確認時不猜測並保留提醒", () => {
  const state = anonymousCase();
  state.buildings = [];
  const documents = createAuthorizationDocumentState();
  syncAuthorizationDefaults(state, documents);
  assert.equal(documents.realPrice.city, "");
  assert.match(documents.realPrice.propertyDescription, /中正區測試段一小段100-1地號/);
  assert.doesNotMatch(documents.realPrice.propertyDescription, /臺北市/);
  assert.match(validateRealPriceDocument(state, documents.realPrice).join("\n"), /縣市待填/);
});

test("兩份文件維持獨立代理人設定，房屋稅籍預設項目及單筆建物自動選取", () => {
  const state = anonymousCase();
  const documents = createAuthorizationDocumentState();
  const map = syncAuthorizationDefaults(state, documents);
  assert.equal(documents.houseTax.principalPartyId, map.parties.obligors[0].id);
  assert.deepEqual(documents.houseTax.buildingIds, [map.buildings[0].id]);
  assert.deepEqual(documents.houseTax.applicationItems, ["房屋稅稅籍證明"]);
  assert.equal(documents.realPrice.propertyFontMode, "auto");
  assert.equal(documents.realPrice.propertyFontSize, 12);
  assert.equal(Object.hasOwn(documents.houseTax, "missingFieldsNote"), false);
  assert.equal(Object.hasOwn(documents.realPrice, "missingFieldsNote"), false);
  documents.houseTax.agentId = "agent-a";
  documents.realPrice.agentId = "agent-b";
  assert.notEqual(documents.houseTax.agentId, documents.realPrice.agentId);
});

test("一買一賣使用單頁規則，多人案件改為附表規則", () => {
  const state = anonymousCase();
  assert.deepEqual(getRealPriceLayoutRule(state), { mode: "single-page", label: "2 位委託人：使用官方第一頁主表", requiresAppendix: false, extensionCandidate: false });
  addBlankParty(state, { title: "義務人", name: "第二賣方", idNumber: "D400000004" });
  assert.equal(getRealPriceLayoutRule(state).requiresAppendix, true);
  assert.equal(getRealPriceLayoutRule(state).extensionCandidate, true);
  addBlankParty(state, { title: "權利人", name: "第二買方", idNumber: "E500000005" });
  assert.equal(getRealPriceLayoutRule(state).extensionCandidate, true);
  addBlankParty(state, { title: "義務人", name: "第三賣方", idNumber: "F600000006" });
  assert.equal(getRealPriceLayoutRule(state).extensionCandidate, false);
});

test("實價登錄委託事項只保留申報登錄資訊與全部不勾", () => {
  const state = anonymousCase();
  const documents = createAuthorizationDocumentState();
  syncAuthorizationDefaults(state, documents);
  assert.equal(buildRealPricePreviewData(state, documents.realPrice).matter, "申報登錄資訊");
  documents.realPrice.matter = "";
  assert.equal(buildRealPricePreviewData(state, documents.realPrice).matter, "");
  assert.doesNotMatch(validateRealPriceDocument(state, documents.realPrice).join("\n"), /委託事項待填/);
});

test("本次移轉持分缺漏時不猜測，預覽標示待確認並保留手動修正", () => {
  const state = anonymousCase();
  state.lands[0].shareNumerator = "";
  state.lands[0].shareDenominator = "";
  const documents = createAuthorizationDocumentState();
  syncAuthorizationDefaults(state, documents);
  assert.match(documents.realPrice.propertyDescription, /持分：待確認/);
  assert.match(validateRealPriceDocument(state, documents.realPrice).join("\n"), /本次買賣移轉持分待確認/);
  documents.realPrice.propertyDescription = "不動產坐落：\n臺北市中正區測試段一小段100-1地號　持分：1/3";
  documents.realPrice.propertyDescriptionManual = true;
  syncAuthorizationDefaults(state, documents);
  assert.match(documents.realPrice.propertyDescription, /持分：1\/3/);
  assert.doesNotMatch(validateRealPriceDocument(state, documents.realPrice).join("\n"), /本次買賣移轉持分待確認/);
});

test("代理人名單可在本機儲存、新增、編輯與刪除", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  let agents = upsertAgent([], { name: "測試代理人", idNumber: "Z900000009", phone: "02-2999-9999", address: "測試地址" }, () => "agent-1");
  saveAgents(agents, storage);
  assert.ok(memory.has(AGENT_STORAGE_KEY));
  assert.equal(loadAgents(storage)[0].name, "測試代理人");
  agents = upsertAgent(agents, { ...agents[0], phone: "02-2888-8888" });
  assert.equal(agents[0].phone, "02-2888-8888");
  assert.deepEqual(removeAgent(agents, "agent-1"), []);
});

test("缺漏提醒不再要求電話、稅務局、更正期間或日期", () => {
  const state = anonymousCase();
  const documents = createAuthorizationDocumentState();
  syncAuthorizationDefaults(state, documents);
  assert.deepEqual(validateHouseTaxDocument(state, documents.houseTax), ["請選擇或輸入代理人", "代理人身分證統一編號缺漏"]);
  assert.deepEqual(validateRealPriceDocument(state, documents.realPrice), ["請選擇或輸入受託人", "受託人身分證統一編號缺漏", "受託人通訊地址缺漏"]);
});

test("兩份填寫資料預覽沿用同一文件狀態，房屋稅籍只含所選義務人，實價登錄含全體適用當事人", () => {
  const state = anonymousCase();
  addBlankParty(state, { title: "義務人", name: "第二賣方", idNumber: "D400000004", address: "測試地址", phoneNote: "02-2000-0004" });
  const documents = createAuthorizationDocumentState();
  const map = syncAuthorizationDefaults(state, documents);
  documents.houseTax.principalPartyId = map.parties.obligors[1].id;
  documents.houseTax.agentMode = "manual";
  documents.houseTax.manualAgent = { id: "", name: "房屋代理人", idNumber: "Y800000008", phone: "02-2888-8888", address: "代理地址" };
  documents.realPrice.agentMode = "manual";
  documents.realPrice.manualAgent = { id: "", name: "實價受託人", idNumber: "Z900000009", phone: "02-2999-9999", address: "受託地址" };

  const housePreview = buildHouseTaxPreviewData(state, documents.houseTax);
  assert.equal(housePreview.principal.name, "第二賣方");
  assert.equal(housePreview.buildings.length, 1);
  assert.deepEqual(housePreview.applicationItems, ["房屋稅稅籍證明"]);
  assert.equal(housePreview.agent.name, "房屋代理人");
  assert.ok(!JSON.stringify(housePreview).includes("測試買方"));
  assert.ok(!JSON.stringify(housePreview).includes("測試賣方"));

  const realPreview = buildRealPricePreviewData(state, documents.realPrice);
  assert.deepEqual(realPreview.entrustors.map((item) => item.name), ["測試買方", "測試賣方", "第二賣方"]);
  assert.equal(realPreview.agent.name, "實價受託人");
  assert.equal(realPreview.propertyFontMode, "auto");
  assert.equal(realPreview.propertyFontSize, 12);
  assert.equal(realPreview.matter, "申報登錄資訊");
  assert.equal(realPreview.layoutRule.requiresAppendix, true);
});

test("實價登錄地址只移除里鄰且不修改案件原始地址", () => {
  const state = anonymousCase();
  state.parties[0].address = "臺北市大同區民權里12鄰延平北路一段1巷2弄3號4樓";
  const originalAddress = state.parties[0].address;
  const documents = createAuthorizationDocumentState();
  documents.realPrice.agentMode = "manual";
  documents.realPrice.manualAgent.address = "臺中市大里區大里路1號";
  syncAuthorizationDefaults(state, documents);

  const preview = buildRealPricePreviewData(state, documents.realPrice);
  assert.equal(preview.entrustors[0].address, "臺北市大同區延平北路一段1巷2弄3號4樓");
  assert.equal(preview.agent.address, "臺中市大里區大里路1號");
  assert.equal(state.parties[0].address, originalAddress);
  assert.equal(formatRealPriceAddress("屏東縣里港鄉里港路1號"), "屏東縣里港鄉里港路1號");
});

test("Phase 3B-1 介面保留 Phase 3A 設定並只新增房屋稅籍正式 PDF 操作", () => {
  const html = readFileSync(new URL("../case-documents.html", import.meta.url), "utf8");
  assert.match(html, /id="agentForm"/);
  assert.match(html, /id="houseTaxPrincipal"/);
  assert.match(html, /id="realPriceEntrustors"/);
  assert.match(html, /id="houseTaxDataPreview"/);
  assert.match(html, /id="realPriceDataPreview"/);
  assert.match(html, /房屋稅稅籍證明/);
  assert.match(html, /保留委任人、代理人簽章/);
  assert.match(html, /多人案件依官方原版使用附表/);
  assert.match(html, /id="downloadHouseTaxPdf"/);
  assert.match(html, /id="printHouseTaxPdf"/);
  assert.match(html, /id="houseTaxOfficialPreview"/);
  assert.doesNotMatch(html, /id="houseTaxBureau"|id="houseTaxDate"|id="realPriceCorrection"|id="realPriceDate"/);
  assert.match(html, /<option value="">全部不勾<\/option>/);
  assert.match(html, /id="downloadRealPricePdf"/);
  assert.match(html, /id="printRealPricePdf"/);
  assert.match(html, /id="realPriceOfficialPreview"/);
  assert.match(html, /data-case-tab="card">案件資料卡/);
  assert.match(html, /data-case-tab="house">房屋稅籍/);
  assert.match(html, /data-case-tab="real">實價登錄/);
  assert.equal((html.match(/id="agentForm"/g) || []).length, 1);
});
