import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REAL_PRICE_APPENDIX_FIELDS,
  REAL_PRICE_MAIN_FIELDS,
  REAL_PRICE_PDF_ASSETS,
  REAL_PRICE_TEMPLATE,
} from "./real-price-pdf-coordinates.js";
import { arrangeRealPriceEntrustors, buildBorderedPropertyTableLayout, buildRealPricePdfIssues, generateRealPricePdf, resolveRealPricePropertyFontSize } from "./real-price-pdf-overlay.js";

const require = createRequire(import.meta.url);
const root = resolve(new URL("..", import.meta.url).pathname);
const pdfLib = require(resolve(root, "vendor/pdf/pdf-lib.min.js"));
const fontkit = require(resolve(root, "vendor/pdf/fontkit.umd.min.js"));
const templateBytes = readFileSync(resolve(root, REAL_PRICE_PDF_ASSETS.template.replace(/^\.\//, "")));
const fontBytes = readFileSync(resolve(root, REAL_PRICE_PDF_ASSETS.font.replace(/^\.\//, "")));

test("非必要缺漏不阻擋實價登錄正式 PDF", () => {
  assert.deepEqual(buildRealPricePdfIssues({
    entrustors: [{ name: "匿名甲", idNumber: "", address: "", phone: "" }],
    agent: {},
    city: "",
    district: "",
    propertyDescription: "",
    matter: "",
  }), []);
  assert.deepEqual(buildRealPricePdfIssues({ propertyDescription: "大同區 26地號　持分：待確認" }), [
    "本次買賣移轉持分待確認；請先在不動產標的欄手動修正",
  ]);
});

test("主表優先各放第一位權利人與義務人，其餘依原順序進附表", () => {
  const parties = [
    { id: "r1", title: "權利人" },
    { id: "r2", title: "權利人" },
    { id: "o1", title: "義務人" },
    { id: "o2", title: "義務人" },
  ];
  const placement = arrangeRealPriceEntrustors(parties);
  assert.deepEqual(placement.main.map((party) => party.id), ["r1", "o1"]);
  assert.deepEqual(placement.appendix.map((party) => party.id), ["r2", "o2"]);
});

test("標的字級支援 12 至 9pt 自動調整及 9 至 13pt 手動指定", () => {
  const main = REAL_PRICE_MAIN_FIELDS;
  assert.equal(main.propertyDescription.x, 73);
  assert.equal(main.propertyDescription.width, 466);
  assert.equal(main.propertyDescription.y, 660);
  assert.ok(main.propertyDescription.y < 678.5, "第一筆標的應位於政府原稿標題的下一行");
  assert.equal(main.propertyDescription.autoMaxFontSize, 12);
  assert.equal(main.propertyDescription.autoMinFontSize, 9);
  assert.equal(main.propertyDescription.manualMinFontSize, 9);
  assert.equal(main.propertyDescription.manualMaxFontSize, 13);
  assert.equal(main.propertyDescription.fontSizeStep, 0.5);
  assert.equal(main.propertyDescription.shareGap, 8);
  const font = { widthOfTextAtSize: (text, size) => Array.from(text).length * size };
  const rows = [{ target: "甲".repeat(26), share: "持分：1/1" }];
  assert.equal(resolveRealPricePropertyFontSize(rows, main.propertyDescription, font, { mode: "auto" }), 12);
  assert.equal(resolveRealPricePropertyFontSize(rows, main.propertyDescription, font, { mode: "manual", size: 12.5 }), 12.5);
  assert.equal(resolveRealPricePropertyFontSize(rows, main.propertyDescription, font, { mode: "manual", size: 20 }), 13);
  assert.equal(resolveRealPricePropertyFontSize(rows, main.propertyDescription, font, { mode: "manual", size: 5 }), 9);
});

test("自訂雙欄表格保留完整框線所需欄寬、內距與自然列高", () => {
  const field = REAL_PRICE_MAIN_FIELDS.propertyDescription;
  const font = { widthOfTextAtSize: (text, size) => Array.from(text).length * size * 0.55 };
  const rows = [
    { target: "臺北市大同區玉泉段一小段790地號", share: "持分：3615/350000", shareValue: "3615/350000" },
    { target: "臺北市大同區延平北路一段83號二樓之6（及公設）", share: "持分：1/28", shareValue: "1/28" },
  ];
  const size = resolveRealPricePropertyFontSize(rows, field, font, { mode: "auto" }, "bordered-comparison");
  const layout = buildBorderedPropertyTableLayout(rows, field, font, size);
  assert.ok(size <= 12 && size >= 9);
  assert.ok(layout.tableWidth <= field.width);
  assert.ok(layout.targetColumnWidth > layout.shareColumnWidth);
  assert.equal(layout.rows.length, 2);
  assert.ok(layout.rows.every((row) => row.height >= size + field.tablePaddingY * 2));
  assert.ok(layout.bottomY >= field.tableMinimumY);
});

test("姓名證號電話維持官方欄位使用的 14.04pt 標準字級", () => {
  const main = REAL_PRICE_MAIN_FIELDS;
  assert.equal(main.agent.name.fontSize, 14.04);
  assert.equal(main.agent.idNumber.fontSize, 14.04);
  assert.equal(main.agent.phone.fontSize, 14.04);
  main.entrustors.forEach((slot) => {
    assert.equal(slot.name.fontSize, 14.04);
    assert.equal(slot.idNumber.fontSize, 14.04);
    assert.equal(slot.phone.fontSize, 14.04);
    assert.equal(slot.address.fontSize, 14.04);
  });
  assert.equal(REAL_PRICE_APPENDIX_FIELDS.name.fontSize, 14.04);
  assert.equal(REAL_PRICE_APPENDIX_FIELDS.idNumber.fontSize, 14.04);
  assert.equal(REAL_PRICE_APPENDIX_FIELDS.phone.fontSize, 14.04);
});

test("1 至 2 人只輸出主表，3 人以上按官方 16 人附表容量增頁", async () => {
  for (const [count, expectedPages] of [[2, 1], [4, 2], [6, 2], [19, 3]]) {
    const bytes = await generateRealPricePdf({
      preview: previewWithParties(count),
      templateBytes,
      fontBytes,
      pdfLib,
      fontkit,
      cryptoApi: webcrypto,
    });
    const document = await pdfLib.PDFDocument.load(bytes);
    assert.equal(document.getPageCount(), expectedPages, `${count} 位委託人的頁數`);
  }
});

test("實價登錄套印綁定已盤點的官方 PDF，不接受靜默替換", () => {
  const digest = createHash("sha256").update(templateBytes).digest("hex");
  assert.equal(digest, REAL_PRICE_TEMPLATE.sha256);
});

test("瀏覽器端套印會在頁面處理前拒絕不同指紋的底稿", async () => {
  await assert.rejects(generateRealPricePdf({
    preview: previewWithParties(2),
    templateBytes: new Uint8Array([1, 2, 3]),
    fontBytes: new Uint8Array(),
    pdfLib: { PDFDocument: {} },
    fontkit: {},
    cryptoApi: webcrypto,
  }), (error) => error?.code === "TEMPLATE_MISMATCH");
});

function previewWithParties(count) {
  return {
    entrustors: Array.from({ length: count }, (_, index) => ({
      name: `匿名委託人${index + 1}`,
      idNumber: `A${String(index + 1).padStart(9, "0")}`,
      phone: index % 2 ? "" : `02-2000-${String(index + 1).padStart(4, "0")}`,
      address: `臺北市大同區測試路${index + 1}號`,
    })),
    agent: { name: "匿名受託人", idNumber: "Z900000009", phone: "", address: "臺北市大同區代理路9號" },
    city: "臺北市",
    district: "大同區",
    propertyDescription: "不動產坐落：\n臺北市大同區玉泉段二小段26地號　持分：1/2222\n臺北市大同區玉泉段二小段233地號　持分：1/2\n臺北市大同區建國北路一段33號2樓　持分：1/1",
    propertyFontMode: "auto",
    propertyFontSize: 12,
    matter: "申報登錄資訊",
    warnings: [],
  };
}
