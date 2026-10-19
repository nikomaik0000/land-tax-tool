import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addBlankParty,
  addBlankLand,
  addBuildingFromParsed,
  addLandFromParsed,
  createCaseDocumentState,
  formatBuildingNumberDisplay,
  formatRocDate,
  getProgressGroups,
  getRenderableParties,
  mergeSpans,
  reconcilePartyShareVisibility,
  renderCaseCard,
  shouldShowCommonPartRelation,
} from "./case-documents-model.js";
import { parseWangBuildingExport, parseWangLandExport } from "./wang-case-parser.js";

test("案件類型進度規則維持不變，空白日期仍保留八個格位", () => {
  const state = createCaseDocumentState();
  assert.deepEqual(getProgressGroups("sale").map((group) => group.items.length), [4, 4]);
  assert.equal(getProgressGroups("inheritance")[0].items.length, 6);
  state.caseInfo.caseType = "sale";
  const html = renderCaseCard(state);
  assert.match(html, /土地增值稅/);
  assert.match(html, /契稅/);
  assert.equal((html.match(/class="tax-progress-item"/g) || []).length, 8);
  assert.doesNotMatch(html, /CASE FILE|case-card-kicker/);
  assert.match(html, /<h2>案件資料卡<\/h2>/);
});

test("日期統一為民國格式，登記原因只自動對照已確認的 21 與 25", () => {
  assert.equal(formatRocDate("750312"), "75.03.12");
  assert.equal(formatRocDate("1141205"), "114.12.05");
  assert.equal(formatRocDate("11412"), "114.12");
  assert.equal(formatRocDate("20251205"), "114.12.05");
  assert.equal(formatRocDate("不明日期"), "不明日期");

  const state = createCaseDocumentState();
  addLandFromParsed(state, parseWangLandExport("LOC_NM=大同區玉泉一03261000\nTRAN_REAS=21\nTRD_DATE=1141205\nPRES=0"));
  assert.equal(state.caseInfo.registrationReason, "買賣");
  assert.equal(state.caseInfo.caseType, "sale");
  assert.equal(state.caseInfo.reasonDate, "114.12.05");
  assert.equal(state.caseInfo.reasonDateRaw, "1141205");
  assert.doesNotMatch(renderCaseCard(state), /案件類型/);

  const gift = createCaseDocumentState();
  addLandFromParsed(gift, parseWangLandExport("LOC_NM=大同區玉泉一03261000\nTRAN_REAS=25\nPRES=0"));
  assert.equal(gift.caseInfo.registrationReasonCode, "25");
  assert.equal(gift.caseInfo.registrationReason, "贈與");
  assert.equal(gift.caseInfo.caseType, "gift");
  assert.match(renderCaseCard(gift), /土地增值稅/);
  assert.match(renderCaseCard(gift), /契稅/);
});

test("土地與建物行政區一致時自動帶入，不一致時留空待人工確認", () => {
  const consistent = createCaseDocumentState();
  addLandFromParsed(consistent, parseWangLandExport("LOC_NM=大同區玉泉一03261000\nPRES=0"));
  addBuildingFromParsed(consistent, parseWangBuildingExport("HOU_LOC=台北市大同區延平北路一段1號\nMAIN_BUILD_NO=03261000\nHOU_FLOORs=0\nPUB_FACs=0\nN_HOLDERS=0\nO_HOLDERS=0"));
  assert.equal(consistent.caseInfo.district, "大同區");
  assert.equal(consistent.buildings[0].address, "台北市大同區延平北路一段1號");
  assert.match(renderCaseCard(consistent), /延平北路一段1號/);
  assert.doesNotMatch(renderCaseCard(consistent), /台北市大同區延平北路/);

  const conflict = createCaseDocumentState();
  addLandFromParsed(conflict, parseWangLandExport("LOC_NM=大同區玉泉一03261000\nPRES=0"));
  addBuildingFromParsed(conflict, parseWangBuildingExport("HOU_LOC=台北市中山區中山北路1號\nMAIN_BUILD_NO=03261000\nHOU_FLOORs=0\nPUB_FACs=0\nN_HOLDERS=0\nO_HOLDERS=0"));
  assert.equal(conflict.caseInfo.district, "");
  assert.ok(conflict.notices.includes("土地與建物行政區不一致，請手動確認"));
});

