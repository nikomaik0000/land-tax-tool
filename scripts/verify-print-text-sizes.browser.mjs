import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PRINT_SIZE_PLAYWRIGHT_PATH || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "output/pdf/print-text-sizes");
const chrome = process.env.PRINT_SIZE_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sizes = ["small", "medium", "large"];
const results = [];

const server = createServer(async (request, response) => {
  const path = resolve(root, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
  if (!path.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json" })[extname(path)] || "application/octet-stream");
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});

await mkdir(output, { recursive: true });
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chrome, headless: true });

async function assertSavedPreference(page, { path, key, selector }, size) {
  await page.goto(`${base}/${path}`, { waitUntil: "domcontentloaded" });
  await page.locator(selector("small")).waitFor({ state: "attached" });
  const first = size === "small" ? "medium" : "small";
  const choose = (value) => page.evaluate((targetSelector) => {
    const input = document.querySelector(targetSelector);
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector(value));
  await choose(first);
  await choose(size);
  assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), size);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(selector(size)).waitFor({ state: "attached" });
  assert.equal(await page.locator(selector(size)).isChecked(), true);
}

async function writePdf(report, size, prepare) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  if (report.slug === "case-card") {
    await page.addInitScript(() => {
      const addEventListenerNative = window.addEventListener;
      window.addEventListener = function addEventListenerWithoutCaseCardRebuild(type, listener, options) {
        if (type === "beforeprint") return;
        return addEventListenerNative.call(this, type, listener, options);
      };
    });
  }
  await assertSavedPreference(page, report, size);
  const prepared = await prepare(page, size);
  await page.emulateMedia({ media: "print" });
  const layout = await page.evaluate(({ rootSelector, fontSelector }) => {
    const rootElement = document.querySelector(rootSelector);
    const fontElement = document.querySelector(fontSelector);
    const overflows = [...rootElement.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
    }).map((element) => ({ tag: element.tagName, className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })).slice(0, 8);
    return { fontSize: getComputedStyle(fontElement).fontSize, overflows };
  }, prepared);
  assert.deepEqual(layout.overflows, [], `${report.slug}-${size} has horizontal overflow`);
  assert.equal(layout.fontSize, report.expected[size]);
  const filename = `${report.slug}-${size}.pdf`;
  const path = join(output, filename);
  await page.pdf({ path, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  assert.deepEqual(browserErrors, []);
  results.push({ report: report.slug, size, filename, fontSize: layout.fontSize });
  await page.close();
}

const transcript = {
  slug: "transcript", path: "transcript.html", key: "landTool.transcriptPrintTextSize",
  selector: (size) => `[data-option="fontSize"][value="${size}"]`,
  expected: { small: "9.5px", medium: "10.25px", large: "11.25px" },
  async prepare(page, size) {
    await page.locator("#transcriptReportSettings [data-option=fontSize]").first().waitFor({ state: "attached" });
    return page.evaluate(async (textSize) => {
      const { renderA4Report } = await import("/js/a4-report-renderer.js");
      const { createDefaultReportConfiguration } = await import("/js/report-settings.js");
      const configuration = createDefaultReportConfiguration();
      configuration.displayOptions = { ...configuration.displayOptions, orientation: "landscape", fontSize: textSize, tableSpacing: "standard", sectionSpacing: "standard", showLandZoning: true, zoningPrintLayout: "column", showNotices: false };
      const lands = Array.from({ length: 12 }, (_, index) => ({
        id: `land-${index}`, district: "大安", section: "學府", subsection: "三", landNumber: `${436 + index}`,
        area: 30 + index, owner: `所有權人${index + 1}`, announcedValue: 448000, currentValue: 125440 + index,
        zoning: `第三種住宅區（特）第 ${index + 1} 筆；依都市計畫說明書及相關管制規定辦理之長文字驗證`,
        previousTransfers: [
          { date: "081年09月", previousValue: 120000, shareNumerator: 112, shareDenominator: 14400, priceIndex: 159.7, currentValue: 104533, selfUseTax: 5896, generalTax: 12835 },
          { date: "113年12月", previousValue: 432000, shareNumerator: 112, shareDenominator: 72000, priceIndex: 103.2, currentValue: 20907, selfUseTax: 11, generalTax: 22 },
        ],
      }));
      const state = { caseName: "謄本整理稅費試算－長文字與換頁驗證", owners: [], houses: [], house: {}, lands, caseCurrentValue: 1500000, totalLandCurrentValue: 1500000, ...configuration, selectedClauses: [], customNotes: [], giftTax: { ...configuration.giftTax, enabled: false } };
      document.querySelector("#transcriptPreviewSection").hidden = false;
      const sheet = document.querySelector("#transcriptA4Sheet");
      sheet.innerHTML = renderA4Report(state).html;
      sheet.className = `a4-sheet orientation-landscape table-spacing-standard section-spacing-standard report-font-${textSize}`;
      document.querySelector("#transcriptDynamicPrintPage").textContent = "@page { size: A4 landscape; margin: 10mm; }";
      return { rootSelector: "#transcriptA4Sheet", fontSelector: "#transcriptA4Sheet .a4-land-table" };
    }, size);
  },
};

async function renderProration(page, size, batch) {
  return page.evaluate(async ({ textSize, isBatch }) => {
    const { renderProrationReport } = await import("/js/proration-report.js");
    const { calculateHouseTax, calculateLandTax, calculateCombinedSettlement } = await import("/js/proration-calculations.js");
    const makeState = (index) => ({
      shared: { caseName: "立源富立方", seller: "立源建設股份有限公司", handoverDate: "2026-10-01", notes: [{ id: `note-${index}`, content: "列印字級與換頁驗證備註，保留完整內容且不得裁切。" }] },
      customer: { id: `unit-${index}`, label: `第${index}戶`, doorplate: `${index}號`, buyer: `買方姓名${index}`, note: "", houseTax: { amount: 46845, taxableMonths: 13, taxStartDate: "2025-06-01", prorationStartDate: "2026-07-01", prorationEndDate: "2026-10-01", payer: "buyer", taxNote: "房屋稅備註" }, landTax: { declaredLandValue: 5760, area: 9795.24, shareNumerator: 873, shareDenominator: 100000, rate: 1, taxYear: 2026, prorationStartDate: "2026-01-01", prorationEndDate: "2026-10-01", payer: "seller", legacyAmount: "" } },
    });
    const reportHtml = (state, batchMode) => {
      const house = calculateHouseTax(state.customer.houseTax);
      const land = calculateLandTax(state.customer.landTax);
      return renderProrationReport(state, { house, land, total: calculateCombinedSettlement(house, land) }, { batch: batchMode });
    };
    if (isBatch) {
      const host = document.querySelector("#batchReportHost");
      host.replaceChildren();
      for (const index of [1, 2]) {
        const article = document.createElement("article");
        article.className = `a4-sheet proration-a4-sheet orientation-portrait report-font-${textSize} table-spacing-standard section-spacing-standard batch-report-document`;
        article.innerHTML = reportHtml(makeState(index), true);
        host.append(article);
      }
      host.className = "batch-report-host is-print-ready";
      return { rootSelector: "#batchReportHost", fontSelector: "#batchReportHost .report-document" };
    }
    const state = makeState(1);
    const sheet = document.querySelector("#singleProrationWorkspace #a4Sheet");
    sheet.innerHTML = reportHtml(state, false);
    sheet.className = `a4-sheet proration-a4-sheet orientation-portrait report-font-${textSize} table-spacing-standard section-spacing-standard`;
    return { rootSelector: "#singleProrationWorkspace #a4Sheet", fontSelector: "#singleProrationWorkspace #a4Sheet .report-document" };
  }, { textSize: size, isBatch: batch });
}

const prorationSingle = {
  slug: "proration-single", path: "proration.html", key: "landTool.prorationSinglePrintTextSize",
  selector: (size) => `input[name="singleProrationPrintTextSize"][value="${size}"]`,
  expected: { small: "9.5px", medium: "10.25px", large: "11.25px" },
  prepare: (page, size) => renderProration(page, size, false),
};

const prorationBatch = {
  slug: "proration-batch", path: "proration.html", key: "landTool.prorationBatchPrintTextSize",
  selector: (size) => `input[name="batchProrationPrintTextSize"][value="${size}"]`,
  expected: { small: "9.25px", medium: "10.25px", large: "11px" },
  prepare: (page, size) => renderProration(page, size, true),
};

function queryReport({ slug, path, key, radioName, host, title, orientation, expected, columns, rows }) {
  return {
    slug, path, key, selector: (size) => `input[name="${radioName}"][value="${size}"]`, expected,
    async prepare(page, size) {
      return page.evaluate(async (options) => {
        const { renderReportShell } = await import("/js/report-print.js");
        const hostElement = document.querySelector(options.host);
        hostElement.innerHTML = renderReportShell({ title: options.title, metadata: [{ label: "產生日期", value: "2026/11/12" }], columns: options.columns, rows: options.rows, wide: true });
        hostElement.className = `batch-report-host orientation-${options.orientation} report-font-${options.size} is-print-ready`;
        return { rootSelector: options.host, fontSelector: `${options.host} .report-table` };
      }, { host, title, orientation, size, columns, rows });
    },
  };
}

const longText = "第三種住宅區（特），依都市計畫說明書、土地使用分區管制及相關附帶決議辦理；此為長文字自動換行驗證";
const landValue = queryReport({
  slug: "land-value", path: "land-value-update.html", key: "landTool.landValuePrintTextSize", radioName: "landValuePrintTextSize", host: "#landValuePrintReport", title: "公告現值查詢結果", orientation: "portrait", expected: { small: "9px", medium: "10px", large: "11px" },
  columns: [{ label: "縣市", key: "city" }, { label: "區", key: "district" }, { label: "段", key: "section" }, { label: "小段", key: "subsection" }, { label: "地號", key: "number" }, { label: "面積", key: "area", className: "report-number" }, { label: "公告現值", key: "value", className: "report-number" }, { label: "公告地價", key: "price", className: "report-number" }],
  rows: Array.from({ length: 48 }, (_, index) => ({ city: "臺北市", district: "大安區", section: "學府", subsection: "三", number: `${436 + index}-0000`, area: `${30 + index}.25`, value: `${448000 + index * 100}`, price: `${120000 + index * 100}` })),
});

const landNumber = queryReport({
  slug: "land-number", path: "land-number-converter.html", key: "landTool.landNumberPrintTextSize", radioName: "converterPrintTextSize", host: "#converterPrintReport", title: "新舊地號查詢結果", orientation: "landscape", expected: { small: "8.75px", medium: "10px", large: "10.75px" },
  columns: [{ label: "縣市", key: "city" }, { label: "行政區", key: "district" }, { label: "查詢方向", key: "direction" }, { label: "原段", key: "sourceSection" }, { label: "原小段", key: "sourceSubsection" }, { label: "原地號", key: "sourceNumber" }, { label: "對照段", key: "targetSection" }, { label: "對照小段", key: "targetSubsection" }, { label: "對照地號", key: "targetNumber" }, { label: "結果", key: "status" }],
  rows: Array.from({ length: 55 }, (_, index) => ({ city: "臺北市", district: "大安區", direction: "舊地號 → 新地號", sourceSection: "學府段", sourceSubsection: "三小段", sourceNumber: `${100 + index}-0000`, targetSection: "學府重測段", targetSubsection: "第三小段", targetNumber: `${900 + index}-0000、${1900 + index}-0000`, status: "查詢成功（多筆對照完整顯示）" })),
});

const zoning = queryReport({
  slug: "zoning", path: "zoning.html", key: "landTool.zoningPrintTextSize", radioName: "zoningPrintTextSize", host: "#zoningPrintReport", title: "土地使用分區查詢結果", orientation: "landscape", expected: { small: "9px", medium: "10px", large: "11px" },
  columns: [{ label: "縣市", key: "city" }, { label: "區", key: "district" }, { label: "段", key: "section" }, { label: "小段", key: "subsection" }, { label: "地號", key: "number" }, { label: "土地類型", key: "type" }, { label: "使用分區", key: "zoning", className: "report-long-text" }, { label: "使用地類別", key: "use" }, { label: "查詢狀態", key: "status" }],
  rows: Array.from({ length: 42 }, (_, index) => ({ city: "臺北市", district: "大安區", section: "學府段", subsection: "三小段", number: `${436 + index}-0000`, type: "都市土地", zoning: `${longText}（第 ${index + 1} 筆）`, use: "住宅區建築使用", status: "查詢成功" })),
});

const caseCard = {
  slug: "case-card", path: "case-documents.html", key: "landTool.caseCardPrintTextSize",
  selector: (size) => `input[name="caseCardPrintTextSize"][value="${size}"]`,
  expected: { small: "8.93333px", medium: "9.73333px", large: "10.8px" },
  async prepare(page, size) {
    return page.evaluate(async (textSize) => {
      const { createCaseDocumentState, renderCaseCard } = await import("/js/case-documents-model.js");
      const { preparePrintableCaseCard, findOversizedCaseCardRows } = await import("/js/case-documents-print.js");
      const state = createCaseDocumentState();
      Object.assign(state.caseInfo, { district: "大安區", caseNumber: "驗證字第 20261112 號", registrationReason: "買賣", reasonDate: "115.11.12", caseType: "sale" });
      state.parties = Array.from({ length: 12 }, (_, index) => ({ id: `party-${index}`, title: index < 6 ? "權利人" : "義務人", name: `當事人姓名${index + 1}`, birthDate: "075.03.12", idNumber: `A1234567${String(index).padStart(2, "0")}`, address: `臺北市大安區長文字測試路${index + 1}段${index + 1}巷${index + 1}弄${index + 1}號${index + 1}樓之${index + 1}（通訊地址完整顯示與自動換行驗證）`, share: `土地 1/${index + 2}、建物 1/${index + 3}`, phoneNote: `02-1234567${index}\n備註第${index + 1}筆`, interests: [] }));
      state.lands = Array.from({ length: 24 }, (_, index) => ({ id: `land-${index}`, section: "學府", subsection: "三", landNumber: `${436 + index}-0000`, area: `${30 + index}.25`, announcedCurrentValue: `${448000 + index * 100}`, shareNumerator: 1, shareDenominator: 24, totalCurrentValue: `${5600000 + index * 1000}`, previousTransferText: `民國 81 年 9 月\n每平方公尺 120,000 元` }));
      state.buildingMeta = { ...state.buildingMeta, material: "鋼筋混凝土造", totalFloors: "十五層" };
      state.buildings = Array.from({ length: 12 }, (_, index) => ({ id: `building-${index}`, buildingNumber: `${1200 + index}-000`, address: `臺北市大安區長文字測試路${index + 1}號${index + 1}樓之${index + 1}，完整門牌不得裁切`, floor: `${index + 2}層`, area: `${80 + index}.5`, shareNumerator: 1, shareDenominator: 12, accessoryText: "陽台、雨遮及其他附屬建物完整說明", currentValue: `${1800000 + index * 1000}`, taxNumber: `DA-${String(index + 1).padStart(6, "0")}` }));
      const root = document.querySelector("#caseCardPrintRoot");
      root.style.display = "block";
      const article = preparePrintableCaseCard(root, renderCaseCard(state), textSize);
      if (findOversizedCaseCardRows(article, 1).length < 1) throw new Error("oversized case-card row warning probe failed");
      return { rootSelector: "#caseCardPrintRoot", fontSelector: "#caseCardPrintRoot .land-card-table" };
    }, size);
  },
};

try {
  for (const report of [transcript, prorationSingle, prorationBatch, landValue, landNumber, zoning, caseCard]) {
    for (const size of sizes) await writePdf(report, size, report.prepare.bind(report));
  }
  await writeFile(join(output, "verification.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Generated and verified ${results.length} PDFs in ${output}`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
