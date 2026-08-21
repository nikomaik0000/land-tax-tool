import assert from "node:assert/strict";
import { renderA4Report } from "./a4-report-renderer.js";
import { createDefaultReportConfiguration } from "./report-settings.js";

const config = createDefaultReportConfiguration();
const state = {
  caseName: "測試", owners: [], houses: [], lands: [], house: {}, caseCurrentValue: 0,
  ...config,
  selectedClauses: ["selfUse"],
  customNotes: [
    { id: "note-1", enabled: true, title: "", content: "第一行\n第二行" },
    { id: "note-2", enabled: true, title: "其他說明", content: "需再確認" },
    { id: "note-3", enabled: false, title: "隱藏", content: "不可出現" }
  ]
};
const html = renderA4Report(state).html;
assert.match(html, /◆ 第一行\n第二行/);
assert.match(html, /◆ 其他說明：/);
assert.match(html, /class="report-note-detail">需再確認<\/div>/);
assert.match(html, /class="report-note-detail"><ol class="report-note-list">/);
assert.doesNotMatch(html, /不可出現/);
assert.deepEqual(JSON.parse(JSON.stringify(state.customNotes)), state.customNotes);
console.log("custom notes rendering tests passed");
