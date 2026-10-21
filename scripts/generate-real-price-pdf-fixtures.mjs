import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { generateRealPricePdf } from "../js/real-price-pdf-overlay.js";
import { REAL_PRICE_PDF_ASSETS } from "../js/real-price-pdf-coordinates.js";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdfLib = require(resolve(projectRoot, "vendor/pdf/pdf-lib.min.js"));
const fontkit = require(resolve(projectRoot, "vendor/pdf/fontkit.umd.min.js"));
const templateBytes = readFileSync(resolve(projectRoot, REAL_PRICE_PDF_ASSETS.template.replace(/^\.\//, "")));
const fontBytes = readFileSync(resolve(projectRoot, REAL_PRICE_PDF_ASSETS.font.replace(/^\.\//, "")));
const outputDirectory = resolve(projectRoot, "output/pdf");
const outputPath = resolve(process.argv[2] || resolve(outputDirectory, "實價登錄委託書-匿名驗收.pdf"));
const propertyLayout = process.argv[5] === "bordered-comparison" ? "bordered-comparison" : "borderless";
const sample = process.argv[6] || "default";

mkdirSync(outputDirectory, { recursive: true });
const bytes = await generateRealPricePdf({
  preview: buildPreview(propertyLayout === "bordered-comparison" || sample === "title-row-demo" ? 2 : 6, "申報登錄資訊", propertyLayout, sample),
  templateBytes,
  fontBytes,
  propertyLayout,
  pdfLib,
  fontkit,
  cryptoApi: webcrypto,
});
writeFileSync(outputPath, bytes);
console.log(outputPath);

function buildPreview(count, matter, layout, sample) {
  const roles = ["權利人", "義務人"];
  return {
    entrustors: Array.from({ length: count }, (_, index) => ({
      id: `party-${index + 1}`,
      title: roles[index % roles.length],
      name: `匿名委託人${index + 1}`,
      idNumber: `${index % 2 ? "B" : "A"}${String(index + 1).padStart(9, "0")}`,
      phone: index === 0 || index === 2 ? "" : `02-2000-${String(index + 1).padStart(4, "0")}`,
      address: index === 1
        ? "臺北市大同區測試大道一段100巷20弄30號10樓之5"
        : `臺北市大同區測試路${index + 1}號`,
    })),
    agent: {
      id: "agent-real-price",
      name: "匿名受託人",
      idNumber: "Z900000009",
      phone: "",
      address: "臺北市大同區代理路9號",
    },
    city: "臺北市",
    district: "大同區",
    propertyDescription: layout === "bordered-comparison" || sample === "title-row-demo"
      ? "不動產坐落：\n臺北市大同區玉泉段一小段790地號　持分：3615/350000\n臺北市大同區延平北路一段83號二樓之6（及公設）　持分：1/28\n臺北市大同區延平北路一段83號九樓之1（及公設）　持分：1/2"
      : "不動產坐落：\n臺北市大同區玉泉段二小段26地號　持分：1/2222\n臺北市大同區玉泉段二小段233地號　持分：1/2\n臺北市大同區建國北路一段33號2樓（及公設）　持分：1/1\n臺北市大同區測試大道一段100巷20弄30號10樓之5附設匿名社區第2棟　持分：3/8",
    propertyFontMode: process.argv[3] === "manual" ? "manual" : "auto",
    propertyFontSize: Number(process.argv[4] || 12),
    matter,
    warnings: ["部分聯絡電話缺漏；正式 PDF 保留空白供手寫"],
  };
}
