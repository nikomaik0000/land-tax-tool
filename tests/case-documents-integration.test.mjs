import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCaseDocumentsData, normalizeCaseDocumentsData } from "../js/case-documents-case-file.js";
import { buildCaseFile, parseCaseFile } from "../js/case-file.js";
import {
  addAuthorizationAgentSnapshots,
  createAuthorizationDocumentState,
  loadAgents,
  restoreAuthorizationAgentSnapshots,
  saveAgents,
} from "../js/case-document-authorizations.js";
import { addBlankBuilding, addBlankParty, createCaseDocumentState } from "../js/case-documents-model.js";
import {
  buildRealPriceGovernmentJson,
  createRealPriceFilingDraft,
  parseGovernmentCodeCsv,
  selectSavedFilingAgent,
  validateRealPriceFiling,
} from "../js/real-price-filing.js";

const codeCsv = await readFile(new URL("../material/real-price-government-codes-20230218.csv", import.meta.url), "utf8");
const codeRows = parseGovernmentCodeCsv(codeCsv);

function memoryStorage(initial = new Map()) {
  return { getItem: (key) => initial.get(key) ?? null, setItem: (key, value) => initial.set(key, value), removeItem: (key) => initial.delete(key) };
}

test("舊常用代理人缺少 Email 時安全載入，新資料會一併保存 Email", () => {
  const memory = new Map([["land-tax-tool:frequent-agents:v1", JSON.stringify([{ id: "old", name: "舊代理人" }])]]);
  const storage = memoryStorage(memory);
  assert.equal(loadAgents(storage)[0].email, "");
  saveAgents([{ id: "new", name: "合成代理人", email: "agent@example.test" }], storage);
  assert.equal(loadAgents(storage)[0].email, "agent@example.test");
});

test("常用代理人 Email 複製到申報資料，案件內修改不回寫來源", () => {
  const source = { id: "agent-1", name: "合成代理人", idNumber: "TESTAGT001", phone: "0200000000", email: "agent@example.test", address: "臺北市中正區測試路1號" };
  const draft = createRealPriceFilingDraft();
  draft.agent.enabled = true;
  selectSavedFilingAgent(draft, source, codeRows);
  assert.equal(buildRealPriceGovernmentJson(draft).case_detail.tab1.case_content.agents_mail, "agent@example.test");
  draft.agent.email = "case-only@example.test";
  assert.equal(source.email, "agent@example.test");
  draft.agent.email = "格式錯誤";
  assert.ok(validateRealPriceFiling(draft, codeRows, []).some((issue) => issue.message.includes("Email 格式不正確") && issue.severity === "error"));
  draft.agent.email = "";
  assert.ok(!validateRealPriceFiling(draft, codeRows, []).some((issue) => issue.message.includes("Email 格式")));
});

test("整合案件檔往返保存三個子分頁與政府申報狀態", () => {
  const caseState = createCaseDocumentState();
  caseState.caseInfo.caseNumber = "SYNTHETIC-001";
  addBlankParty(caseState, { title: "權利人", name: "合成買方" });
  addBlankBuilding(caseState).buildingNumber = "00001-000";
  const documents = createAuthorizationDocumentState();
  documents.houseTax.principalPartyId = "party-1";
  documents.realPrice.propertyDescription = "合成標的";
  documents.realPrice.propertyDescriptionManual = true;
  const filing = createRealPriceFilingDraft();
  filing.transaction.contractDate = "1151022";
  filing.transaction.totalPrice = "12345678";
  filing.agent.email = "case@example.test";

  const restored = normalizeCaseDocumentsData(buildCaseDocumentsData(caseState, documents, filing));
  assert.equal(restored.caseState.caseInfo.caseNumber, "SYNTHETIC-001");
  assert.equal(restored.caseState.parties.length, 1);
  assert.equal(restored.authorizationDocuments.realPrice.propertyDescription, "合成標的");
  assert.equal(restored.realPriceFiling.transaction.totalPrice, "12345678");
  assert.equal(restored.realPriceFiling.agent.email, "case@example.test");
  const file = buildCaseFile("case-documents", buildCaseDocumentsData(caseState, documents, filing), "2026-10-22T00:00:00.000Z");
  assert.equal(parseCaseFile(JSON.stringify(file), "case-documents").data.schemaVersion, 1);
});

test("案件檔保存所選常用代理人快照，異機缺少名單時改為案件內手動資料", () => {
  const documents = createAuthorizationDocumentState();
  documents.houseTax.agentId = "agent-1";
  const agents = [{ id: "agent-1", name: "合成代理人", idNumber: "TESTAGT001", phone: "0200000000", email: "agent@example.test", address: "合成地址" }];
  const saved = addAuthorizationAgentSnapshots(documents, agents);
  const restored = restoreAuthorizationAgentSnapshots(saved, []);
  assert.equal(restored.houseTax.agentMode, "manual");
  assert.equal(restored.houseTax.manualAgent.name, "合成代理人");
  assert.equal(restored.houseTax.manualAgent.email, "agent@example.test");
});

test("舊式案件內容缺少文件欄位時使用安全預設值", () => {
  const restored = normalizeCaseDocumentsData({ caseInfo: { caseNumber: "LEGACY-001" }, parties: [] });
  assert.equal(restored.caseState.caseInfo.caseNumber, "LEGACY-001");
  assert.deepEqual(restored.authorizationDocuments.houseTax.applicationItems, ["房屋稅稅籍證明"]);
  assert.equal(restored.realPriceFiling.applicantKind, "16");
});

test("介面只有一組共用案件工具列，並提供常用代理人 Email", async () => {
  const html = await readFile(new URL("../case-documents.html", import.meta.url), "utf8");
  assert.equal((html.match(/id="saveCaseDocuments"/g) || []).length, 1);
  assert.equal((html.match(/id="importCaseDocuments"/g) || []).length, 1);
  assert.equal((html.match(/id="clearCaseDocuments"/g) || []).length, 1);
  assert.match(html, /id="agentEmail" type="email"/);
});
