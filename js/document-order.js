const collator = new Intl.Collator("zh-Hant", { sensitivity: "base", numeric: false });

const TAIPEI_DISTRICTS = new Set(["中正", "大同", "中山", "松山", "大安", "萬華", "信義", "士林", "北投", "內湖", "南港", "文山"]);
const NEW_TAIPEI_DISTRICTS = new Set(["板橋", "三重", "中和", "永和", "新莊", "新店", "樹林", "鶯歌", "三峽", "淡水", "汐止", "瑞芳", "土城", "蘆洲", "五股", "泰山", "林口", "深坑", "石碇", "坪林", "三芝", "石門", "八里", "平溪", "雙溪", "貢寮", "金山", "萬里", "烏來"]);

export function normalizeOrderText(value) {
  return String(value ?? "").normalize("NFKC").replace(/台/g, "臺").replace(/\s/g, "").replace(/[縣市區鄉鎮]$/, "").trim();
}

export function parseLandNumberParts(value) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[－–—_]/g, "-").replace(/地號|\s/g, "");
  const numbers = normalized.match(/\d+/g) ?? [];
  return { main: Number(numbers[0] ?? Number.POSITIVE_INFINITY), sub: Number(numbers[1] ?? 0), valid: numbers.length > 0 };
}

export function compareLandNumbers(a, b) {
  const left = parseLandNumberParts(a); const right = parseLandNumberParts(b);
  return left.main - right.main || left.sub - right.sub;
}

function cityKey(land) {
  const explicit = String(land?.city ?? land?.county ?? "").normalize("NFKC").replace(/^台北/, "臺北");
  if (explicit.includes("臺北")) return { rank: 0, name: "臺北市" };
  if (explicit.includes("新北")) return { rank: 1, name: "新北市" };
  const district = normalizeOrderText(land?.district);
  if (TAIPEI_DISTRICTS.has(district)) return { rank: 0, name: "臺北市" };
  if (NEW_TAIPEI_DISTRICTS.has(district)) return { rank: 1, name: "新北市" };
  return { rank: 2, name: explicit || "其他縣市" };
}

export function landOrderKey(land) {
  const district = normalizeOrderText(land?.district);
  const number = parseLandNumberParts(land?.landNumber ?? land?.rawLandNumber);
  if (!district || !number.valid) return null;
  const city = cityKey(land);
  return { cityRank: city.rank, city: city.name, district, section: normalizeOrderText(land?.section), subsection: normalizeOrderText(land?.subsection), landNumber: land?.landNumber ?? land?.rawLandNumber };
}

export function compareLandOrderKeys(left, right) {
  return left.cityRank - right.cityRank
    || collator.compare(left.city, right.city)
    || collator.compare(left.district, right.district)
    || collator.compare(left.section, right.section)
    || collator.compare(left.subsection, right.subsection)
    || compareLandNumbers(left.landNumber, right.landNumber);
}

export function sortDocumentsByLand(files, lands) {
  const originalIndex = new Map(files.map((entry, index) => [entry.id, index]));
  const decorated = files.map((entry) => ({ entry, key: landOrderKey(lands.find((land) => land.sourceFileId === entry.id)), index: originalIndex.get(entry.id) }));
  decorated.sort((left, right) => {
    if (left.key && !right.key) return -1;
    if (!left.key && right.key) return 1;
    if (!left.key && !right.key) return left.index - right.index;
    return compareLandOrderKeys(left.key, right.key) || left.index - right.index;
  });
  return decorated.map(({ entry }) => entry);
}

export function orderLandsByDocuments(lands, files) {
  const fileIds = new Set(files.map((entry) => entry.id));
  return [...files.flatMap((entry) => lands.filter((land) => land.sourceFileId === entry.id)), ...lands.filter((land) => !fileIds.has(land.sourceFileId))];
}
