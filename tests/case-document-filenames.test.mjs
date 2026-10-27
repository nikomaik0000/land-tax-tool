import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  caseCardPdfFilename,
  caseDataJsonFilename,
  houseTaxPdfFilename,
  realPricePdfFilename,
  realPriceZipFilename,
} from "../js/case-document-filenames.js";

test("案件資料卡依義務人、權利人排序，多人以頓號連接並去重", () => {
  const parties = [
    { title: "權利人", name: "買方甲" },
    { title: "義務人", name: "賣方甲" },
    { title: "義務人", name: "賣方乙" },
    { title: "權利人", name: "買方甲" },
    { title: "權利人", name: "買方乙" },
  ];
  assert.equal(caseCardPdfFilename(parties), "案件資料卡_賣方甲、賣方乙X買方甲、買方乙.pdf");
});

test("房屋稅籍申請書使用選定義務人並清理非法字元", () => {
  assert.equal(houseTaxPdfFilename({ principal: { name: "賣/方:甲" } }), "房屋稅籍申請書_賣_方_甲.pdf");
  assert.equal(houseTaxPdfFilename({}), "房屋稅籍申請書.pdf");
});

test("實價登錄委托書使用義務人 X 權利人且缺一方時不留下多餘分隔符", () => {
  assert.equal(realPricePdfFilename({ entrustors: [
    { title: "權利人", name: "買方甲" },
    { title: "義務人", name: "賣方甲" },
  ] }), "實價登錄委托書_賣方甲X買方甲.pdf");
  assert.equal(realPricePdfFilename({ entrustors: [{ title: "權利人", name: "買方甲" }] }), "實價登錄委托書_買方甲.pdf");
  assert.equal(realPricePdfFilename(), "實價登錄委托書.pdf");
});

test("政府申報 ZIP 外層使用賣方、買方姓名", () => {
  assert.equal(realPriceZipFilename({
    sellers: [{ name: "賣方甲" }, { name: "賣方乙" }],
    buyers: [{ name: "買方甲" }, { name: "買方乙" }],
  }), "實價登錄_賣方甲、賣方乙X買方甲、買方乙.zip");
  assert.equal(realPriceZipFilename({ sellers: [], buyers: [] }), "實價登錄.zip");
});

test("案件資料卡列印前設定檔名標題，列印後恢復原網頁標題", async () => {
  const source = await readFile(new URL("../js/case-documents-app.js", import.meta.url), "utf8");
  assert.match(source, /document\.title = caseCardPdfFilename\(state\.parties\)/);
  assert.match(source, /addEventListener\("afterprint"[\s\S]*restoreTitle\(\)/);
});

test("政府申報 ZIP 只改外層名稱，內部仍使用 RPS0401 候選 JSON 名稱", async () => {
  const source = await readFile(new URL("../js/real-price-filing-app.js", import.meta.url), "utf8");
  assert.match(source, /createSingleFileZip\(`\$\{basename\}\.json`, jsonText\)/);
  assert.match(source, /realPriceZipFilename\(draft\)/);
});

test("兩份正式 PDF 的下載控制器使用共用檔名規則", async () => {
  const [houseSource, realPriceSource] = await Promise.all([
    readFile(new URL("../js/house-tax-pdf-app.js", import.meta.url), "utf8"),
    readFile(new URL("../js/real-price-pdf-app.js", import.meta.url), "utf8"),
  ]);
  assert.match(houseSource, /currentFilename = houseTaxPdfFilename\(preview\)/);
  assert.match(realPriceSource, /currentFilename = realPricePdfFilename\(preview\)/);
  assert.match(houseSource, /link\.download = currentFilename/);
  assert.match(realPriceSource, /link\.download = currentFilename/);
});

test("五種姓名檔名均移除半形、全形及 Unicode 空白，案件 JSON 維持權利人 X 義務人順序", () => {
  const parties = [
    { title: "義務人", name: "簡 建　興" },
    { title: "權利人", name: "簡\u2009敬\u200B恆" },
  ];
  const preview = { entrustors: parties };
  const draft = { sellers: [{ name: "簡 建　興" }], buyers: [{ name: "簡\u2009敬\u200B恆" }] };
  const date = new Date(2026, 9, 27);

  assert.equal(caseCardPdfFilename(parties), "案件資料卡_簡建興X簡敬恆.pdf");
  assert.equal(houseTaxPdfFilename({ principal: parties[0] }), "房屋稅籍申請書_簡建興.pdf");
  assert.equal(realPricePdfFilename(preview), "實價登錄委托書_簡建興X簡敬恆.pdf");
  assert.equal(realPriceZipFilename(draft), "實價登錄_簡建興X簡敬恆.zip");
  assert.equal(caseDataJsonFilename(parties, date), "簡敬恆X簡建興_案件資料_2026-10-27.json");
});

test("案件 JSON 姓名皆缺漏時使用安全預設名稱", () => {
  assert.equal(caseDataJsonFilename([], new Date(2026, 9, 27)), "案件資料_2026-10-27.json");
});
