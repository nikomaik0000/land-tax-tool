import assert from "node:assert/strict";
import {
  normalizeNoteDocument,
  noteDocumentToPlainText,
  noteHasContent,
  plainTextToNoteDocument,
  renderNoteDocument
} from "./note-editor.js";

const legacy = plainTextToNoteDocument("第一行\n第二行\n1. 保留原編號");
assert.equal(noteDocumentToPlainText(legacy), "第一行\n第二行\n1. 保留原編號");
assert.match(renderNoteDocument(undefined, "第一行\n第二行"), /第一行<br>第二行/);

const formatted = { version: 1, blocks: [
  { type: "paragraph", runs: [{ text: "一般", bold: false }, { text: "粗體", bold: true }] },
  { type: "list", marker: "diamond", items: [{ runs: [{ text: "菱形項目\n同項換行", bold: false }] }] },
  { type: "list", marker: "decimal", items: [{ runs: [{ text: "自動編號", bold: true }] }, { runs: [{ text: "第二項", bold: false }] }] }
] };
assert.equal(noteDocumentToPlainText(formatted), "一般粗體\n◆ 菱形項目\n同項換行\n1. 自動編號\n2. 第二項");
const html = renderNoteDocument(formatted);
assert.match(html, /一般<strong>粗體<\/strong>/);
assert.match(html, /report-rich-list-diamond/);
assert.match(html, /菱形項目<br>同項換行/);
assert.match(html, /<ol class="report-rich-list report-rich-list-decimal"><li><strong>自動編號<\/strong><\/li><li>第二項<\/li><\/ol>/);
assert.equal(noteHasContent({ contentDoc: formatted, content: "" }), true);

const malicious = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "<img src=x onerror=alert(1)><script>bad()</script>", bold: true }] }] };
const safe = renderNoteDocument(malicious);
assert.doesNotMatch(safe, /<(?:img|script)\b/);
assert.match(safe, /&lt;img src=x onerror=alert\(1\)&gt;/);

const invalid = normalizeNoteDocument({ version: 1, blocks: [{ type: "html", value: "<b>bad</b>" }] }, "安全備援");
assert.equal(noteDocumentToPlainText(invalid), "安全備援");
assert.equal(noteHasContent({ content: " \n " }), false);

const blankListItems = { version: 1, blocks: [
  { type: "list", marker: "decimal", items: [
    { runs: [{ text: "第一項", bold: false }] },
    { runs: [{ text: " \n\u200b ", bold: true }] },
    { runs: [{ text: "第三項", bold: false }] }
  ] },
  { type: "list", marker: "diamond", items: [{ runs: [{ text: "\n  ", bold: false }] }] }
] };
const blankListItemsSnapshot = JSON.parse(JSON.stringify(blankListItems));
const blankFilteredHtml = renderNoteDocument(blankListItems);
assert.match(blankFilteredHtml, /<ol class="report-rich-list report-rich-list-decimal"><li>第一項<\/li><li>第三項<\/li><\/ol>/);
assert.doesNotMatch(blankFilteredHtml, /report-rich-list-diamond/);
assert.equal((blankFilteredHtml.match(/<li>/g) ?? []).length, 2, "blank list items are omitted only from rendered output");
assert.deepEqual(blankListItems, blankListItemsSnapshot, "rendering never mutates contentDoc");

const roundTrip = JSON.parse(JSON.stringify(formatted));
assert.deepEqual(normalizeNoteDocument(roundTrip), formatted);
console.log("structured note editor model and sanitization tests passed");
