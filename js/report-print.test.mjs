import assert from "node:assert/strict";
import test from "node:test";
import { createReportPrinter, renderReportShell } from "./report-print.js";
import { expandResultRows } from "./land-number-converter-core.js";

test("公告現值 report renders every normalized result row", () => {
  const rows = [{ city: "臺北市" }, { city: "新北市" }];
  const html = renderReportShell({ title: "公告現值查詢結果", columns: [{ label: "縣市", key: "city" }], rows });
  assert.equal((html.match(/<tbody>[\s\S]*<tr>/g)?.[0].match(/<tr>/g) ?? []).length, 2);
});

test("新舊地號 report source keeps every one-to-many mapping", () => {
  const records = [{ city: "臺北市", status: "multiple", matches: [
    { districtNew: "內湖", sectionNew: "碧湖", subsectionNew: "", landNumberNew: "1" },
    { districtNew: "內湖", sectionNew: "碧湖", subsectionNew: "", landNumberNew: "2" }
  ] }];
  assert.equal(expandResultRows(records, "old-to-new").length, 2);
});

test("zoning report preserves and escapes long zoning text", () => {
  const zoning = "第參種商業區(依都市計畫說明書圖規定辦理,始得作第參種商業區使用)(原屬第貳種商業區) & 其他";
  const html = renderReportShell({ title: "土地使用分區查詢結果", columns: [{ label: "使用分區", key: "zoning", className: "report-long-text" }], rows: [{ zoning }] });
  assert.match(html, /第參種商業區/);
  assert.match(html, /&amp; 其他/);
  assert.match(html, /report-long-text/);
});

test("all three pages prevent empty printing by disabling print buttons initially", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["land-value-update.html", "land-number-converter.html", "zoning.html"]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /id="print[^\"]*"[^>]*disabled/);
  }
});

test("shared printer prevents an empty report", () => {
  const host = { innerHTML: "stale", className: "" }; const pageStyle = { textContent: "" }; let warning = "";
  const printer = createReportPrinter({ host, pageStyle, getOrientation: () => "portrait", getReport: () => ({}), getRowCount: () => 0, onEmpty: (message) => { warning = message; } });
  assert.equal(printer.print(), false);
  assert.equal(host.innerHTML, "");
  assert.equal(warning, "目前沒有可列印的查詢結果。");
});