test("同一人跨土地與建物依證號及角色去重，標的持分仍逐筆保存", () => {
  const state = createCaseDocumentState();
  const land = (number, oldShare, newShare) => parseWangLandExport([
    `LOC_NM=大同區玉泉一${number}`, "TRAN_REAS=21", "PRES=0",
    "O_HOLDERS=1", "OIDN_BAN_1=A111", "OIDN_NM_1=義務甲", `O_HOLDER_TRAN_NMRT_1=${oldShare}`, "O_HOLDER_TRAN_DNT_1=4",
    "N_HOLDERS=1", "NIDN_BAN_1=B222", "NIDN_NM_1=權利乙", `N_HOLDER_TRAN_NMRT_1=${newShare}`, "N_HOLDER_TRAN_DNT_1=4",
  ].join("\n"));
  const building = parseWangBuildingExport([
    "MAIN_BUILD_NO=03261000", "HOU_FLOORs=1", "HOU_FLOOR_NO_1=三層", "HOU_AREA_1=80", "PUB_FACs=0",
    "O_HOLDERS=1", "O_HOLDER_IDN_BAN_1=A111", "O_HOLDER_NM_1=義務甲", "O_HOLDER_TRAN_NMRT_1=1", "O_HOLDER_TRAN_DNT_1=1000",
    "N_HOLDERS=1", "N_HOLDER_IDN_BAN_1=B222", "N_HOLDER_NM_1=權利乙", "N_HOLDER_TRAN_NMRT_1=2", "N_HOLDER_TRAN_DNT_1=1000",
  ].join("\n"));
  addLandFromParsed(state, land("07900000", 1, 2));
  addLandFromParsed(state, land("08000000", 2, 1));
  addBuildingFromParsed(state, building);

  assert.equal(state.parties.length, 2);
  assert.deepEqual(state.parties.map((item) => item.title), ["義務人", "權利人"]);
  assert.deepEqual(state.parties.map((item) => item.interests.length), [3, 3]);
  assert.deepEqual(state.parties.map((item) => item.originalSources.length), [3, 3]);
  assert.match(state.parties[0].share, /土790：1\/4/);
  assert.match(state.parties[0].share, /土800：2\/4/);
  assert.match(state.parties[0].share, /建：1\/1000/);
  assert.match(state.parties[1].share, /土790：2\/4/);
  assert.match(state.parties[1].share, /土800：1\/4/);
  assert.match(state.parties[1].share, /建：2\/1000/);
  assert.equal(state.partySettings.showShare, false);
  assert.equal((renderCaseCard(state).match(/<tr>/g) || []).length > 2, true);
});

test("相同姓名不同證號不合併；缺證號也不只依姓名強制合併", () => {
  const differentIds = createCaseDocumentState();
  addLandFromParsed(differentIds, parseWangLandExport([
    "LOC_NM=大同區玉泉一00790000", "TRAN_REAS=21", "PRES=0", "O_HOLDERS=0", "N_HOLDERS=2",
    "NIDN_NM_1=同名者", "NIDN_BAN_1=A111", "NIDN_NM_2=同名者", "NIDN_BAN_2=B222",
  ].join("\n")));
  assert.equal(differentIds.parties.length, 2);
  assert.deepEqual(differentIds.parties.map((item) => item.idNumber), ["A111", "B222"]);

  const missingIds = createCaseDocumentState();
  const source = "LOC_NM=大同區玉泉一00790000\nTRAN_REAS=21\nPRES=0\nO_HOLDERS=0\nN_HOLDERS=1\nNIDN_NM_1=缺證者";
  addLandFromParsed(missingIds, parseWangLandExport(source));
  addLandFromParsed(missingIds, parseWangLandExport(source.replace("00790000", "00800000")));
  assert.equal(missingIds.parties.length, 2);
  assert.ok(missingIds.parties.every((item) => item.identityNeedsConfirmation));

  const conflict = createCaseDocumentState();
  addLandFromParsed(conflict, parseWangLandExport("LOC_NM=大同區玉泉一07900000\nTRAN_REAS=21\nPRES=0\nO_HOLDERS=0\nN_HOLDERS=1\nNIDN_NM_1=甲名\nNIDN_BAN_1=A111"));
  addLandFromParsed(conflict, parseWangLandExport("LOC_NM=大同區玉泉一08000000\nTRAN_REAS=21\nPRES=0\nO_HOLDERS=0\nN_HOLDERS=1\nNIDN_NM_1=乙名\nNIDN_BAN_1=A111"));
  assert.equal(conflict.parties.length, 1);
  assert.equal(conflict.parties[0].identityConflict, true);
  assert.equal(conflict.parties[0].originalSources.length, 2);
});

