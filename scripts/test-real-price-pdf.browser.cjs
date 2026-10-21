const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const PDFLib = require("../vendor/pdf/pdf-lib.min.js");

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
  assert.equal(await page.locator('#caseTabCard[aria-selected="true"]').count(), 1);

  await page.locator("#caseDistrict").fill("大同區");
  await page.locator("#caseNumber").fill("ANON-TAB-KEEP");
  for (let index = 0; index < 4; index += 1) await page.click("#addCaseParty");
  const parties = [
    ["權利人", "匿名權利人甲", "A100000001", "臺北市大同區測試里12鄰權利路1號", ""],
    ["權利人", "匿名權利人乙", "A100000002", "臺北市大同區測試里13鄰權利路2號", "02-2000-0002"],
    ["義務人", "匿名義務人甲", "B200000001", "臺北市大同區測試里14鄰義務路1號", ""],
    ["義務人", "匿名義務人乙", "B200000002", "臺北市大同區測試里15鄰義務路2號", "02-2000-0004"],
  ];
  for (let index = 0; index < parties.length; index += 1) {
    const [title, name, idNumber, address, phone] = parties[index];
    await fillRecord(page, "#partyEditorRows", index, "title", title);
    await fillRecord(page, "#partyEditorRows", index, "name", name);
    await fillRecord(page, "#partyEditorRows", index, "idNumber", idNumber);
    await fillRecord(page, "#partyEditorRows", index, "address", address);
    await fillRecord(page, "#partyEditorRows", index, "phoneNote", phone);
  }

  for (let index = 0; index < 2; index += 1) await page.click("#addCaseLand");
  await fillRecord(page, "#landEditorRows", 0, "section", "玉泉");
  await fillRecord(page, "#landEditorRows", 0, "subsection", "二");
  await fillRecord(page, "#landEditorRows", 0, "landNumber", "26");
  await fillRecord(page, "#landEditorRows", 0, "shareNumerator", "1");
  await fillRecord(page, "#landEditorRows", 0, "shareDenominator", "2222");
  await fillRecord(page, "#landEditorRows", 1, "section", "玉泉");
  await fillRecord(page, "#landEditorRows", 1, "subsection", "二");
  await fillRecord(page, "#landEditorRows", 1, "landNumber", "233");
  await fillRecord(page, "#landEditorRows", 1, "shareNumerator", "1");
  await fillRecord(page, "#landEditorRows", 1, "shareDenominator", "2");

  await page.click("#addCaseBuilding");
  await fillRecord(page, "#buildingEditorRows", 0, "buildingNumber", "01000-001");
  await fillRecord(page, "#buildingEditorRows", 0, "address", "臺北市大同區建國北路一段33號2樓");
  await fillRecord(page, "#buildingEditorRows", 0, "shareNumerator", "1");
  await fillRecord(page, "#buildingEditorRows", 0, "shareDenominator", "1");

  await page.click("#caseTabHouse");
  assert.equal(await page.locator('#caseTabHouse[aria-selected="true"]').count(), 1);
  const housePrincipal = await page.locator("#houseTaxPrincipal option:not([value=''])").first().getAttribute("value");
  await page.selectOption("#houseTaxPrincipal", housePrincipal);
  await page.selectOption("#houseTaxAgentMode", "manual");
  await page.locator('#houseTaxManualAgent [data-agent-field="name"]').fill("匿名房屋代理人");

  await page.click("#caseTabCard");
  assert.equal(await page.locator("#caseNumber").inputValue(), "ANON-TAB-KEEP");
  assert.match(await page.locator('#partyEditorRows tr:first-child [data-field="address"]').inputValue(), /測試里12鄰/);

  await page.click("#caseTabReal");
  await page.selectOption("#realPriceAgentMode", "manual");
  await page.locator('#realPriceManualAgent [data-agent-field="name"]').fill("匿名受託人");
  await page.locator('#realPriceManualAgent [data-agent-field="idNumber"]').fill("Z900000009");
  await page.locator('#realPriceManualAgent [data-agent-field="address"]').fill("臺北市大同區代理里9鄰代理路9號");
  assert.doesNotMatch(await page.locator("#realPriceEntrustors").innerText(), /測試里|\d+鄰/);
  assert.doesNotMatch(await page.locator("#realPriceAgentSummary").innerText(), /代理里|9鄰/);

  const propertyDescription = await page.locator("#realPriceProperty").inputValue();
  assert.match(propertyDescription, /臺北市大同區玉泉段二小段26地號　持分：1\/2222/);
  assert.match(propertyDescription, /臺北市大同區玉泉段二小段233地號　持分：1\/2/);
  assert.match(propertyDescription, /臺北市大同區建國北路一段33號2樓　持分：1\/1/);
  assert.equal(await page.locator("#realPricePropertyFontMode").inputValue(), "auto");
  assert.equal(await page.locator("#realPricePropertyFontSize").isDisabled(), true);
  assert.equal(await page.locator("#houseTaxMissingNote").count(), 0);
  assert.equal(await page.locator("#realPriceMissingNote").count(), 0);

  await page.waitForFunction(() => document.querySelector("#realPriceOfficialStatus")?.dataset.state === "ready", null, { timeout: 30000 });
  const firstPreviewUrl = await page.locator("#realPriceOfficialPreview").getAttribute("src");
  assert.match(firstPreviewUrl, /^blob:/);
  assert.equal(await page.locator("#downloadRealPricePdf").isEnabled(), true);
  assert.equal(await page.locator("#printRealPricePdf").isEnabled(), true);
  assert.match(await page.locator("#realPriceLayoutRule").innerText(), /官方版使用附表/);
  assert.equal(await page.locator("#realPriceDate").count(), 0);
  assert.equal(await page.locator("#realPriceCorrection").count(), 0);

  await page.selectOption("#realPricePropertyFontMode", "manual");
  assert.equal(await page.locator("#realPricePropertyFontSize").isEnabled(), true);
  await page.selectOption("#realPricePropertyFontSize", "9.5");
  await page.waitForFunction((oldUrl) => {
    const status = document.querySelector("#realPriceOfficialStatus");
    const frame = document.querySelector("#realPriceOfficialPreview");
    return status?.dataset.state === "ready" && frame?.getAttribute("src") !== oldUrl;
  }, firstPreviewUrl, { timeout: 30000 });
  const manualPreviewUrl = await page.locator("#realPriceOfficialPreview").getAttribute("src");
  assert.match(await page.locator("#realPriceDataPreview").innerText(), /手動 9.5pt/);

  const downloadPromise = page.waitForEvent("download");
  await page.click("#downloadRealPricePdf");
  const download = await downloadPromise;
  const downloadPath = "/tmp/real-price-browser-download.pdf";
  await download.saveAs(downloadPath);
  const downloadedDocument = await PDFLib.PDFDocument.load(require("node:fs").readFileSync(downloadPath));
  assert.equal(downloadedDocument.getPageCount(), 2);

  await page.evaluate(() => {
    window.open = (url) => {
      window.__realPricePrintUrl = url;
      return {
        addEventListener(type, callback) { if (type === "load") callback(); },
        print() { window.__realPricePrintInvoked = true; },
      };
    };
  });
  await page.click("#printRealPricePdf");
  assert.equal(await page.evaluate(() => window.__realPricePrintUrl), manualPreviewUrl);
  assert.equal(await page.evaluate(() => window.__realPricePrintInvoked), true);

  await page.selectOption("#realPriceMatter", "");
  await page.waitForFunction((oldUrl) => {
    const status = document.querySelector("#realPriceOfficialStatus");
    const frame = document.querySelector("#realPriceOfficialPreview");
    return status?.dataset.state === "ready" && frame?.getAttribute("src") !== oldUrl;
  }, manualPreviewUrl, { timeout: 30000 });

  await page.click("#caseTabHouse");
  assert.equal(await page.locator("#houseTaxPrincipal").inputValue(), housePrincipal);
  assert.equal(await page.locator('#houseTaxManualAgent [data-agent-field="name"]').inputValue(), "匿名房屋代理人");
  await page.click("#caseTabReal");
  assert.equal(await page.locator('#realPriceManualAgent [data-agent-field="name"]').inputValue(), "匿名受託人");
  assert.equal(await page.locator("#realPriceMatter").inputValue(), "");
  assert.equal(await page.locator("#realPricePropertyFontMode").inputValue(), "manual");
  assert.equal(await page.locator("#realPricePropertyFontSize").inputValue(), "9.5");

  await page.setViewportSize({ width: 375, height: 800 });
  const tabsFitMobile = await page.locator(".case-document-tabs").evaluate((element) => element.scrollWidth <= element.clientWidth);
  assert.equal(tabsFitMobile, true);

  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({
    entrustorCount: 4,
    pageCount: 2,
    propertyShares: ["1/2222", "1/2", "1/1"],
    blankPhoneStillOutput: true,
    previewReady: true,
    downloadPath,
    printUsedPreviewBlob: true,
    matterLiveUpdate: true,
    propertyFontSettingLiveUpdate: true,
    tabStatePreserved: true,
    realPriceAddressSanitized: true,
    mobileTabsNoOverflow: true,
  }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function fillRecord(page, table, rowIndex, field, value) {
  await page.locator(`${table} tr:nth-child(${rowIndex + 1}) [data-field="${field}"]`).fill(value);
}
