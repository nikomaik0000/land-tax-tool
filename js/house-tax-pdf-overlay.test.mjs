import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { HOUSE_TAX_PDF_ASSETS, HOUSE_TAX_PDF_FIELDS, HOUSE_TAX_PDF_LAYOUT, HOUSE_TAX_TEMPLATE } from "./house-tax-pdf-coordinates.js";
import { buildHouseTaxPdfIssues, generateHouseTaxPdf } from "./house-tax-pdf-overlay.js";

test("非必要缺漏不阻擋輸出，多筆房屋坐落由擴大區域的實際排版檢查", () => {
  const base = {
    principal: { name: "匿名義務人", idNumber: "B200000002" },
    buildings: [{ id: "building-1", address: "臺北市測試路1號" }],
    warnings: ["代理人身分證統一編號缺漏"],
  };
  assert.deepEqual(buildHouseTaxPdfIssues(base), []);
  assert.deepEqual(buildHouseTaxPdfIssues({ ...base, buildings: [...base.buildings, { id: "building-2", address: "臺北市測試路2號" }] }), []);
});

test("房屋坐落、當事人與代理人座標均避開簽章欄並維持頁面範圍", () => {
  const fields = HOUSE_TAX_PDF_FIELDS;
  assert.equal(HOUSE_TAX_PDF_LAYOUT.lowerShiftY, 42);
  assert.equal(fields.buildingAddress.maxLines, 4);
  assert.equal(fields.buildingAddress.maxFontSize, 12);
  assert.equal(fields.buildingAddress.x, 117.65, "房屋坐落的「房」應對齊政府原稿證明項目的「房」");
  assert.equal(fields.buildingAddress.y, 560, "房屋坐落應貼近上方勾選項目並保留安全間距");
  assert.ok(fields.authorizationAgentName.x > 152.93, "代理人姓名應緊接官方「代理人」文字並保留一個視覺空格");
  assert.equal(fields.authorizationAgentName.fontSize, 16.08);
  assert.equal(fields.authorizationPhrase.fontSize, 16.08);
  assert.equal(fields.principalName.fontSize, 16.08);
  assert.equal(fields.principalIdNumber.fontSize, 16.08);
  assert.equal(fields.agentName.fontSize, 16.08);
  assert.equal(fields.agentIdNumber.fontSize, 16.08);
  assert.equal(fields.agentPhone.fontSize, 16.08);
  assert.ok(fields.buildingAddress.y > fields.authorizationAgentName.y);
  assert.ok(fields.principalName.x + fields.principalName.width < 440);
  assert.ok(fields.agentName.x + fields.agentName.width < 440);
  Object.values(fields).forEach((field) => {
    assert.ok(field.x >= 0 && field.x + field.width <= HOUSE_TAX_TEMPLATE.width);
    assert.ok(field.y >= 0 && field.y <= HOUSE_TAX_TEMPLATE.height);
  });
});

test("房屋稅籍套印綁定已盤點的官方 PDF，不接受靜默替換", () => {
  const path = new URL(`../${HOUSE_TAX_PDF_ASSETS.template.replace(/^\.\//, "")}`, import.meta.url);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(digest, HOUSE_TAX_TEMPLATE.sha256);
});

test("瀏覽器端套印會在頁面處理前拒絕不同指紋的底稿", async () => {
  await assert.rejects(generateHouseTaxPdf({
    preview: {
      principal: { name: "匿名義務人", idNumber: "B200000002" },
      buildings: [{ address: "臺北市測試路1號" }],
      agent: { name: "匿名代理人", idNumber: "A100000001", phone: "02-2000-0001", address: "測試地址" },
      applicationItems: ["房屋稅稅籍證明"],
      warnings: [],
    },
    templateBytes: new Uint8Array([1, 2, 3]),
    fontBytes: new Uint8Array(),
    pdfLib: { PDFDocument: {} },
    fontkit: {},
    cryptoApi: webcrypto,
  }), (error) => error?.code === "TEMPLATE_MISMATCH");
});