test("當事人相鄰稱謂合併，持分欄可隱藏且資料不刪除", () => {
  const state = createCaseDocumentState();
  addBlankParty(state, { title: "權利人", name: "甲", share: "土：1/2" });
  addBlankParty(state, { title: "權利人", name: "乙", share: "建：1/2" });
  addBlankParty(state, { title: "義務人", name: "丙" });
  assert.deepEqual(mergeSpans(state.parties, (item) => item.title), [2, 0, 1]);
  let html = renderCaseCard(state);
  assert.match(html, /rowspan="2">權利人/);
  assert.match(html, />持分</);
  state.partySettings.showShare = false;
  html = renderCaseCard(state);
  assert.doesNotMatch(html, />持分</);
  assert.equal(state.parties[0].share, "土：1/2");
});

test("買賣一權利人一義務人自動隱藏持分，任一方多人時自動顯示", () => {
  const state = createCaseDocumentState();
  state.caseInfo.caseType = "sale";
  addBlankParty(state, { title: "權利人", name: "甲", idNumber: "A1" });
  addBlankParty(state, { title: "義務人", name: "乙", idNumber: "B1" });
  reconcilePartyShareVisibility(state);
  assert.equal(state.partySettings.showShare, false);
  assert.doesNotMatch(renderCaseCard(state), /<th>持分<\/th>/);

  addBlankParty(state, { title: "權利人", name: "丙", idNumber: "C1" });
  reconcilePartyShareVisibility(state);
  assert.equal(state.partySettings.showShare, true);
  assert.match(renderCaseCard(state), /<th>持分<\/th>/);

  state.partySettings.shareVisibilityMode = "manual";
  state.partySettings.showShare = false;
  reconcilePartyShareVisibility(state);
  assert.equal(state.partySettings.showShare, false);
});

test("設定案件可合併債務人／義務人顯示，資料模型仍保留兩筆角色", () => {
  const state = createCaseDocumentState();
  state.caseInfo.caseType = "mortgage";
  state.partySettings.mergeDebtorAndObligor = true;
  addBlankParty(state, { title: "債務人", name: "甲", idNumber: "A123" });
  addBlankParty(state, { title: "義務人", name: "甲", idNumber: "A123" });
  assert.equal(state.parties.length, 2);
  assert.equal(getRenderableParties(state).length, 1);
  assert.equal(getRenderableParties(state)[0].title, "債務人／義務人");
  assert.match(renderCaseCard(state), /債務人／義務人/);
});

test("買賣 OIDN 對應義務人、NIDN 對應權利人，且同角色多人合併稱謂格", () => {
  const state = createCaseDocumentState();
  addLandFromParsed(state, parseWangLandExport([
    "LOC_NM=大同區玉泉一00790000", "TRAN_REAS=21", "PRES=0", "O_HOLDERS=1",
    "OIDN_NM_1=義務甲", "OIDN_BAN_1=A1", "N_HOLDERS=2",
    "NIDN_NM_1=權利乙", "NIDN_BAN_1=B1", "NIDN_NM_2=權利丙", "NIDN_BAN_2=C1",
  ].join("\n")));
  assert.deepEqual(state.parties.map((item) => item.title), ["義務人", "權利人", "權利人"]);
  const html = renderCaseCard(state);
  assert.ok(html.indexOf("權利乙") < html.indexOf("義務甲"));
  assert.match(html, /rowspan="2">權利人/);
});

