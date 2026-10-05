import assert from "node:assert/strict";
import { renderA4Report } from "./a4-report-renderer.js";
import { createDefaultReportConfiguration } from "./report-settings.js";
import { getVisibleNotices, noticeDefinitions } from "./notices.js";

const config = createDefaultReportConfiguration();
const base = {
  caseName: "注意事項測試", owners: [], houses: [], lands: [], house: {}, caseCurrentValue: 0,
  ...config, selectedClauses: [], customNotes: []
};
const render = (overrides = {}) => renderA4Report({ ...base, ...overrides }).html;

assert.equal(noticeDefinitions.length, 3);
assert.equal(noticeDefinitions.some((notice) => /^\d+\./.test(notice.text)), false, "fixed notice text never stores numbering");
assert.doesNotMatch(render({ displayOptions: { ...base.displayOptions, showNotices: false } }), /<h3>注意事項<\/h3>/, "CASE A: master switch hides the section");

const onlyOneAndThree = {
  ...base.displayOptions,
  noticeItems: { selfUseRequiresSale: true, giftNoSelfUse: false, giftTaxDeduction: true }
};
const selectedHtml = render({ displayOptions: onlyOneAndThree });
assert.equal((selectedHtml.match(/<li>/g) ?? []).length, 2);
assert.match(selectedHtml, /<ol class="report-notice-list"><li>增值稅自用/);
assert.match(selectedHtml, /<\/li><li>贈與辦理時/, "CASE B: fixed items 1 and 3 are dynamically numbered 1 and 2");

const secondOnlyHtml = render({ displayOptions: { ...base.displayOptions, noticeItems: { selfUseRequiresSale: false, giftNoSelfUse: true, giftTaxDeduction: false } } });
assert.equal((secondOnlyHtml.match(/<li>/g) ?? []).length, 1);
assert.match(secondOnlyHtml, /<ol class="report-notice-list"><li>移轉如以贈與辦理/, "CASE C: original second item becomes number 1");

const noFixed = { ...base.displayOptions, noticeItems: { selfUseRequiresSale: false, giftNoSelfUse: false, giftTaxDeduction: false } };
const customOnly = [{ id: "notice-a", enabled: true, title: "付款方式", content: "第一行\n第二行" }];
const customOnlyHtml = render({ displayOptions: noFixed, customNotices: customOnly });
assert.match(customOnlyHtml, /<h3>注意事項<\/h3>/);
assert.match(customOnlyHtml, /<li class="report-custom-notice"><span class="report-clause-title">付款方式<\/span>/);
assert.match(customOnlyHtml, /第一行\n第二行/, "CASE C: enabled multiline custom notice renders");

const mixedCustom = [
  { id: "notice-a", enabled: true, title: "自訂 A", content: "內容 A" },
  { id: "notice-b", enabled: true, title: "自訂 B", content: "內容 B" }
];
const mixedHtml = render({ displayOptions: onlyOneAndThree, customNotices: mixedCustom });
assert.deepEqual(getVisibleNotices({ displayOptions: onlyOneAndThree, customNotices: mixedCustom }).map((item) => item.id), ["selfUseRequiresSale", "giftTaxDeduction", "notice-a", "notice-b"], "CASE D: fixed notices precede custom notices in one sequence");
assert.equal((mixedHtml.match(/<li/g) ?? []).length, 4);

assert.deepEqual(getVisibleNotices({ displayOptions: noFixed, customNotices: mixedCustom }).map((item) => item.id), ["notice-a", "notice-b"], "CASE E: custom-only sequence starts at 1");

const disabledHtml = render({ displayOptions: noFixed, customNotices: [{ ...customOnly[0], enabled: false }] });
assert.doesNotMatch(disabledHtml, /<h3>注意事項<\/h3>/, "CASE F: empty notice section is omitted");

const saved = JSON.parse(JSON.stringify({ displayOptions: onlyOneAndThree, customNotices: customOnly }));
assert.deepEqual(saved.displayOptions.noticeItems, onlyOneAndThree.noticeItems);
assert.deepEqual(saved.customNotices, customOnly, "CASE E: notice state survives case JSON serialization");
assert.deepEqual(getVisibleNotices({ displayOptions: onlyOneAndThree, customNotices: customOnly }).map((item) => item.id), ["selfUseRequiresSale", "giftTaxDeduction", "notice-a"]);

console.log("notice section regression: cases A-F passed");
