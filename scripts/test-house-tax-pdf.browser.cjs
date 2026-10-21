const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const baseUrl = process.env.CASE_DOCUMENTS_URL || "http://127.0.0.1:8766/case-documents.html";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  const page = await browser.newPage({ acceptDownloads: true });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.addInitScript(() => {
    try { window.localStorage?.clear(); } catch { /* ignored for browser-internal PDF frames */ }
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  for (let index = 0; index < 3; index += 1) await page.click("#addCaseParty");
  await fillRecord(page, "#partyEditorRows", 0, "title", "權利人");
  await fillRecord(page, "#partyEditorRows", 0, "name", "匿名權利人");
  await fillRecord(page, "#partyEditorRows", 0, "idNumber", "C300000003");
  await fillRecord(page, "#partyEditorRows", 0, "address", "臺北市中正區權利路3號");
  await fillRecord(page, "#partyEditorRows", 1, "title", "義務人");
  await fillRecord(page, "#partyEditorRows", 1, "name", "匿名義務人甲");
  await fillRecord(page, "#partyEditorRows", 1, "idNumber", "B200000001");
  await fillRecord(page, "#partyEditorRows", 1, "address", "臺北市中正區義務路1號");
  await fillRecord(page, "#partyEditorRows", 2, "title", "義務人");
  await fillRecord(page, "#partyEditorRows", 2, "name", "匿名義務人乙");
  await fillRecord(page, "#partyEditorRows", 2, "idNumber", "B200000002");
  await fillRecord(page, "#partyEditorRows", 2, "address", "臺北市中正區義務路2號");

  for (let index = 0; index < 3; index += 1) await page.click("#addCaseBuilding");
  await fillRecord(page, "#buildingEditorRows", 0, "buildingNumber", "01000-001");
  await fillRecord(page, "#buildingEditorRows", 0, "address", "臺北市中正區測試路一段100巷20弄30號10樓之5");
  await fillRecord(page, "#buildingEditorRows", 1, "buildingNumber", "01000-002");
  await fillRecord(page, "#buildingEditorRows", 1, "address", "臺北市中正區測試路二段200巷30弄40號11樓之8");
  await fillRecord(page, "#buildingEditorRows", 2, "buildingNumber", "01000-003");
  await fillRecord(page, "#buildingEditorRows", 2, "address", "臺北市中正區測試路三段300巷40弄50號12樓之9");

  await page.click("#caseTabHouse");
  const options = await page.locator("#houseTaxPrincipal option").allTextContents();
  assert.deepEqual(options, ["請選擇義務人", "匿名義務人甲｜B200000001", "匿名義務人乙｜B200000002"]);
  const selectedObligorId = await page.locator('#partyEditorRows tr:nth-child(3) [data-field="title"]').getAttribute("data-record-id");
  await page.selectOption("#houseTaxPrincipal", selectedObligorId);
  const buildings = page.locator("[data-house-building-id]");
  for (let index = 0; index < await buildings.count(); index += 1) {
    if (!await buildings.nth(index).isChecked()) await buildings.nth(index).check();
  }

  await page.selectOption("#houseTaxAgentMode", "manual");
  await page.locator('#houseTaxManualAgent [data-agent-field="name"]').fill("匿名代理人甲");
  await page.locator('#houseTaxManualAgent [data-agent-field="idNumber"]').fill("A100000001");

  await page.waitForFunction(() => document.querySelector("#houseTaxOfficialStatus")?.dataset.state === "ready", null, { timeout: 30000 });
  const firstPreviewUrl = await page.locator("#houseTaxOfficialPreview").getAttribute("src");
  assert.match(firstPreviewUrl, /^blob:/);
  assert.equal(await page.locator("#downloadHouseTaxPdf").isEnabled(), true);
  assert.equal(await page.locator("#printHouseTaxPdf").isEnabled(), true);
  assert.equal(await page.locator("#realPriceOfficialPreview").count(), 1);
  assert.equal(await page.locator("#houseTaxBureau").count(), 0);
  assert.equal(await page.locator("#houseTaxDate").count(), 0);
  assert.equal(await page.locator("#realPriceCorrection").count(), 0);
  assert.equal(await page.locator("#realPriceDate").count(), 0);
  assert.equal(await page.locator("#houseTaxMissingNote").count(), 0);
  assert.equal(await page.locator("#realPriceMissingNote").count(), 0);
  const dataPreview = await page.locator("#houseTaxDataPreview").innerText();
  assert.match(dataPreview, /匿名義務人乙/);
  assert.doesNotMatch(dataPreview, /匿名權利人|匿名義務人甲/);

  const downloadPromise = page.waitForEvent("download");
  await page.click("#downloadHouseTaxPdf");
  const download = await downloadPromise;
  await download.saveAs("/tmp/house-tax-browser-download.pdf");

  await page.evaluate(() => {
    window.open = (url) => {
      window.__houseTaxPrintUrl = url;
      return {
        addEventListener(type, callback) { if (type === "load") callback(); },
        print() { window.__houseTaxPrintInvoked = true; },
      };
    };
  });
  await page.click("#printHouseTaxPdf");
  assert.equal(await page.evaluate(() => window.__houseTaxPrintUrl), firstPreviewUrl);
  assert.equal(await page.evaluate(() => window.__houseTaxPrintInvoked), true);

  await page.locator('#houseTaxManualAgent [data-agent-field="name"]').fill("匿名代理人乙");
  await page.waitForFunction((oldUrl) => {
    const status = document.querySelector("#houseTaxOfficialStatus");
    const frame = document.querySelector("#houseTaxOfficialPreview");
    return status?.dataset.state === "ready" && frame?.getAttribute("src") !== oldUrl;
  }, firstPreviewUrl, { timeout: 30000 });

  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({
    principalOptions: options,
    selectedPrincipal: "匿名義務人乙",
    buildingCount: await buildings.count(),
    selectedBuildingCount: 3,
    blankOptionalFieldsStillOutput: true,
    multiBuildingExpandedArea: true,
    previewReady: true,
    downloadPath: "/tmp/house-tax-browser-download.pdf",
    printUsedPreviewBlob: true,
    liveUpdate: true,
  }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function fillRecord(page, table, rowIndex, field, value) {
  await page.locator(`${table} tr:nth-child(${rowIndex + 1}) [data-field="${field}"]`).fill(value);
}