test("建號只在已確認的四碼主副號規則下簡化顯示", () => {
  assert.equal(formatBuildingNumberDisplay("326-1000"), "326-1");
  assert.equal(formatBuildingNumberDisplay("03271000"), "327-1");
  assert.equal(formatBuildingNumberDisplay("332-8000"), "332-8");
  assert.equal(formatBuildingNumberDisplay("332-9000"), "332-9");
  assert.equal(formatBuildingNumberDisplay("332-8123"), "332-8123");
  assert.equal(formatBuildingNumberDisplay("特殊建號"), "特殊建號");
});

test("可靠分類的多筆附屬建物依用途與面積配對顯示，原始值分開保存", () => {
  const state = createCaseDocumentState();
  addBuildingFromParsed(state, parseWangBuildingExport([
    "HOU_LOC=台北市大同區測試路1號", "MAIN_BUILD_NO=03261000", "HOU_FLOORs=3",
    "HOU_FLOOR_NO_1=九層", "HOU_AREA_1=88.8", "HOU_FLOOR_NO_2=陽臺", "HOU_AREA_2=11.21",
    "HOU_FLOOR_NO_3=雨遮", "HOU_AREA_3=5.75", "PUB_FACs=0", "N_HOLDERS=0", "O_HOLDERS=0",
  ].join("\n")));
  assert.deepEqual(state.buildings[0].accessories, [{ use: "陽臺", area: "11.21" }, { use: "雨遮", area: "5.75" }]);
  assert.equal(state.buildings[0].accessoryText, "陽臺 11.21、雨遮 5.75");
  assert.equal(state.buildings[0].original.floorDetails.length, 3);
  assert.match(renderCaseCard(state), /陽臺 11.21、雨遮 5.75/);

  const ambiguous = createCaseDocumentState();
  addBuildingFromParsed(ambiguous, parseWangBuildingExport("MAIN_BUILD_NO=03261000\nHOU_FLOORs=2\nHOU_FLOOR_NO_1=九層\nHOU_AREA_1=88\nHOU_FLOOR_NO_2=平台\nHOU_AREA_2=6\nPUB_FACs=0\nN_HOLDERS=0\nO_HOLDERS=0"));
  assert.equal(ambiguous.buildings[0].area, "");
  assert.equal(ambiguous.buildings[0].accessoryText, "");
  assert.equal(ambiguous.buildings[0].detailMappingNeedsConfirmation, true);
});

test("同公設建號但不同主建號持分保留四筆，正式資料卡顯示對應主建號", () => {
  const state = createCaseDocumentState();
  const addBuilding = (main, firstShare, secondShare) => addBuildingFromParsed(state, parseWangBuildingExport([
    `MAIN_BUILD_NO=${main}`, "HOU_FLOORs=1", "HOU_FLOOR_NO_1=三層", "HOU_AREA_1=80", "PUB_FACs=2",
    "PUB_FAC_CNSTRT_NO_1=03328000", "PUB_FAC_AREA_1=100", `PUB_FAC_SHR_NMRT_1=${firstShare}`, "PUB_FAC_SHR_DNT_1=10000",
    "PUB_FAC_CNSTRT_NO_2=03329000", "PUB_FAC_AREA_2=200", `PUB_FAC_SHR_NMRT_2=${secondShare}`, "PUB_FAC_SHR_DNT_2=10000",
    "N_HOLDERS=0", "O_HOLDERS=0",
  ].join("\n")));
  addBuilding("03261000", 10, 20);
  addBuilding("03271000", 11, 21);
  assert.equal(state.commonParts.length, 4);
  assert.equal(shouldShowCommonPartRelation(state.commonParts), true);
  const html = renderCaseCard(state);
  assert.match(html, /對應主建號/);
  assert.match(html, /326-1/);
  assert.match(html, /327-1/);
  assert.equal((html.match(/rowspan="2">(?:326-1|327-1)<\/td>/g) || []).length, 2);
  assert.equal((html.match(/class="card-nowrap"/g) || []).length >= 4, true);
});

test("前次移轉格式逐筆對應，空白及待確認提示不輸出到正式資料卡", () => {
  const state = createCaseDocumentState();
  addLandFromParsed(state, parseWangLandExport([
    "LOC_NM=大同區玉泉一03261000", "TRAN_REAS=99", "TRAN_PRC=", "PRES=1",
    "PRE_1=TEST_03261000_11412_490874_1_2",
  ].join("\n")));
  const html = renderCaseCard(state);
  assert.match(html, /日期：114.12　金額：490,874/);
  assert.doesNotMatch(html, /\|/);
  assert.doesNotMatch(html, /待確認/);
  assert.doesNotMatch(html, />0</);
});

