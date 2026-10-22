import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  buildRealPriceGovernmentJson,
  createCandidateBasename,
  createRealPriceFilingDraft,
  createSingleFileZip,
  parseGovernmentCodeCsv,
  selectSavedFilingAgent,
  syncRealPriceFilingFromCase,
  validateRealPriceFiling,
} from "../js/real-price-filing.js";

const codeRows = parseGovernmentCodeCsv(await readFile(new URL("../material/real-price-government-codes-20230218.csv", import.meta.url), "utf8"));
const sectionRows = JSON.parse(await readFile(new URL("../material/real-price-section-codes-20261022.json", import.meta.url), "utf8")).sections;
const draft = createRealPriceFilingDraft();
const syntheticCase = {
  caseInfo: { district: "中正區" },
  parties: [
    { id: "buyer-1", title: "權利人", name: "合成買方甲", idNumber: "TESTBUY001", phoneNote: "0200000001", address: "臺北市中正區測試路1號" },
    { id: "seller-1", title: "義務人", name: "合成賣方乙", idNumber: "TESTSEL001", phoneNote: "0200000002", address: "臺北市中正區測試路2號" },
  ],
  lands: [{ id: "land-1", locationRaw: "臺北市中正區公園段二小段00010000", section: "公園", subsection: "二", landNumber: "0001-0000", shareNumerator: "1", shareDenominator: "1" }],
  buildings: [],
};

syncRealPriceFilingFromCase(draft, syntheticCase, codeRows);
Object.assign(draft.location, { officeCode: "AB", officeName: "建成地政事務所" });
draft.applicantKind = "13";
draft.transaction = { propertyType: "normal", contractDate: "1151022", totalPrice: "12345678" };
draft.building = { rooms: "2", halls: "1", bathrooms: "1", noPartitions: false, management: "0", elevator: "1" };
draft.parking.hasParking = "yes";
draft.parking.pricingMode = "0";
draft.parking.totalPrice = "1000000";
draft.parking.items = [{ type: "1", typeText: "", floor: "B1", price: "1000000", area: "12.5" }];
draft.agent.enabled = true;
selectSavedFilingAgent(draft, { id: "agent-1", name: "合成代理人丙", idNumber: "TESTAGT001", phone: "0200000003", address: "臺北市大安區測試路3號" }, codeRows);
draft.agent.email = "synthetic@example.invalid";
draft.special.p1sp_code0201 = true;
draft.special.noteMode = "custom";
draft.special.note = "完全合成之匿名 Phase 4B 測試資料，不代表真實交易。";

const errors = validateRealPriceFiling(draft, codeRows, sectionRows);
if (errors.length) throw new Error(errors.map((error) => error.message).join("\n"));
const now = new Date(2026, 9, 22, 12, 34, 56);
const basename = createCandidateBasename(draft, now);
const jsonText = `${JSON.stringify(buildRealPriceGovernmentJson(draft), null, 2)}\n`;
const zip = createSingleFileZip(`${basename}.json`, jsonText, now);
const output = new URL("../test-fixtures/phase4b-anonymous/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL(`${basename}.json`, output), jsonText);
await writeFile(new URL(`${basename}.zip`, output), zip);
console.log(`${basename}: json=${jsonText.length} zip=${zip.length}`);
