// Run with node --test scripts/test-proration-phase4.browser.mjs.
// PRORATION_PLAYWRIGHT_PATH points to an existing Playwright installation;
// PRORATION_EXCELJS_PATH points to the same ExcelJS 4.4.0 bundle as other tests.
import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goldenCase } from "../js/proration-fixtures.mjs";
import { readBatchExcel, buildBatchTemplate } from "../js/proration-batch-excel.js";
import { buildBatchCaseFile } from "../js/proration-batch-case-file.js";
import { setField } from "../js/proration-batch-state.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = join(root, "reference/fixtures/proration-batch");
const output = join(tmpdir(), "proration-phase4-browser");
let server, browser, page, base, errors, consoleErrors, dialogAction;
before(async () => {
  await mkdir(output, { recursive: true });
  server = createServer(async (request, response) => {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
    if (!path.startsWith(root)) { response.writeHead(403).end(); return; }
    try { const bytes = await readFile(path); response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" })[extname(path)] || "application/octet-stream"); response.end(bytes); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PRORATION_BROWSER_EXECUTABLE ? { executablePath: process.env.PRORATION_BROWSER_EXECUTABLE, headless: true } : { channel: "chrome", headless: true });
});
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); errors = []; consoleErrors = [];
  dialogAction = "accept";
  page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => dialogAction === "dismiss" ? dialog.dismiss() : dialog.accept());
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.route("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js", (route) => route.fulfill({ path: process.env.PRORATION_EXCELJS_PATH, contentType: "text/javascript" }));
  await page.addInitScript((state) => sessionStorage.setItem("landTool.prorationState", JSON.stringify(state)), goldenCase());
  await page.goto(`${base}/proration.html`);
  await page.waitForFunction(() => document.querySelector('[data-final="total"]').textContent.includes("7,331"));
});
afterEach(async () => { assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); await page.close(); });
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