test("正式順序為稅務進度後接當事人，並顯示公告現值單位", () => {
  const state = createCaseDocumentState();
  state.caseInfo.caseType = "sale";
  addBlankParty(state, { title: "權利人", name: "甲" });
  addBlankLand(state);
  const html = renderCaseCard(state);
  assert.ok(html.indexOf("稅務進度") < html.indexOf("當事人"));
  assert.match(html, /公告現值<br>（元／㎡）/);
});

test("總層數不以明細筆數推算，手動填寫後才輸出", () => {
  const state = createCaseDocumentState();
  addBuildingFromParsed(state, parseWangBuildingExport([
    "MAIN_BUILD_NO=03261000", "HOU_FLOORs=2", "HOU_FLOOR_NO_1=九層", "HOU_AREA_1=80",
    "HOU_FLOOR_NO_2=陽臺", "HOU_AREA_2=8", "PUB_FACs=0", "O_HOLDERS=0", "N_HOLDERS=0",
  ].join("\n")));
  assert.equal(state.buildingMeta.totalFloors, "");
  assert.match(renderCaseCard(state), /總層數：<\/span>/);
  state.buildingMeta.totalFloors = "12";
  assert.match(renderCaseCard(state), /總層數：12/);
});

test("當事人表格使用 A4 可用寬度與自然欄寬，不固定百分比", () => {
  const css = readFileSync(new URL("../css/case-documents.css", import.meta.url), "utf8");
  assert.match(css, /\.party-card-table \{ width: 100%; table-layout: auto;/);
  const partyRules = css.slice(css.indexOf(".party-card-table"), css.indexOf(".land-card-table"));
  assert.doesNotMatch(partyRules, /nth-child[^}]*width:\s*\d+%/s);
  assert.match(partyRules, /card-address[^}]*min-width:/s);
});

test("現有土地建物欄位解析不退化，空白房屋現值與稅籍編號仍為空白", () => {
  const state = createCaseDocumentState();
  addLandFromParsed(state, parseWangLandExport("LOC_NM=測試區青田一01234000\nTRAN_AREA=9.66\nTRAN_PRC=\nPRES=0"));
  addBuildingFromParsed(state, parseWangBuildingExport([
    "HOU_LOC=測試市測試區測試路1號", "MAIN_BUILD_NO=05678000", "SEC_CHI_NM=青田", "SSC_CHI_NM=一",
    "HOU_LOSN=", "TRAN_PRC=", "PUB_FACs=2", "PUB_FAC_CNSTRT_NO_1=00001000", "PUB_FAC_AREA_1=100",
    "PUB_FAC_SHR_NMRT_1=1", "PUB_FAC_SHR_DNT_1=10", "PUB_FAC_CNSTRT_NO_2=00002000", "PUB_FAC_AREA_2=200",
    "PUB_FAC_SHR_NMRT_2=2", "PUB_FAC_SHR_DNT_2=10", "HOU_FLOORs=1", "HOU_FLOOR_NO_1=三層",
    "STRUC_CD_1=鋼筋混凝土造", "HOU_AREA_1=88.8", "N_HOLDERS=0", "O_HOLDERS=0",
  ].join("\n")));
  assert.equal(state.lands[0].section, "青田");
  assert.equal(state.lands[0].subsection, "一");
  assert.equal(state.lands[0].totalCurrentValue, "");
  assert.equal(state.buildings[0].currentValue, "");
  assert.equal(state.buildings[0].taxNumber, "");
  assert.equal(state.commonParts.length, 2);
  assert.equal(shouldShowCommonPartRelation(state.commonParts), false);
});

