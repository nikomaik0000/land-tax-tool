import assert from "node:assert/strict";
import { formatLandNumber } from "./formatters.js";
import { parseNormalizedTextItems } from "./pdf-parser.js";

function item(text, x, y) {
  return { text, normalizedText: text.normalize("NFKC").replace(/\s/g, ""), x, y, width: 80, height: 12, page: 1 };
}

function parseTaipeiDistrict(cityLineItems) {
  const items = [
    ...cityLineItems,
    item("(0223)學府段三小段", 40, 650),
    item("0436-0000地號", 40, 600)
  ];
  return parseNormalizedTextItems(items, "taipei.pdf").lands[0];
}

for (const cityText of ["臺北市 (02)大安區", "臺北市(02)大安區", "台北市 （02）大安區", "臺北市( 02 )大安區"]) {
  const land = parseTaipeiDistrict([item(cityText, 40, 700)]);
  assert.equal(land.city, "臺北市");
  assert.equal(land.district, "大安");
  assert.equal(land.section, "學府");
  assert.equal(land.subsection, "三");
  assert.equal(formatLandNumber(land.landNumber), "436");
}

const splitLand = parseTaipeiDistrict([item("臺北市", 40, 700), item("(02)", 100, 704), item("士林區", 145, 697)]);
assert.equal(splitLand.city, "臺北市");
assert.equal(splitLand.district, "士林");

for (const district of ["中正", "大同", "中山", "松山", "大安", "萬華", "信義", "士林", "北投", "內湖", "南港", "文山"]) {
  assert.equal(parseTaipeiDistrict([item(`臺北市(01)${district}區`, 40, 700)]).district, district);
}

const newTaipeiLand = parseNormalizedTextItems([item("新北市板橋區", 40, 700), item("文化段", 40, 650), item("0001-0000地號", 40, 600)], "new-taipei.pdf").lands[0];
assert.equal(newTaipeiLand.city, "");
assert.equal(newTaipeiLand.district, "板橋");
console.log("Taipei district parser regression tests passed");