const common = (path) => page.locator(`[data-batch-common="${path}"]`);
const individual = (path) => page.locator(`[data-batch-individual="${path}"]`);
const rows = () => page.locator("#batchRows tr");
async function batchJson(count) {
  const ExcelJS = require(process.env.PRORATION_EXCELJS_PATH);
  const common = JSON.parse(await readFile(join(fixtures, "common.json"), "utf8"));
  const { batch } = await readBatchExcel(await readFile(join(fixtures, "golden.xlsx")), { ExcelJS, common });
  const seed = batch.rows[0];
  batch.rows = Array.from({ length: count }, (_, index) => {
    const row = structuredClone(seed); row.id = `print-${index + 1}`; row.source.rowNumber = index + 2;
    setField(row.values, "customer.label", `第${index + 1}戶`);
    setField(row.values, "customer.doorplate", `${index + 1}號`);
    setField(row.values, "customer.note", `個別備註 ${index + 1}`);
    return row;
  });
  batch.common.shared.notes = [{ id: "common-print-note", content: "共用備註" }];
  return Buffer.from(JSON.stringify(buildBatchCaseFile(batch)));
}
async function batchXlsx(count) {
  const ExcelJS = require(process.env.PRORATION_EXCELJS_PATH);
  const workbook = buildBatchTemplate({}, ExcelJS), sheet = workbook.getWorksheet("批次資料");
  for (let index = 0; index < count; index += 1) {
    const row = index + 4;
    sheet.getCell(row, 1).value = "是";
    sheet.getCell(row, 2).value = `第${index + 1}戶`;
    sheet.getCell(row, 3).value = `${index + 1}號`;
    sheet.getCell(row, 4).value = index ? `買方${index + 1}` : "鄭啟明";
    sheet.getCell(row, 5).value = 46845;
    sheet.getCell(row, 6).value = 873;
    sheet.getCell(row, 7).value = `房屋稅備註 ${index + 1}`;
    sheet.getCell(row, 8).value = `個別備註 ${index + 1}`;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function enter() { await page.locator("#showBatchProration").click(); await page.locator("#batchCommonToggle").click(); await page.locator("#batchCopySingle").click(); }
async function upload(file = "golden.xlsx") {
  await page.locator("#batchExcelFile").setInputFiles(join(fixtures, file));
  await page.waitForFunction(() => document.querySelector("#batchImportStatus").textContent.startsWith("已匯入"));
}
async function edit(index = 0) { await rows().nth(index).locator("[data-edit-row]").click(); }
async function clickBatchPrint() {
  await page.locator("#batchPrintSelected").click();
  await page.waitForFunction(() => /^(已準備|已取消批次列印|列印未完成)/.test(document.querySelector("#batchPrintStatus").textContent));
}

test("entry switches workspaces and preserves original single-case controls", async () => {
  assert.equal(await page.locator("#singleProrationWorkspace").isVisible(), true);
  await page.locator("#showBatchProration").click();
  assert.equal(await page.locator("#singleProrationWorkspace").isVisible(), false);
  assert.equal(await page.locator("#showBatchProration").getAttribute("aria-pressed"), "true");
  await page.locator("#showSingleProration").click();
  assert.equal(await page.locator('[data-customer-field="buyer"]').inputValue(), "鄭啟明");
  assert.ok((await page.locator('[data-final="total"]').textContent()).includes("7,331"));
});
test("common settings start collapsed, summarize values and retain data after collapsing", async () => {
  await page.locator("#showBatchProration").click();
  assert.equal(await page.locator("#batchCommonToggle").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#batchCommonBody").isVisible(), false);
  assert.equal(await page.locator("#batchCommonSummary").textContent(), "尚未設定共用資料");
  await page.locator("#batchCommonToggle span").click();
  assert.equal(await page.locator("#batchCommonToggle").getAttribute("aria-expanded"), "true");
  assert.equal(await common("customer.landTax.area").isVisible(), true);
  assert.equal(await common("customer.landTax.shareDenominator").isVisible(), true);
  assert.equal(await common("customer.landTax.declaredLandValue").isVisible(), true);
  await page.locator("#batchCopySingle").click();
  await common("customer.landTax.area").fill("9795.24");
  await page.locator("#batchCommonHeading h2").click({ position: { x: 5, y: 5 } });
  assert.equal(await page.locator("#batchCommonBody").isVisible(), false);
  assert.match(await page.locator("#batchCommonSummary").textContent(), /賣方：立源｜分算日：115\/10\/1/);
  await page.locator("#batchCommonSummary").click();
  assert.equal(await page.locator("#batchCommonBody").isVisible(), true);
  assert.equal(await common("customer.landTax.area").inputValue(), "9795.24");
});
test("copy single data excludes per-house amounts and leaves single independent", async () => {
  await enter(); assert.equal(await common("shared.seller").inputValue(), "立源");
  assert.equal(await common("customer.houseTax.taxableMonths").inputValue(), "13");
  assert.equal(await page.locator('[data-batch-common="customer.houseTax.amount"]').count(), 0);
  await common("shared.seller").fill("批次賣方");
  await page.locator("#showSingleProration").click(); assert.equal(await page.locator('[data-shared-field="seller"]').inputValue(), "立源");
  await page.locator('[data-shared-field="seller"]').fill("單戶修改");
  await page.locator("#showBatchProration").click(); assert.equal(await common("shared.seller").inputValue(), "批次賣方");
});
test("real Excel import displays Golden and keeps original single report intact", async () => {
  const before = await page.locator("#a4Sheet").innerHTML();
  await enter(); await upload();
  assert.equal(await rows().count(), 1);
  for (const text of ["11,029", "3,698", "7,331", "立源應補鄭啟明", "Excel 第 2 列"]) assert.ok((await rows().first().textContent()).includes(text));
  assert.equal(await page.locator("#batchSummary").textContent(), "共 1 戶 · 正常 1 戶 · 錯誤 0 戶 · 已勾選 1 戶");
  assert.equal(await page.locator("#a4Sheet").innerHTML(), before);
});
test("common change, individual override, clear and invalid value work through UI", async () => {
  await enter(); await upload(); await edit();
  assert.equal(await individual("customer.houseTax.payer").inputValue(), "");
  assert.ok((await individual("customer.houseTax.payer").locator("..").textContent()).includes("目前繼承共用值"));
  await individual("customer.houseTax.payer").selectOption("buyer");
  await common("customer.houseTax.payer").selectOption("seller");
  assert.ok((await rows().first().textContent()).includes("7,331"));
  await individual("customer.houseTax.payer").selectOption("");
  assert.ok((await rows().first().textContent()).includes("14,727"));
  await individual("customer.houseTax.taxableMonths").fill("wrong");
  assert.equal(await individual("customer.houseTax.taxableMonths").getAttribute("aria-invalid"), "true");
  assert.equal(await rows().first().locator("input[type=checkbox]").isDisabled(), true);
  await individual("customer.houseTax.taxableMonths").fill("");
  assert.equal(await rows().first().locator("input[type=checkbox]").isDisabled(), false);
});
test("editing one row recalculates, preserves focus and requires reselection after repair", async () => {
  await enter(); await upload(); await edit();
  await individual("customer.houseTax.amount").fill("0");
  assert.ok((await page.locator("#batchEditorStatus").textContent()).includes("3,698"));
  await individual("customer.houseTax.amount").fill("bad");
  assert.equal(await rows().first().locator("input[type=checkbox]").isDisabled(), true);
  await individual("customer.houseTax.amount").fill("46845");
  assert.equal(await rows().first().locator("input[type=checkbox]").isChecked(), false);
  assert.equal(await individual("customer.houseTax.amount").evaluate((element) => element === document.activeElement), true);
  assert.ok((await rows().first().textContent()).includes("7,331"));
});
test("mixed import exposes row errors, permits editing formulas and selection only for valid rows", async () => {
  await enter(); await upload("mixed.xlsx");
  assert.equal(await rows().count(), 7);
  assert.equal(await page.locator("#batchRows input:disabled").count(), 5);
  await page.locator("#batchSelectValid").click(); assert.ok((await page.locator("#batchSummary").textContent()).includes("已勾選 2 戶"));
  await page.locator("#batchDeselectAll").click(); assert.equal(await page.locator("#batchRows input:checked").count(), 0);
  await edit(2); assert.ok((await individual("customer.houseTax.amount").inputValue()).includes("formula"));
  await individual("customer.houseTax.amount").fill("46845");
  assert.equal(await rows().nth(2).locator("input").isDisabled(), false);
  await edit(5); await individual("customer.landTax.rate").fill("1");
  assert.equal(await rows().nth(5).locator("input").isDisabled(), false);
});
test("failed upload retains previous rows and a subsequent upload succeeds", async () => {
  await enter(); await upload();
  await page.locator("#batchExcelFile").setInputFiles({ name: "bad.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("bad") });
  await page.waitForFunction(() => document.querySelector("#batchImportStatus").textContent.startsWith("未完成"));
  assert.equal(await rows().count(), 1);
  await upload("mixed.xlsx"); assert.equal(await rows().count(), 7);
});
test("download yields grouped 24-column XLSX; doorplate imports and edits separately", async () => {
  await enter(); const promise = page.waitForEvent("download"); await page.locator("#batchDownloadTemplate").click();
  const download = await promise, path = join(output, "download.xlsx"); await download.saveAs(path);
  const ExcelJS = require(process.env.PRORATION_EXCELJS_PATH), workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(path));
  const sheet = workbook.getWorksheet("批次資料");
  assert.equal(sheet.columnCount, 24);
  assert.equal(sheet.autoFilter, "A3:X3");
  for (let index = 1; index <= 24; index += 1) {
    assert.equal(sheet.getColumn(index).hidden, index >= 15);
    if (index >= 15) assert.equal(sheet.getColumn(index).outlineLevel, 1);
  }
  sheet.getColumn(15).hidden = false;
  sheet.getRow(4).getCell(2).value = "A1";
  sheet.getRow(4).getCell(3).value = "1之2號六樓";
  sheet.getRow(4).getCell(4).value = "鄭啟明";
  sheet.getRow(4).getCell(5).value = 46845;
  sheet.getRow(4).getCell(6).value = 873;
  await page.locator("#batchExcelFile").setInputFiles({ name: "expanded.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  await page.waitForFunction(() => document.querySelector("#batchImportStatus").textContent.startsWith("已匯入"));
  assert.ok((await rows().first().textContent()).includes("7,331"));
  assert.ok((await rows().first().textContent()).includes("1之2號六樓"));
  assert.ok((await rows().first().textContent()).includes("Excel 第 4 列"));
  await edit();
  assert.equal(await individual("customer.doorplate").inputValue(), "1之2號六樓");
  await individual("customer.doorplate").fill("2之3號七樓");
  assert.ok((await rows().first().textContent()).includes("A1"));
  assert.ok((await rows().first().textContent()).includes("2之3號七樓"));
  assert.ok((await rows().first().textContent()).includes("7,331"));
  await rows().first().screenshot({ path: join(output, "doorplate-row.png") });
});
test("batch title renders on one A4 heading line without changing single title styling", async () => {
  const details = await page.evaluate(async (state) => {
    const { calculateHouseTax, calculateLandTax, calculateCombinedSettlement } = await import("/js/proration-calculations.js");
    const { renderProrationReport } = await import("/js/proration-report.js");
    const host = document.querySelector("#a4Sheet"), original = host.querySelector(".report-header h2");
    const before = { font: getComputedStyle(original).font, spacing: getComputedStyle(original).letterSpacing, align: getComputedStyle(original.parentElement).textAlign };
    state.customer.label = "6樓A3"; state.customer.doorplate = "1之2號六樓";
    const house = calculateHouseTax(state.customer.houseTax), land = calculateLandTax(state.customer.landTax);
    host.innerHTML = renderProrationReport(state, { house, land, total: calculateCombinedSettlement(house, land) }, { batch: true });
    const title = host.querySelector(".report-header h2"), range = document.createRange(); range.selectNodeContents(title);
    return { text: title.textContent, lines: range.getClientRects().length, before, after: { font: getComputedStyle(title).font, spacing: getComputedStyle(title).letterSpacing, align: getComputedStyle(title.parentElement).textAlign } };
  }, goldenCase());
  assert.equal(details.text, "6樓A3（1之2號六樓） 立源富立方");
  assert.equal(details.lines, 1);
  assert.deepEqual(details.after, details.before);
  await page.locator("#a4Sheet .report-header").screenshot({ path: join(output, "batch-title.png") });
});
test("shared land defaults inherit; invalid and overridden values stay individual", async () => {
  await enter(); await upload(); await edit();
  for (const [path, value] of [["customer.landTax.area", "9795.24"], ["customer.landTax.shareDenominator", "100000"], ["customer.landTax.declaredLandValue", "5760"]]) {
    await individual(path).fill("");
    await common(path).fill(value);
    assert.ok((await rows().first().textContent()).includes("7,331"));
    assert.ok((await individual(path).locator("..").textContent()).includes("目前繼承共用值"));
  }
  await individual("customer.landTax.declaredLandValue").fill("bad");
  assert.equal(await rows().first().locator("input[type=checkbox]").isDisabled(), true);
  await common("customer.landTax.declaredLandValue").fill("6000");
  assert.equal(await rows().first().locator("input[type=checkbox]").isDisabled(), true);
  await individual("customer.landTax.declaredLandValue").fill("");
  assert.equal(await rows().first().locator("input[type=checkbox]").isDisabled(), false);
  assert.ok(!(await rows().first().textContent()).includes("3,698"));
});
test("desktop and mobile previews/editor have no page overflow and imported markup stays text", async () => {
  await enter(); await upload("mixed.xlsx"); await edit();
  await individual("customer.buyer").fill('<img src=x onerror="alert(1)">' + "長姓名".repeat(20));
  assert.equal(await page.locator("#batchRows img").count(), 0);
  for (const width of [1280, 1024, 720, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}`);
    const rect = await individual("customer.buyer").boundingBox(); assert.ok(rect.width > 100);
  }
  await individual("customer.buyer").fill("鄭啟明");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#batchPreview").screenshot({ path: join(output, "desktop-preview.png") });
  await page.setViewportSize({ width: 375, height: 900 });
  await rows().first().screenshot({ path: join(output, "mobile-row.png") });
  await page.locator("#batchEditor").screenshot({ path: join(output, "mobile-editor.png") });
});

test("blank common settings allow a complete individual override without affecting common", async () => {
  await page.locator("#showBatchProration").click(); await upload(); await edit();
  assert.equal(await rows().first().locator("input").isDisabled(), true);
  const state = goldenCase();
  for (const field of ["shared.seller", "customer.houseTax.taxableMonths", "customer.houseTax.taxStartDate", "customer.houseTax.prorationStartDate", "customer.houseTax.prorationEndDate", "customer.houseTax.payer", "customer.landTax.taxYear", "customer.landTax.prorationStartDate", "customer.landTax.prorationEndDate", "customer.landTax.rate", "customer.landTax.payer"]) {
    const value = field.split(".").reduce((value, key) => value[key], state);
    if (field.endsWith("payer")) await individual(field).selectOption(value); else await individual(field).fill(String(value));
  }
  assert.ok((await rows().first().textContent()).includes("7,331"));
  assert.equal(await common("shared.seller").inputValue(), "");
});
test("single save/import and one-page print still work after batch operations", async () => {
  await enter(); await upload(); const summary = await page.locator("#batchSummary").textContent();
  await page.locator("#showSingleProration").click();
  const downloadPromise = page.waitForEvent("download"); await page.locator("#saveCase").click();
  const file = join(output, "single.json"); await (await downloadPromise).saveAs(file);
  await page.locator('[data-customer-field="buyer"]').fill("單戶暫改");
  const chooserPromise = page.waitForEvent("filechooser"); await page.locator("#importCase").click(); await (await chooserPromise).setFiles(file);
  await page.waitForFunction(() => document.querySelector('[data-customer-field="buyer"]').value === "鄭啟明");
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.locator("#printReport").click(); assert.equal(await page.evaluate(() => window.__printed), true);
  const libraryRequire = createRequire(require.resolve(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright"));
  const { PDFDocument } = libraryRequire("pdf-lib");
  const pdf = await page.pdf({ preferCSSPageSize: true }); assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
  await page.locator("#showBatchProration").click(); assert.equal(await page.locator("#batchSummary").textContent(), summary);
});

test("batch JSON downloads complete case, restores edits and tracks unsaved changes", async () => {
  const beforeUnload = () => page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  await enter(); await upload(); await edit();
  await individual("customer.doorplate").fill("1之2號六樓");
  await individual("customer.note").fill("個別備註");
  await common("shared.caseName").fill("立源建案");
  await page.locator("#batchAddNote").click();
  await page.locator('[data-batch-note="0"]').fill("共用備註");
  await rows().first().locator("input[type=checkbox]").uncheck();
  assert.match(await page.locator("#batchCaseStatus").textContent(), /尚未儲存/);
  assert.equal(await beforeUnload(), true);
  const downloadPromise = page.waitForEvent("download"); await page.locator("#batchSaveCase").click();
  const download = await downloadPromise, path = join(output, "batch-case.json"); await download.saveAs(path);
  assert.match(download.suggestedFilename(), /^立源建案_批次分算_\d{4}-\d{2}-\d{2}\.json$/);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.pageType, "tax-proration-batch");
  assert.equal(saved.data.schemaVersion, 1);
  assert.equal(saved.data.rows[0].selected, false);
  assert.equal(saved.data.rows[0].source.rowNumber, 2);
  assert.equal(saved.data.rows[0].values.customer.doorplate, "1之2號六樓");
  assert.equal(saved.data.common.shared.notes[0].content, "共用備註");
  assert.equal(await beforeUnload(), false);
  await individual("customer.doorplate").fill("暫改門牌");
  await common("shared.seller").fill("暫改賣方");
  assert.equal(await beforeUnload(), true);
  await page.locator("#batchCaseFile").setInputFiles(path);
  await page.waitForFunction(() => document.querySelector("#batchCaseStatus").textContent.startsWith("已導入"));
  assert.equal(await page.locator("#batchEditor").isVisible(), false, "import closes old editor");
  assert.equal(await common("shared.seller").inputValue(), "立源");
  assert.ok((await rows().first().textContent()).includes("1之2號六樓"));
  assert.ok((await rows().first().textContent()).includes("7,331"));
  assert.equal(await rows().first().locator("input[type=checkbox]").isChecked(), false);
  assert.equal(await beforeUnload(), false);
  await edit(); assert.equal(await individual("customer.note").inputValue(), "個別備註");
  assert.equal(await page.locator('[data-batch-note="0"]').inputValue(), "共用備註");
  await individual("customer.note").fill("再次修改"); assert.equal(await beforeUnload(), true);
  await page.locator("#showSingleProration").click(); await page.locator("#showBatchProration").click();
  assert.equal(await individual("customer.note").inputValue(), "再次修改");
  assert.equal(await page.locator('[data-customer-field="buyer"]').inputValue(), "鄭啟明");
});

test("damaged or future batch JSON preserves current data; cancelled replacement stays intact", async () => {
  await enter(); await upload();
  const before = await page.locator("#batchRows").textContent();
  await page.locator("#batchCaseFile").setInputFiles({ name: "damaged.json", mimeType: "application/json", buffer: Buffer.from("{bad") });
  await page.waitForFunction(() => document.querySelector("#batchCaseStatus").textContent.startsWith("未完成"));
  assert.equal(await page.locator("#batchRows").textContent(), before);
  const future = { app: "land-tax-tool", pageType: "tax-proration-batch", version: 2, savedAt: new Date().toISOString(), data: {} };
  await page.locator("#batchCaseFile").setInputFiles({ name: "future.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(future)) });
  await page.waitForFunction(() => document.querySelector("#batchCaseStatus").textContent.includes("不支援"));
  assert.equal(await page.locator("#batchRows").textContent(), before);
  const path = join(output, "batch-case.json");
  const downloadPromise = page.waitForEvent("download"); await page.locator("#batchSaveCase").click(); await (await downloadPromise).saveAs(path);
  await common("shared.seller").fill("不取代");
  dialogAction = "dismiss";
  await page.locator("#batchCaseFile").setInputFiles(path);
  await page.waitForTimeout(100);
  assert.equal(await common("shared.seller").inputValue(), "不取代");
});

test("one selected household produces one A4 PDF with complete notes and leaves single print untouched", async () => {
  await enter(); await upload();
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => window.__batchPrinted), true);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 1);
  const report = await page.locator("#batchReportHost").textContent();
  for (const value of ["房屋稅分算", "地價稅分算", "最終找補", "11,029", "3,698", "7,331"]) assert.ok(report.includes(value));
  const libraryRequire = createRequire(require.resolve(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright"));
  const { PDFDocument } = libraryRequire("pdf-lib");
  const pdf = await page.pdf({ preferCSSPageSize: true });
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
  await writeFile(join(output, "batch-1.pdf"), pdf);
  await page.locator("#showSingleProration").click();
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 0);
  assert.ok((await page.locator("#a4Sheet").textContent()).includes("7,331"));
});

test("30 selected households produce 30 A4 PDF pages in preview order without a trailing blank", async () => {
  await page.locator("#showBatchProration").click();
  await page.locator("#batchCaseFile").setInputFiles({ name: "thirty.json", mimeType: "application/json", buffer: await batchJson(30) });
  await page.waitForFunction(() => document.querySelector("#batchSummary").textContent.includes("共 30 戶"));
  assert.equal(await page.locator("#batchPrintSelected").isEnabled(), true);
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => window.__batchPrinted), true);
  assert.deepEqual(await page.locator("#batchReportHost .batch-report-document").evaluateAll((items) => items.map((item) => item.querySelector("h2").textContent)),
    Array.from({ length: 30 }, (_, index) => `第${index + 1}戶（${index + 1}號） 立源富立方`));
  const libraryRequire = createRequire(require.resolve(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright"));
  const { PDFDocument } = libraryRequire("pdf-lib");
  const pdf = await page.pdf({ preferCSSPageSize: true });
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 30);
  const path = join(output, "batch-30.pdf");
  await writeFile(path, pdf);
});

for (const count of [2, 3, 100]) test(`${count} selected households produce exactly ${count} A4 PDF pages`, async () => {
  await page.locator("#showBatchProration").click();
  await page.locator("#batchCaseFile").setInputFiles({ name: `${count}.json`, mimeType: "application/json", buffer: await batchJson(count) });
  await page.waitForFunction((total) => document.querySelector("#batchSummary").textContent.includes(`共 ${total} 戶`), count);
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => window.__batchPrinted), true);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), count);
  assert.equal(await page.locator("#batchReportHost [id]").count(), 0);
  const libraryRequire = createRequire(require.resolve(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright"));
  const { PDFDocument } = libraryRequire("pdf-lib");
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getPageCount(), count);
  for (const pdfPage of document.getPages()) assert.deepEqual([Math.round(pdfPage.getWidth()), Math.round(pdfPage.getHeight())], [595, 842]);
  await writeFile(join(output, `batch-${count}.pdf`), pdf);
});

test("unselected middle household is absent; cancelled print clears host and repeat print starts fresh", async () => {
  await page.locator("#showBatchProration").click();
  await page.locator("#batchCaseFile").setInputFiles({ name: "three.json", mimeType: "application/json", buffer: await batchJson(3) });
  await page.waitForFunction(() => document.querySelector("#batchSummary").textContent.includes("共 3 戶"));
  await rows().nth(1).locator("input[type=checkbox]").uncheck();
  const originalTitle = await page.title();
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.deepEqual(await page.locator("#batchReportHost .batch-report-document").evaluateAll((items) => items.map((item) => item.querySelector("h2").textContent)), ["第1戶（1號） 立源富立方", "第3戶（3號） 立源富立方"]);
  const libraryRequire = createRequire(require.resolve(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright"));
  const { PDFDocument } = libraryRequire("pdf-lib");
  assert.equal((await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }))).getPageCount(), 2);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 0);
  assert.equal(await page.title(), originalTitle);
  await clickBatchPrint();
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 2);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await rows().first().locator("[data-edit-row]").click();
  await individual("customer.buyer").fill("列印後仍可編輯");
  assert.ok((await rows().first().textContent()).includes("列印後仍可編輯"));
});

test("no selected household shows a prompt and never opens an empty print document", async () => {
  await page.locator("#showBatchProration").click();
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => Boolean(window.__batchPrinted)), false);
  assert.match(await page.locator("#batchPrintStatus").textContent(), /請先勾選至少一戶/);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 0);
});

test("cancel at print confirmation clears temporary reports and permits another attempt", async () => {
  await page.locator("#showBatchProration").click();
  await page.locator("#batchCaseFile").setInputFiles({ name: "two.json", mimeType: "application/json", buffer: await batchJson(2) });
  await page.waitForFunction(() => document.querySelector("#batchSummary").textContent.includes("共 2 戶"));
  const title = await page.title();
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  dialogAction = "dismiss";
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => Boolean(window.__batchPrinted)), false);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 0);
  assert.equal(await page.title(), title);
  dialogAction = "accept";
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => window.__batchPrinted), true);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 2);
});

test("one overlong household is disclosed and excluded only after confirmation", async () => {
  const file = JSON.parse((await batchJson(3)).toString());
  setField(file.data.rows[1].values, "customer.doorplate", "很長的門牌".repeat(30));
  await page.locator("#showBatchProration").click();
  await page.locator("#batchCaseFile").setInputFiles({ name: "long.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await page.waitForFunction(() => document.querySelector("#batchSummary").textContent.includes("共 3 戶"));
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => window.__batchPrinted), true);
  assert.match(await page.locator("#batchPrintStatus").textContent(), /已排除：第2戶：標題超出 A4/);
  assert.deepEqual(await page.locator("#batchReportHost .batch-report-document").evaluateAll((items) => items.map((item) => item.querySelector("h2").textContent)), ["第1戶（1號） 立源富立方", "第3戶（3號） 立源富立方"]);
  const libraryRequire = createRequire(require.resolve(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright"));
  const { PDFDocument } = libraryRequire("pdf-lib");
  assert.equal((await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }))).getPageCount(), 2);
});

test("overlong names and notes are checked for page width and height", async () => {
  const file = JSON.parse((await batchJson(3)).toString());
  setField(file.data.rows[0].values, "customer.buyer", "非常長的買方姓名".repeat(150));
  setField(file.data.rows[1].values, "customer.houseTax.taxNote", "房屋稅備註內容 ".repeat(500));
  setField(file.data.rows[2].values, "customer.note", "其他備註內容 ".repeat(500));
  await page.locator("#showBatchProration").click();
  await page.locator("#batchCaseFile").setInputFiles({ name: "long-content.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await page.waitForFunction(() => document.querySelector("#batchSummary").textContent.includes("共 3 戶"));
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => Boolean(window.__batchPrinted)), false);
  const status = await page.locator("#batchPrintStatus").textContent();
  for (const label of ["第1戶", "第2戶", "第3戶"]) assert.ok(status.includes(label));
  assert.match(status, /超出一張 A4|超出 A4 頁面寬度/);
});

for (const scenario of ["seller", "many-notes"]) test(`${scenario} overflow is detected before opening Chrome print`, async () => {
  const file = JSON.parse((await batchJson(1)).toString());
  if (scenario === "seller") file.data.common.shared.seller = "非常長的賣方姓名".repeat(180);
  else file.data.common.shared.notes = Array.from({ length: 60 }, (_, index) => ({ id: `note-${index}`, content: `共用備註 ${index} ` + "內容 ".repeat(30) }));
  await page.locator("#showBatchProration").click();
  await page.locator("#batchCaseFile").setInputFiles({ name: `${scenario}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await page.waitForFunction(() => document.querySelector("#batchSummary").textContent.includes("共 1 戶"));
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => Boolean(window.__batchPrinted)), false);
  assert.match(await page.locator("#batchPrintStatus").textContent(), /第1戶.*超出/);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 0);
});

test("overlong title is reported before printing without shrinking the report", async () => {
  await enter(); await upload(); await edit();
  await individual("customer.label").fill("超長戶別".repeat(30));
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await rows().first().locator("input[type=checkbox]").check();
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => Boolean(window.__batchPrinted)), false);
  assert.match(await page.locator("#batchPrintStatus").textContent(), /標題超出 A4/);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 0);
});

for (const count of [3, 30, 100]) test(`Phase 7 ${count}-household Excel → edit → JSON → PDF integration`, async () => {
  const singleReport = await page.locator("#a4Sheet").innerHTML();
  await enter();
  await page.locator("#batchExcelFile").setInputFiles({ name: `phase7-${count}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await batchXlsx(count) });
  await page.waitForFunction((total) => document.querySelector("#batchSummary").textContent.includes(`共 ${total} 戶`), count);
  assert.equal(await rows().count(), count);
  assert.match(await rows().first().textContent(), /立源應補鄭啟明.*7,331/);
  await common("shared.caseName").fill("整合驗收建案");
  await edit(1);
  await individual("customer.doorplate").fill("修改後門牌2號");
  await individual("customer.buyer").fill("第二戶買方");
  await individual("customer.houseTax.payer").selectOption("seller");
  await individual("customer.note").fill("修改後個別備註2");
  assert.match(await rows().nth(1).textContent(), /14,727/);
  await page.locator("#batchCloseEditor").click();
  const before = await page.locator("#batchRows").textContent();
  const downloadPromise = page.waitForEvent("download"); await page.locator("#batchSaveCase").click();
  const json = join(output, `phase7-${count}.json`); await (await downloadPromise).saveAs(json);
  const saved = JSON.parse(await readFile(json, "utf8"));
  assert.equal(saved.data.rows.length, count);
  assert.equal(saved.data.rows[1].source.rowNumber, 5);
  assert.equal(saved.data.rows[1].values.customer.doorplate, "修改後門牌2號");
  assert.equal(saved.data.common.shared.caseName, "整合驗收建案");
  await common("shared.caseName").fill("暫時改動");
  await page.locator("#batchCaseFile").setInputFiles(json);
  await page.waitForFunction(() => document.querySelector("#batchCaseStatus").textContent.startsWith("已導入"));
  assert.equal(await common("shared.caseName").inputValue(), "整合驗收建案");
  assert.equal(await page.locator("#batchRows").textContent(), before);
  assert.match(await rows().first().textContent(), /立源應補鄭啟明.*7,331/);
  assert.match(await rows().nth(1).textContent(), /14,727/);
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.print = () => { window.__batchPrinted = true; }; });
  await clickBatchPrint();
  assert.equal(await page.evaluate(() => window.__batchPrinted), true);
  const titles = await page.locator("#batchReportHost h2").allTextContents();
  assert.equal(titles.length, count);
  assert.equal(titles[0], "第1戶（1號） 整合驗收建案");
  assert.equal(titles[1], "第2戶（修改後門牌2號） 整合驗收建案");
  const libraryRequire = createRequire(require.resolve(process.env.PRORATION_PLAYWRIGHT_PATH || "playwright"));
  const { PDFDocument } = libraryRequire("pdf-lib");
  const pdf = await page.pdf({ preferCSSPageSize: true });
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), count);
  await writeFile(join(output, `phase7-${count}.pdf`), pdf);
  await page.locator("#showSingleProration").click();
  assert.equal(await page.locator("#a4Sheet").innerHTML(), singleReport);
  assert.equal(await page.locator("#batchReportHost .batch-report-document").count(), 0);
  await page.locator("#showBatchProration").click();
  assert.equal(await page.locator("#batchSummary").textContent(), `共 ${count} 戶 · 正常 ${count} 戶 · 錯誤 0 戶 · 已勾選 ${count} 戶`);
});
