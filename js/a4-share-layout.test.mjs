import assert from "node:assert/strict";
import test from "node:test";
import { formatShareForPrint, renderA4Report } from "./a4-report-renderer.js";
import { createDefaultReportConfiguration } from "./report-settings.js";

test("share print layout defaults to single-line", () => {
  assert.equal(createDefaultReportConfiguration().displayOptions.sharePrintLayout, "single-line");
});

test("single-line keeps Taipei and New Taipei shares on one explicit line", () => {
  for (const [numerator, denominator] of [[112, 14400], [112, 72000], [91, 144000], [190, 144000], [367, 144000]]) {
    const html = formatShareForPrint(numerator, denominator, "single-line");
    assert.match(html, /report-share-single-line/);
    assert.match(html, new RegExp(`${numerator} / ${denominator}`));
    assert.doesNotMatch(html, /report-share-two-line/);
  }
});

test("two-line uses two explicit spans for every denominator size", () => {
  for (const [numerator, denominator] of [[112, 14400], [112, 72000], [91, 144000], [190, 144000], [367, 144000], [1, 15]]) {
    assert.equal(
      formatShareForPrint(numerator, denominator, "two-line"),
      `<span class="report-share report-share-two-line"><span>${numerator} /</span><span>${denominator}</span></span>`
    );
  }
});

test("A4 table exposes the selected share layout for deterministic column widths", () => {
  const configuration = createDefaultReportConfiguration();
  configuration.displayOptions.sharePrintLayout = "two-line";
  const state = { caseName: "test", lands: [], houses: [], caseCurrentValue: 0, ...configuration };
  assert.match(renderA4Report(state).html, /share-layout-two-line/);
});
