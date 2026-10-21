const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const baseUrl = process.env.CASE_DOCUMENTS_URL || "http://127.0.0.1:8766/case-documents.html";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.clear());
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const sharedTool = page.locator(".shared-workspace-tool").first();
  assert.deepEqual(await sharedTool.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
  }), ["0px", "0px", "0px", "0px"]);
  await sharedTool.locator("summary").click();
  assert.equal(await sharedTool.getAttribute("open"), "");
  assert.equal(await sharedTool.locator("summary").evaluate((element) => getComputedStyle(element).borderBottomWidth), "0px");
  assert.equal(await sharedTool.locator("summary").evaluate((element) => getComputedStyle(element).fontSize), "15px");
  assert.equal(await sharedTool.locator(".section-heading h2").count(), 0);
  assert.match(await sharedTool.locator(".shared-workspace-description").innerText(), /名單只保存在這台裝置/);
  await sharedTool.locator("summary").click();

  const land = [
    "LOC_NM=TESTDISTTEST00001000",
    "TRAN_REAS=21",
    "TRAN_AREA=10",
    "TRAN_RATE_NMRT=1",
    "TRAN_RATE_DNT=2",
    "PRES=0",
    "O_HOLDERS=1",
    "OIDN_BAN_1=B200000001",
    "OIDN_NM_1=SELLER",
    "O_HOLDER_CADDR_1=SELLER ADDRESS",
    "N_HOLDERS=1",
    "NIDN_BAN_1=A100000001",
    "NIDN_NM_1=BUYER",
    "N_HOLDER_CADDR_1=BUYER ADDRESS",
  ].join("\n");
  const building = [
    "MAIN_BUILD_NO=00001000",
    "HOU_LOC=BUILDING ADDRESS 1",
    "HOU_FLOORs=1",
    "HOU_FLOOR_NO_1=FLOOR 1",
    "HOU_AREA_1=80",
    "PUB_FACs=0",
    "O_HOLDERS=1",
    "O_HOLDER_IDN_BAN_1=B200000001",
    "O_HOLDER_NM_1=SELLER",
    "N_HOLDERS=1",
    "N_HOLDER_IDN_BAN_1=A100000001",
    "N_HOLDER_NM_1=BUYER",
    "N_HOLDER_TRAN_NMRT_1=1",
    "N_HOLDER_TRAN_DNT_1=1",
  ].join("\n");

  await page.locator("#caseCsvFiles").setInputFiles([
    { name: "anonymous-land.csv", mimeType: "text/plain", buffer: Buffer.from(land) },
    { name: "anonymous-building.csv", mimeType: "text/plain", buffer: Buffer.from(building) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll("#partyEditorRows tr").length === 2);
  assert.equal(await page.locator("#caseImportedFileCount").innerText(), "目前共 2 份唯一檔案。");
  assert.equal(await page.locator("#landEditorRows tr").count(), 1);
  assert.equal(await page.locator("#buildingEditorRows tr").count(), 1);
  for (const table of [".party-editor-table", ".land-editor-table", ".building-editor-table", ".common-editor-table"]) {
    const fits = await page.locator(table).evaluate((element) => element.closest(".case-editor-scroll").scrollWidth <= element.closest(".case-editor-scroll").clientWidth + 1);
    assert.equal(fits, true, `${table} should fit the desktop editor container`);
  }

  await page.click("#caseTabHouse");
  assert.deepEqual(await page.locator("#houseTaxPrincipal option:not([value=''])").allTextContents(), ["SELLER｜B200000001"]);
  assert.match(await page.locator("#houseTaxBuildings").innerText(), /BUILDING ADDRESS 1/);

  await page.click("#caseTabReal");
  assert.match(await page.locator("#realPriceEntrustors").innerText(), /BUYER/);
  assert.match(await page.locator("#realPriceEntrustors").innerText(), /SELLER/);
  assert.match(await page.locator("#realPriceProperty").inputValue(), /BUILDING ADDRESS 1/);

  await page.click("#caseTabCard");
  assert.equal(await page.locator("#partyEditorRows tr").count(), 2);
  assert.equal(await page.locator("#caseImportedFileCount").innerText(), "目前共 2 份唯一檔案。");

  const routes = ["index.html", "proration.html", "transcript.html", "land-value-update.html", "land-number-converter.html", "zoning.html", "case-documents.html"];
  const origin = new URL(baseUrl).origin;
  const desktopAlignments = [];
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(`${origin}/${route}`, { waitUntil: "domcontentloaded" });
      const metrics = await page.locator(".app-container").evaluate((element) => ({
        maxWidth: getComputedStyle(element).maxWidth,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        paddingLeft: getComputedStyle(element).paddingLeft,
        paddingRight: getComputedStyle(element).paddingRight,
        headerAligned: element.firstElementChild?.classList.contains("site-header") || false,
        pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      }));
      assert.equal(metrics.maxWidth, "1240px", `${route} should use the shared content width`);
      assert.equal(metrics.headerAligned, true, `${route} header should share the main container`);
      assert.equal(metrics.pageFits, true, `${route} should not overflow at ${width}px`);
      assert.equal(metrics.paddingLeft, metrics.paddingRight, `${route} should use symmetric inline padding`);
      if (width >= 1280) desktopAlignments.push({ width, route, ...metrics });
    }
  }

  for (const width of [1440, 1280]) {
    const group = desktopAlignments.filter((item) => item.width === width);
    assert.equal(new Set(group.map((item) => item.left)).size, 1, `all pages should share the same left edge at ${width}px`);
    assert.equal(new Set(group.map((item) => item.right)).size, 1, `all pages should share the same right edge at ${width}px`);
    assert.equal(new Set(group.map((item) => item.paddingLeft)).size, 1, `all pages should share the same padding at ${width}px`);
  }

  console.log(JSON.stringify({ collapsibleBordersRemoved: true, duplicateCollapsibleHeadingsRemoved: true, desktopEditorTablesFit: true, sharedSiteWidth: "1240px", responsivePagesChecked: routes.length, viewportWidthsChecked: 4, pageEdgesAligned: true, importedOnce: true, sharedCaseAcrossTabs: true, partyCount: 2, landCount: 1, buildingCount: 1 }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