test("沒有標的時不輸出空白土地建物區塊，單一類型只輸出實際標的", () => {
  const empty = createCaseDocumentState();
  assert.doesNotMatch(renderCaseCard(empty), /<h3>土地<\/h3>|<h3>建物<\/h3>|共有部分/);

  const landOnly = createCaseDocumentState();
  addLandFromParsed(landOnly, parseWangLandExport("LOC_NM=大同區玉泉一07900000\nTRAN_AREA=10\nPRES=0\nO_HOLDERS=0\nN_HOLDERS=0"));
  const landHtml = renderCaseCard(landOnly);
  assert.match(landHtml, /<h3>土地<\/h3>/);
  assert.doesNotMatch(landHtml, /<h3>建物<\/h3>|共有部分/);

  const buildingOnly = createCaseDocumentState();
  addBuildingFromParsed(buildingOnly, parseWangBuildingExport("MAIN_BUILD_NO=03261000\nHOU_FLOORs=1\nHOU_FLOOR_NO_1=三層\nHOU_AREA_1=80\nPUB_FACs=0\nO_HOLDERS=0\nN_HOLDERS=0"));
  const buildingHtml = renderCaseCard(buildingOnly);
  assert.doesNotMatch(buildingHtml, /<h3>土地<\/h3>|共有部分/);
  assert.match(buildingHtml, /<h3>建物<\/h3>[\s\S]*建材：[\s\S]*總層數：[\s\S]*building-card-table/);
});

test("土地 CSV 可獨立解析區域、段、小段、地號", () => {
  const state = createCaseDocumentState();
  addLandFromParsed(state, parseWangLandExport("LOC_NM=大同區玉泉一07900000\nTRAN_AREA=10\nPRES=0\nO_HOLDERS=0\nN_HOLDERS=0"));
  assert.equal(state.caseInfo.district, "大同區");
  assert.equal(state.lands[0].section, "玉泉");
  assert.equal(state.lands[0].subsection, "一");
  assert.equal(state.lands[0].landNumber, "790");
  assert.equal(state.lands[0].locationNeedsConfirmation, false);

  const marked = createCaseDocumentState();
  addLandFromParsed(marked, parseWangLandExport("LOC_NM=測試區青田段二小段01234000\nTRAN_AREA=10\nPRES=0\nO_HOLDERS=0\nN_HOLDERS=0"));
  assert.equal(marked.lands[0].section, "青田");
  assert.equal(marked.lands[0].subsection, "二");
  assert.equal(marked.lands[0].landNumber, "123-4000");
});

test("土地與建物當事人地址皆優先通訊地址，空白時回退戶籍地址，空白來源不覆蓋既有地址", () => {
  const landOnly = createCaseDocumentState();
  addLandFromParsed(landOnly, parseWangLandExport([
    "LOC_NM=大同區玉泉一07900000", "PRES=0", "O_HOLDERS=1", "OIDN_BAN_1=A1", "OIDN_NM_1=甲",
    "O_HOLDER_CADDR_1=通訊地址", "O_HOLDER_HADDR_1=戶籍地址", "N_HOLDERS=0",
  ].join("\n")));
  assert.equal(landOnly.parties[0].address, "通訊地址");
  assert.equal(landOnly.parties[0].originalSources[0].homeAddress, "戶籍地址");
  assert.equal(landOnly.parties[0].originalSources[0].contactAddress, "通訊地址");

  const buildingOnly = createCaseDocumentState();
  addBuildingFromParsed(buildingOnly, parseWangBuildingExport([
    "MAIN_BUILD_NO=03261000", "HOU_FLOORs=0", "PUB_FACs=0", "O_HOLDERS=1", "O_HOLDER_IDN_BAN_1=A1",
    "O_HOLDER_NM_1=甲", "O_HOLDER_CADDR_1=", "O_HOLDER_HADDR_1=建物戶籍地址", "N_HOLDERS=0",
  ].join("\n")));
  assert.equal(buildingOnly.parties[0].address, "建物戶籍地址");

  addBuildingFromParsed(landOnly, parseWangBuildingExport([
    "MAIN_BUILD_NO=03261000", "HOU_FLOORs=0", "PUB_FACs=0", "O_HOLDERS=1", "O_HOLDER_IDN_BAN_1=A1",
    "O_HOLDER_NM_1=甲", "O_HOLDER_CADDR_1=", "O_HOLDER_HADDR_1=", "N_HOLDERS=0",
  ].join("\n")));
  assert.equal(landOnly.parties.length, 1);
  assert.equal(landOnly.parties[0].address, "通訊地址");
});
