import { readFile, writeFile } from "node:fs/promises";

const input = new URL("../material/real-price-government-codes-20230218.csv", import.meta.url);
const output = new URL("../material/real-price-section-codes-20261022.json", import.meta.url);
const csv = (await readFile(input, "utf8")).replace(/^\uFEFF/, "");
const districts = new Map();

for (const line of csv.split(/\r?\n/).slice(1).filter(Boolean)) {
  const [cityName, cityCode, , , districtName, districtCode] = line.split(",").map((item) => item.trim());
  const key = `${cityCode}|${districtCode}`;
  if (!districts.has(key)) districts.set(key, { cityName, cityCode, districtName, districtCode });
}

const queue = [...districts.values()];
const sections = [];
const failures = [];

await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const district = queue.shift();
    const url = `https://api.nlsc.gov.tw/other/ListLandSection/${district.cityCode}/${district.cityCode}${district.districtCode}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const items = [...xml.matchAll(/<sectItem>\s*<office>([^<]*)<\/office>\s*<officestr>([^<]*)<\/officestr>\s*<sectcode>([^<]*)<\/sectcode>\s*<sectstr>([^<]*)<\/sectstr>\s*<\/sectItem>/g)];
      for (const match of items) sections.push({
        cityCode: district.cityCode,
        districtCode: district.districtCode,
        officeCode: match[1],
        code: match[3],
        name: match[4],
      });
    } catch (error) {
      failures.push({ ...district, error: error.message });
    }
  }
}));

sections.sort((a, b) => `${a.cityCode}${a.districtCode}${a.officeCode}${a.code}`.localeCompare(`${b.cityCode}${b.districtCode}${b.officeCode}${b.code}`));
const snapshot = {
  source: {
    title: "國土測繪中心代碼服務－地段清單",
    dataset: "https://data.gov.tw/dataset/102010",
    api: "https://api.nlsc.gov.tw/other/ListLandSection/{city}/{city}{district}",
    retrievedAt: "2026-10-22",
  },
  failures,
  sections,
};

await writeFile(output, `${JSON.stringify(snapshot)}\n`);
console.log(`sections=${sections.length} failures=${failures.length}`);
