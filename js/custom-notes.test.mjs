import assert from "node:assert/strict";
import { renderA4Report } from "./a4-report-renderer.js";
import { createDefaultReportConfiguration } from "./report-settings.js";

const config = createDefaultReportConfiguration();
const state = {
  caseName: "測試", owners: [], houses: [], lands: [], house: {}, caseCurrentValue: 0,
  ...config,
  selectedClauses: ["selfUse", "houseLandTax", "post2016"],
  customNotes: [
    { id: "note-1", enabled: true, title: "", content: "第一行\n第二行" },
    { id: "note-2", enabled: true, title: "其他說明", content: "需再確認" },
    { id: "note-3", enabled: false, title: "隱藏", content: "不可出現" }
  ]
};
const html = renderA4Report(state, { richNotes: true }).html;
assert.doesNotMatch(html, /◆ 第一行/);
assert.match(html, /<div class="report-rich-content"><p>第一行<br>第二行<\/p><\/div>/);
assert.match(html, /class="report-note-heading report-plain-note-heading"><span class="report-clause-title">其他說明：<\/span>/);
assert.match(html, /class="report-note-heading report-plain-note-heading"><span class="report-clause-title">增值稅自用需符合：<\/span>/);
assert.doesNotMatch(html, /report-note-marker|>◆</, "land-tax rich notes never add a diamond marker");
assert.match(html, /<ol class="report-note-list"><li>一生一次。<\/li>/, "built-in numbered content is unchanged");
assert.match(html, /<div class="report-rich-content"><p>105年已實施房地合一稅/);
assert.match(html, /<div class="report-rich-content"><p>105年1月1日以後移轉取得/);
assert.match(html, /class="report-note-detail"><div class="report-rich-content"><p>需再確認<\/p><\/div><\/div>/);
assert.match(html, /class="report-note-detail"><ol class="report-note-list">/);
assert.doesNotMatch(html, /不可出現/);
assert.deepEqual(JSON.parse(JSON.stringify(state.customNotes)), state.customNotes);

const formatted = renderA4Report({ ...state, selectedClauses: [], customNotes: [{
  id: "formatted", enabled: true, title: "格式測試", content: "• 粗體項目\n1. 第二項", contentDoc: { version: 1, blocks: [
    { type: "list", marker: "bullet", items: [{ runs: [{ text: "粗體", bold: true }, { text: "項目", bold: false }] }] },
    { type: "list", marker: "decimal", items: [{ runs: [{ text: "第二項", bold: false }] }] }
  ] }
}] }, { richNotes: true }).html;
assert.match(formatted, /<ul class="report-rich-list report-rich-list-bullet"><li><strong>粗體<\/strong>項目<\/li><\/ul>/);
assert.match(formatted, /<ol class="report-rich-list report-rich-list-decimal"><li>第二項<\/li><\/ol>/);

const legacyHtml = renderA4Report(state).html;
assert.match(legacyHtml, /◆ 第一行\n第二行/, "shared renderer keeps the transcript legacy path unless rich notes are enabled");
assert.match(legacyHtml, /◆ 增值稅自用需符合：/, "transcript legacy built-in note style stays unchanged");
console.log("custom notes rendering tests passed");
