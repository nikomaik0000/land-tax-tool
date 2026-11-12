import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NOTE_EDITOR_PLAYWRIGHT_PATH || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
let server, browser, base;

before(async () => {
  server = createServer(async (request, response) => {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
    if (!path.startsWith(root)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(path);
      response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml" })[extname(path)] || "application/octet-stream");
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.NOTE_EDITOR_BROWSER_EXECUTABLE ? { executablePath: process.env.NOTE_EDITOR_BROWSER_EXECUTABLE, headless: true } : { channel: "chrome", headless: true });
});

after(async () => { await browser?.close(); await new Promise((done) => server?.close(done)); });

test("land-tax rich note editor keeps lists, bold, keyboard behavior, sizes and reload persistence", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/index.html`);
  await page.locator(".settings-accordion-header").click();
  assert.equal(await page.locator('[data-option="noteTextSize"][value="medium"]').isChecked(), true);
  assert.equal(await page.locator("#a4Sheet .report-notes-section .report-note-marker").count(), 0);
  assert.equal(await page.locator("#a4Sheet .report-clause-list .report-clause-title").first().textContent(), "增值稅自用需符合：");

  await page.locator("[data-add-custom-note]").click();
  const editor = page.locator("[data-custom-note-editor] .note-rich-editor").first();
  await editor.click(); await page.keyboard.type("第一項長文字自動折行測試內容".repeat(5));
  await page.locator("[data-custom-note-editor] [data-note-marker=bullet]").first().click();
  assert.equal(await editor.locator("ul[data-marker=bullet]").count(), 1, await editor.innerHTML());
  assert.equal(await editor.evaluate((element) => document.activeElement === element), true);
  await editor.locator("li").first().click();
  await editor.evaluate((element) => { const item = element.querySelector("li"); const range = document.createRange(); range.selectNodeContents(item); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  const selectionInfo = await editor.evaluate((element) => { const selection = getSelection(); return { node: selection.anchorNode?.nodeName, parent: selection.anchorNode?.parentElement?.tagName, offset: selection.anchorOffset, inside: element.contains(selection.anchorNode), html: element.innerHTML }; });
  assert.equal(selectionInfo.inside, true, JSON.stringify(selectionInfo));
  assert.equal(await editor.evaluate((element) => document.activeElement === element), true, JSON.stringify(selectionInfo));
  await editor.evaluate((element) => { window.__noteKeys = []; element.addEventListener("keydown", (event) => queueMicrotask(() => window.__noteKeys.push({ key: event.key, prevented: event.defaultPrevented }))); });
  await page.keyboard.press("Enter");
  assert.deepEqual(pageErrors, []);
  const keyInfo = await page.evaluate(() => window.__noteKeys);
  assert.deepEqual(keyInfo, [{ key: "Enter", prevented: true }], JSON.stringify({ keyInfo, selectionInfo }));
  assert.equal(await editor.locator("li").count(), 2, JSON.stringify({ selectionInfo, html: await editor.innerHTML() }));
  await page.keyboard.type("第二項");
  await page.keyboard.press("Shift+Enter"); await page.keyboard.type("同項手動換行");
  await page.keyboard.press("Enter");
  assert.equal(await editor.locator("li").count(), 3, await editor.innerHTML());
  assert.equal(await page.locator("#a4Sheet .report-rich-list-bullet li").count(), 2, "blank editor item stays out of the report preview");
  assert.equal((await page.evaluate(() => JSON.parse(sessionStorage.getItem("landTool.landTaxState")))).customNotes[0].contentDoc.blocks[0].items.length, 3, "preview filtering does not change contentDoc");
  await page.keyboard.press("Enter");
  assert.equal(await editor.locator("li").count(), 2, await editor.innerHTML());
  await page.keyboard.type("粗體文字與普通文字");
  await editor.evaluate((element) => { element.style.width = "180px"; });
  assert.equal(await editor.locator("li").count(), 2, "automatic wrapping never creates another list item");

  await editor.evaluate((element) => {
    const paragraph = element.querySelector("p:last-child"); const text = paragraph.firstChild; const range = document.createRange();
    range.setStart(text, 0); range.setEnd(text, 4); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.locator("[data-custom-note-editor] [data-note-bold]").first().click();
  assert.equal(await editor.locator("p strong").textContent(), "粗體文字");
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("landTool.landTaxState")));
  assert.equal(stored.customNotes[0].contentDoc.blocks[0].marker, "bullet");
  assert.equal(stored.customNotes[0].contentDoc.blocks[0].items.length, 2);
  assert.equal(stored.customNotes[0].contentDoc.blocks[0].items[1].runs.map((run) => run.text).join("").includes("\n同項手動換行"), true, JSON.stringify(stored.customNotes[0].contentDoc.blocks[0].items[1]));
  assert.equal(stored.customNotes[0].contentDoc.blocks[1].runs.some((run) => run.bold && run.text === "粗體文字"), true);
  assert.equal(await page.locator("#a4Sheet .report-custom-note-titleless .report-note-marker").count(), 0);
  assert.equal(await page.locator("#a4Sheet .report-custom-note-titleless .report-rich-list-bullet li").count(), 2);

  await page.locator("[data-add-custom-note]").click();
  const secondEditor = page.locator("[data-custom-note-editor] .note-rich-editor").nth(1);
  await secondEditor.fill("格式切換");
  const secondTools = page.locator("[data-custom-note-editor]").nth(1);
  await secondTools.locator("[data-note-marker=diamond]").click(); assert.equal(await secondEditor.locator("ul[data-marker=diamond]").count(), 1);
  await secondTools.locator("[data-note-marker=decimal]").click(); assert.equal(await secondEditor.locator("ol[data-marker=decimal]").count(), 1);
  await secondTools.locator("[data-note-marker=none]").click(); assert.equal(await secondEditor.locator("p").count(), 1);

  await page.locator("[data-add-custom-notice]").click();
  const noticeItem = page.locator("[data-custom-notice-id]").last();
  await noticeItem.locator("[data-custom-notice-title]").fill("自訂注意標題");
  await noticeItem.locator(".note-rich-editor").fill("自訂注意內容");

  const medium = await page.evaluate(() => ({
    noteBody: getComputedStyle(document.querySelector("#a4Sheet .report-custom-note-titleless .report-rich-content")).fontSize,
    fixedNotice: getComputedStyle(document.querySelector("#a4Sheet .report-notice-list > li")).fontSize,
    noteHeading: getComputedStyle(document.querySelector("#a4Sheet .report-notes-section h3")).fontSize,
    noticeHeading: getComputedStyle(document.querySelector("#a4Sheet .report-notices-section h3")).fontSize,
    customNoticeTitle: getComputedStyle(document.querySelector("#a4Sheet .report-custom-notice > .report-clause-title")).fontSize,
    table: getComputedStyle(document.querySelector("#a4Sheet .a4-land-table td")).fontSize
  }));
  assert.deepEqual(medium, { noteBody: "14px", fixedNotice: "14px", noteHeading: "16px", noticeHeading: "16px", customNoticeTitle: "16px", table: "10.25px" });

  await page.locator('[data-option="noteTextSize"][value="small"]').check();
  assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector("#a4Sheet .report-rich-content")).fontSize, getComputedStyle(document.querySelector("#a4Sheet .report-notes-section h3")).fontSize, getComputedStyle(document.querySelector("#a4Sheet .a4-land-table td")).fontSize]), ["12px", "14px", "10.25px"]);
  await page.locator('[data-option="noteTextSize"][value="large"]').check();
  assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector("#a4Sheet .report-rich-content")).fontSize, getComputedStyle(document.querySelector("#a4Sheet .report-notes-section h3")).fontSize, getComputedStyle(document.querySelector("#a4Sheet .a4-land-table td")).fontSize]), ["16px", "18px", "10.25px"]);

  await page.reload(); await page.locator(".settings-accordion-header").click();
  const reloadedEditor = page.locator("[data-custom-note-editor] .note-rich-editor").first();
  assert.equal(await reloadedEditor.locator("ul[data-marker=bullet] li").count(), 2);
  assert.equal(await reloadedEditor.locator("strong").textContent(), "粗體文字");
  assert.equal(await page.locator('[data-option="noteTextSize"][value="large"]').isChecked(), true);
  assert.equal(await page.locator("#a4Sheet .report-rich-list-bullet li").count(), 2);
  assert.equal(await page.locator("#a4Sheet strong").filter({ hasText: "粗體文字" }).count(), 1);
  await page.close();
});

test("transcript settings keep the legacy textarea and do not enable the rich editor", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/transcript.html`);
  await page.locator(".settings-accordion-header").evaluate((button) => button.click());
  await page.locator("[data-add-custom-note]").evaluate((button) => button.click());
  assert.equal(await page.locator("[data-custom-note-content]").count(), 1);
  assert.equal(await page.locator(".note-rich-editor, [data-option=noteTextSize]").count(), 0);
  await page.close();
});

test("legacy land-tax notes load as plain text with the medium size default", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    sessionStorage.setItem("landTool.landTaxState", JSON.stringify({
      caseName: "舊案件相容測試",
      displayOptions: { orientation: "landscape" },
      customNotes: [{ id: "legacy-note", enabled: true, title: "", content: "舊案件第一行\n舊案件第二行" }],
    }));
  });
  await page.goto(`${base}/index.html`);
  await page.locator(".settings-accordion-header").click();

  assert.equal(await page.locator('[data-option="noteTextSize"][value="medium"]').isChecked(), true);
  assert.equal(await page.locator("#a4Sheet .report-custom-note-titleless .report-note-marker").count(), 0);
  assert.equal(await page.locator("#a4Sheet .report-custom-note-titleless").innerText(), "舊案件第一行\n舊案件第二行");
  assert.equal(await page.locator("[data-custom-note-editor] .note-rich-editor").innerText(), "舊案件第一行\n舊案件第二行");
  await page.close();
});
