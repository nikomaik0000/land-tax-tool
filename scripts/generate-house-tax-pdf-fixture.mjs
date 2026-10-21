import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateHouseTaxPdf } from "../js/house-tax-pdf-overlay.js";
import { HOUSE_TAX_PDF_ASSETS } from "../js/house-tax-pdf-coordinates.js";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdfLib = require(resolve(projectRoot, "vendor/pdf/pdf-lib.min.js"));
const fontkit = require(resolve(projectRoot, "vendor/pdf/fontkit.umd.min.js"));
const outputPath = resolve(process.argv[2] || resolve(projectRoot, "output/pdf/house-tax-authorization-anonymous.pdf"));
const fontPath = resolve(process.argv[3] || resolve(projectRoot, "reference/government-forms/fonts/TW-Kai-98_1.ttf"));

const preview = {
  principal: {
    id: "obligor-selected",
    title: "義務人",
    name: "匿名義務人乙",
    idNumber: "B200000002",
    birthDate: "070.01.02",
    address: "臺北市中正區測試路二段2號",
  },
  buildings: [
    { id: "building-1", buildingNumber: "01000-001", address: "臺北市中正區測試路一段100巷20弄30號10樓之5" },
    { id: "building-2", buildingNumber: "01000-002", address: "臺北市中正區測試路二段200巷30弄40號11樓之8" },
    { id: "building-3", buildingNumber: "01000-003", address: "臺北市中正區測試路三段300巷40弄50號12樓之9" },
  ],
  agent: {
    id: "agent-house-tax",
    name: "匿名甲",
    idNumber: "A100000001",
    phone: "02-2000-0001",
    address: "",
  },
  applicationItems: ["房屋稅稅籍證明"],
  warnings: ["代理人通訊地址缺漏"],
};

const bytes = await generateHouseTaxPdf({
  preview,
  templateBytes: readFileSync(resolve(projectRoot, HOUSE_TAX_PDF_ASSETS.template.replace(/^\.\//, ""))),
  fontBytes: readFileSync(fontPath),
  pdfLib,
  fontkit,
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, bytes);
console.log(outputPath);
