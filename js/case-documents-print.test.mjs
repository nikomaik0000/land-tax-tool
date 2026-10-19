import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../case-documents.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/case-documents.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./case-documents-app.js", import.meta.url), "utf8");
const printHelper = readFileSync(new URL("./case-documents-print.js", import.meta.url), "utf8");
const model = readFileSync(new URL("./case-documents-model.js", import.meta.url), "utf8");

test("案件資料卡提供列印入口及獨立列印容器", () => {
  assert.match(html, /id="printCaseCard"/);
  assert.match(html, /id="caseCardPrintRoot"/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /beforeprint/);
});

test("列印固定 A4 直式並允許表格自動分頁與重複表頭", () => {
  assert.match(css, /@page \{ size: A4 portrait; margin: 12mm 10mm 14mm; \}/);
  assert.match(css, /\.case-card-table thead \{ display: table-header-group; \}/);
  assert.match(css, /\.case-card-table \{ width: 100%; break-inside: auto;/);
  assert.match(css, /\.case-card-table tr,[\s\S]*break-inside: avoid;/);
});

test("列印副本只展開可跨頁表格的 rowspan，共有部分保留合併格", () => {
  assert.match(printHelper, /expandPrintRowspans\(root\)/);
  assert.match(printHelper, /if \(body\.closest\("\.common-card-table"\)\) return;/);
  assert.match(printHelper, /clone\.rowSpan = 1/);
  assert.doesNotMatch(printHelper, /print-table-title-row/);
  assert.doesNotMatch(css, /print-table-title-row/);
  assert.match(css, /\.case-card-section > h3,[\s\S]*break-after: avoid/);
});

test("列印時隱藏網站與編輯介面且不使用縮放字體", () => {
  assert.match(css, /body > \*:not\(\.case-card-print-root\) \{ display: none !important; \}/);
  assert.match(css, /transform: none !important/);
  const printBlock = css.slice(css.indexOf("@media print"));
  assert.doesNotMatch(printBlock, /font-size:\s*[0-6](?:\.\d+)?pt/);
});

test("預覽與列印共用黑色外框、內線及字距規則", () => {
  assert.match(css, /\.case-card-meta \{ border: 1\.5px solid #000000;/);
  assert.match(css, /\.case-card-table \{ border: 1\.5px solid #000000;/);
  assert.match(css, /\.tax-progress-group \{ border: 1\.5px solid #000000; \}/);
  assert.match(css, /\.case-card-table \{ width: 100%; border-collapse: collapse;/);
  assert.match(css, /\.case-card-meta td \{[^}]*border: 1px solid #000000;/s);
  assert.match(css, /\.case-card-table td \{[^}]*border: 1px solid #000000;/s);
  assert.match(css, /\.case-card-sheet \{[^}]*letter-spacing: 0\.02em;/s);
  assert.match(css, /\.case-card-header h2 \{[^}]*letter-spacing: 0\.08em;/s);
  assert.match(css, /\.case-card-table th,[\s\S]*letter-spacing: 0\.03em;/);
  const printBlock = css.slice(css.indexOf("@media print"));
  assert.doesNotMatch(printBlock, /border(?:-color)?:[^;}]*#(?:999|ccc)/i);
});

test("英文副標移除且共有部分維持次層標題", () => {
  assert.doesNotMatch(model, /CASE FILE|case-card-kicker/);
  assert.doesNotMatch(css, /case-card-kicker/);
  assert.match(css, /\.common-part-block \{ margin-top: 2mm; \}/);
  assert.match(css, /\.common-part-block h4 \{[^}]*font-size: 8pt;[^}]*font-weight: 600;[^}]*letter-spacing: 0\.03em;/s);
  assert.match(css, /\.common-card-table \{ font-size: 7pt; \}/);
});
