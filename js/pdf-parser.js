const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

export const DEBUG_PDF_PARSER = false;

export const FIELD_ALIASES = Object.freeze({
  district: ["行政區", "區"], section: ["地段", "段"], landNumber: ["地號"],
  announcedValue: ["公告現值", "公告土地現值", "當期公告現值", "當期土地公告現值"],
  announcedLandPrice: ["公告地價", "當期公告地價"], area: ["登記面積", "土地面積", "面積"],
  previousTransferDate: ["前次移轉年月", "前次移轉日期", "原地價年月"],
  priceIndex: ["物價指數", "消費者物價指數"],
  previousValue: ["原規定地價或前次移轉現值", "前次移轉現值", "原規定地價"],
  share: ["持分", "權利範圍", "試算移轉權利範圍", "歷次權利範圍"],
  selfUseTax: ["自用稅額", "自用增值稅", "自用住宅用地稅額", "自用住宅用地應納稅額"],
  generalTax: ["一般/工業用地稅額", "一般／工業用地稅額", "一般用地稅額", "一般增值稅", "一般土地應納稅額"]
});

const RADICALS = { "⼟": "土", "⾏": "行", "⾯": "面", "⽉": "月", "⼀": "一", "⼆": "二", "⼯": "工", "⽤": "用", "⾃": "自", "⾝": "身", "⻑": "長", "⾦": "金", "⼈": "人", "⽅": "方", "⽇": "日", "⺟": "母", "⼩": "小" };
let pdfjsPromise;

function getPdfJs() {
  pdfjsPromise ??= import(PDFJS_URL).then((pdfjs) => { pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL; return pdfjs; });
  return pdfjsPromise;
}

export function normalizeText(value) {
  let text = String(value ?? "").normalize("NFKC");
  for (const [from, to] of Object.entries(RADICALS)) text = text.replaceAll(from, to);
  return text.replace(/[／⁄]/g, "/").replace(/[：:]/g, "").replace(/[\s\u00a0]+/g, "").trim();
}

export function parseNumericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).normalize("NFKC").replace(/[，,\s\u00a0]/g, "").replace(/[−–—]/g, "-");
  const match = text.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

export function parseShareText(value) {
  const text = normalizeText(value);
  if (/^(全部|全)$/.test(text)) return { numerator: 1, denominator: 1, needsConfirmation: false };
  const slash = text.match(/(\d+)\/(\d+)/);
  if (slash && Number(slash[2])) return { numerator: Number(slash[1]), denominator: Number(slash[2]), needsConfirmation: false };
  const words = text.match(/(\d+)分之(\d+)/);
  if (words && Number(words[1])) return { numerator: Number(words[2]), denominator: Number(words[1]), needsConfirmation: false };
  return { numerator: null, denominator: null, needsConfirmation: true };
}

export function parseRocDateText(value) {
  const rawDate = String(value ?? "").trim();
  const text = normalizeText(rawDate).replace(/^民國/, "");
  const match = text.match(/(\d{2,3})(?:年|[.\/-])(\d{1,2})月?/);
  if (!match) return { date: rawDate, rawDate, valid: false };
  const year = Number(match[1]); const month = Number(match[2]);
  if (year < 1 || year > 200 || month < 1 || month > 12) return { date: rawDate, rawDate, valid: false };
  return { date: `${year}年${month}月`, rawDate, valid: true };
}

export function parseSectionName(value) {
  const cleaned = normalizeText(value).replace(/^\[?\d+\]?/, "").replace(/^\(\d+\)/, "");
  const match = cleaned.match(/^(.+?段)?([一二三四五六七八九十百]+)小段$/) ?? cleaned.match(/^(.+?)([一二三四五六七八九十百]+)小段$/);
  if (match) return { section: (match[1] || "").replace(/段$/, ""), subsection: match[2] };
  return { section: cleaned.replace(/段$/, ""), subsection: "" };
}

function normalizePdfItem(item, page) {
  const transform = item.transform ?? [];
  return { text: String(item.str ?? "").trim(), normalizedText: normalizeText(item.str), x: Number(transform[4]) || 0, y: Number(transform[5]) || 0, width: Number(item.width) || 0, height: Math.abs(Number(item.height) || Number(transform[3]) || 0), page };
}

function groupRows(items, tolerance = 3) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
    let row = rows.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) <= tolerance);
    if (!row) { row = { page: item.page, y: item.y, items: [] }; rows.push(row); }
    row.items.push(item);
  }
  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    const text = row.items.map((item) => item.text).join("");
    return { ...row, x: row.items[0]?.x ?? 0, text, normalizedText: normalizeText(text) };
  });
}

function aliasFragments(items, aliases) {
  const wanted = new Set(aliases.map(normalizeText));
  const matches = [];
  for (const row of groupRows(items)) {
    for (let start = 0; start < row.items.length; start += 1) {
      let combined = "";
      for (let end = start; end < Math.min(row.items.length, start + 18); end += 1) {
        combined += row.items[end].text;
        if (!wanted.has(normalizeText(combined))) continue;
        const first = row.items[start]; const last = row.items[end];
        matches.push({ text: combined, normalizedText: normalizeText(combined), x: first.x, y: row.y, width: last.x + last.width - first.x, height: Math.max(...row.items.slice(start, end + 1).map((item) => item.height)), page: row.page });
      }
    }
  }
  return matches;
}

const isNumericCandidate = (item) => parseNumericValue(item.text) !== null && !/[年月]/.test(normalizeText(item.text));

export function findNearestValue(labelItem, items, options = {}) {
  const { sameRowRight = true, below = true, sameColumnBelow = true, maxDistance = 260, numericOnly = false, textOnly = false, rowTolerance = 4, columnTolerance = 55, debugLabel = "" } = options;
  const candidates = items.filter((item) => {
    if (item.page !== labelItem.page || !item.text) return false;
    if (numericOnly && !isNumericCandidate(item)) return false;
    if (textOnly && isNumericCandidate(item)) return false;
    const right = sameRowRight && Math.abs(item.y - labelItem.y) <= rowTolerance && item.x >= labelItem.x + labelItem.width - 2;
    const down = below && item.y < labelItem.y - rowTolerance;
    const column = sameColumnBelow && down && Math.abs(item.x - labelItem.x) <= columnTolerance;
    return right || column || (down && !sameColumnBelow);
  }).map((item) => {
    const dy = Math.abs(item.y - labelItem.y); const sameRow = dy <= rowTolerance;
    const distance = sameRow ? Math.max(0, item.x - labelItem.x - labelItem.width) + dy * 2 : dy + Math.abs(item.x - labelItem.x) * 0.45 + 20;
    return { item, distance, sameRow };
  }).filter((entry) => entry.distance <= maxDistance).sort((a, b) => Number(b.sameRow) - Number(a.sameRow) || a.distance - b.distance);
  const selected = candidates[0]?.item ?? null;
  if (DEBUG_PDF_PARSER && debugLabel) console.debug("[PDF parser]", { field: debugLabel, label: labelItem, candidates, selected });
  return selected;
}

export function detectPdfTemplate(items) {
  const text = normalizeText(items.map((item) => item.text).join(""));
  if (text.includes("新北不動產愛連網") || (text.includes("土地漲價總數額") && text.includes("一般/工業用地稅額"))) return "new-taipei";
  if (text.includes("臺北地政雲") || text.includes("台北地政雲") || (text.includes("臺北市") && text.includes("歷次取得權利範圍"))) return "taipei";
  const count = Object.values(FIELD_ALIASES).filter((aliases) => aliases.some((alias) => text.includes(normalizeText(alias)))).length;
  return count >= 3 ? "generic" : "unknown";
}

const RESULTS_ANCHORS = ["土地漲價總數額", "一般土地應納稅額", "一般/工業用地稅額", "自用住宅用地應納稅額", "物價指數"];
function anchorDistance(item, items) {
  const anchors = items.filter((candidate) => RESULTS_ANCHORS.some((anchor) => candidate.normalizedText.includes(normalizeText(anchor))) && candidate.page === item.page);
  return anchors.length ? Math.min(...anchors.map((anchor) => Math.abs(anchor.y - item.y) + Math.abs(anchor.x - item.x) * 0.1)) : 0;
}

function fieldCandidates(field, items, options = {}) {
  return aliasFragments(items, FIELD_ALIASES[field] ?? []).map((label) => ({ label, value: findNearestValue(label, items, { ...options, maxDistance: options.maxDistance ?? 420, debugLabel: field }), score: anchorDistance(label, items) })).filter((entry) => entry.value).sort((a, b) => a.score - b.score);
}

const TAIPEI_DISTRICT_NAMES = Object.freeze(["中正", "大同", "中山", "松山", "大安", "萬華", "信義", "士林", "北投", "內湖", "南港", "文山"]);
const TAIPEI_CITY_DISTRICT_PATTERN = /(?:臺北市|台北市)\s*[（(]\s*\d{1,2}\s*[）)]\s*(中正|大同|中山|松山|大安|萬華|信義|士林|北投|內湖|南港|文山)區/;

function parseTaipeiLocation(rows, items) {
  const direct = rows.map((row) => normalizeText(row.text).match(TAIPEI_CITY_DISTRICT_PATTERN)?.[1]).find(Boolean);
  if (direct) return { city: "臺北市", district: direct };

  const cityAnchors = items.filter((item) => /(?:臺北市|台北市)/.test(normalizeText(item.text)));
  for (const anchor of cityAnchors) {
    const nearbyText = items
      .filter((item) => item.page === anchor.page && Math.abs(item.y - anchor.y) <= 12 && item.x >= anchor.x - 8 && item.x <= anchor.x + 360)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join("");
    const combined = normalizeText(nearbyText);
    const matched = combined.match(TAIPEI_CITY_DISTRICT_PATTERN)?.[1];
    if (matched) return { city: "臺北市", district: matched };

    const fallback = TAIPEI_DISTRICT_NAMES.find((district) => combined.includes(`${district}區`));
    if (fallback) return { city: "臺北市", district: fallback };
  }
  return { city: "", district: "" };
}

function parseDistrict(rows, items) {
  const direct = aliasFragments(items, FIELD_ALIASES.district).map((label) => findNearestValue(label, items, { sameRowRight: false, sameColumnBelow: true, textOnly: true, maxDistance: 100 })).map((item) => item?.text).find((text) => /區/.test(normalizeText(text)));
  const fallback = rows.map((row) => row.normalizedText.match(/(?:臺北市|台北市|新北市)?(?:\(\d+\))?([^\d()[\]]{1,5}區)/)?.[1]).find((value) => value && !["行政區", "政區"].includes(value));
  return normalizeText(direct || fallback || "").replace(/^(?:臺北市|台北市|新北市)/, "").replace(/區$/, "");
}

function parseIdentity(rows, items) {
  const taipeiLocation = parseTaipeiLocation(rows, items);
  const codedSection = rows.map((row) => row.normalizedText.match(/(?:\(\d+\)|\[\d+\])([^\d()[\]]{1,12}段(?:[一二三四五六七八九十百]+小段)?)/)?.[1]).find(Boolean);
  const sectionBelow = aliasFragments(items, FIELD_ALIASES.section).map((label) => findNearestValue(label, items, { sameRowRight: false, sameColumnBelow: true, textOnly: true, maxDistance: 100 })).map((item) => item?.text);
  let rawSection = codedSection || sectionBelow.find((value) => {
    const normalized = normalizeText(value);
    return normalized.includes("段") && normalized.length <= 12 && normalized !== "地段";
  }) || "";
  let landNumber = fieldCandidates("landNumber", items).map((entry) => normalizeText(entry.value.text)).find((value) => /\d/.test(value)) ?? "";
  if (!landNumber) landNumber = rows.map((row) => row.normalizedText.match(/([\d-]+)地號/)?.[1]).find(Boolean) ?? "";
  const rawLandNumber = landNumber.replace(/地號$/, "");
  return { city: taipeiLocation.city, district: taipeiLocation.district || parseDistrict(rows, items), ...parseSectionName(rawSection), landNumber: rawLandNumber, rawLandNumber };
}

function numericField(field, items) { return parseNumericValue(fieldCandidates(field, items, { numericOnly: true })[0]?.value.text); }

function parseArea(rows, items) {
  const value = numericField("area", items);
  if (value !== null) return value;
  const row = rows.find((candidate) => /(?:土地)?面積/.test(candidate.normalizedText));
  return parseNumericValue(row?.normalizedText.replace(/^.*?(?:土地)?面積/, ""));
}

function parseAnnouncedValue(rows, items) {
  const value = numericField("announcedValue", items);
  if (value !== null) return value;
  const row = rows.find((candidate) => /(?:當期)?(?:土地)?公告現值/.test(candidate.normalizedText));
  return parseNumericValue(row?.normalizedText.replace(/^.*?公告現值[^\d]*/, ""));
}

function parseShare(rows, items) {
  for (const value of fieldCandidates("share", items).map((entry) => entry.value.text)) {
    const share = parseShareText(value); if (!share.needsConfirmation) return share;
  }
  for (const row of rows) {
    const match = row.normalizedText.match(/(?:持分|權利範圍)(全部|\d+\/\d+|\d+分之\d+)/);
    if (match) return parseShareText(match[1]);
  }
  return { numerator: null, denominator: null, needsConfirmation: true };
}

function globalNumbers(field, items) {
  const seen = new Set();
  const direct = fieldCandidates(field, items, { numericOnly: true }).map((entry) => entry.value);
  const columns = aliasFragments(items, FIELD_ALIASES[field] ?? []).flatMap((label) => items.filter((item) =>
    item.page === label.page && item.y < label.y - 4 && label.y - item.y <= 160
    && Math.abs(item.x - label.x) <= 60 && isNumericCandidate(item)
  ));
  return [...direct, ...columns]
    .map((item) => ({ value: parseNumericValue(item.text), page: item.page, y: item.y }))
    .filter((entry) => entry.value !== null && !seen.has(`${entry.page}:${entry.y}:${entry.value}`) && seen.add(`${entry.page}:${entry.y}:${entry.value}`))
    .sort((a, b) => a.page - b.page || b.y - a.y);
}

function numericAtHeaderColumn(row, header, field, items) {
  const labels = aliasFragments(items.filter((item) => item.page === header.page && Math.abs(item.y - header.y) <= 4), FIELD_ALIASES[field]);
  const label = labels[0]; if (!label) return null;
  return parseNumericValue(row.items.filter(isNumericCandidate).sort((a, b) => Math.abs(a.x - label.x) - Math.abs(b.x - label.x))[0]?.text);
}

function parseTransfers(rows, items) {
  const dates = rows.map((row) => {
    const match = row.normalizedText.match(/(?:民國)?\d{2,3}(?:年|[.\/-])\d{1,2}月?/);
    const dateItem = match ? row.items.find((item) => normalizeText(item.text).includes(match[0].match(/\d{2,3}/)?.[0] ?? "")) : null;
    return match ? { row, dateItem, parsed: parseRocDateText(match[0]) } : null;
  }).filter((entry) => entry?.parsed.valid).filter(({ row, dateItem }) => rows.some((header) => {
    if (header.page !== row.page || header.y <= row.y || header.y - row.y >= 90) return false;
    const labels = aliasFragments(header.items, FIELD_ALIASES.previousTransferDate);
    return labels.some((label) => Math.abs(label.x - (dateItem?.x ?? row.x)) <= 80);
  }));

  const collections = { previousValue: globalNumbers("previousValue", items), priceIndex: globalNumbers("priceIndex", items), selfUseTax: globalNumbers("selfUseTax", items).map((x) => ({ ...x, value: Math.round(x.value) })), generalTax: globalNumbers("generalTax", items).map((x) => ({ ...x, value: Math.round(x.value) })) };
  const select = (field, row, index) => {
    const values = collections[field];
    if (!values.length) return null;
    if (values.length === dates.length) return values[index]?.value ?? null;
    return [...values].sort((a, b) => (a.page === row.page ? Math.abs(a.y - row.y) : 10000) - (b.page === row.page ? Math.abs(b.y - row.y) : 10000))[0]?.value ?? null;
  };
  return dates.map(({ row, parsed }, index) => {
    const header = rows.filter((candidate) => candidate.page === row.page && candidate.y > row.y && candidate.y - row.y < 90).sort((a, b) => a.y - b.y)[0] ?? row;
    return { date: parsed.date, rawDate: parsed.rawDate, previousValue: numericAtHeaderColumn(row, header, "previousValue", items) ?? select("previousValue", row, index), priceIndex: numericAtHeaderColumn(row, header, "priceIndex", items) ?? select("priceIndex", row, index), selfUseTax: select("selfUseTax", row, index), generalTax: select("generalTax", row, index) };
  });
}

function missingFieldsFor(land) {
  const missing = [];
  if (!land.landNumber) missing.push("landNumber"); if (land.area === null) missing.push("area"); if (land.announcedValue === null) missing.push("announcedValue");
  if (land.shareNumerator === null || land.shareDenominator === null) missing.push("share");
  land.previousTransfers.forEach((transfer, index) => ["previousValue", "priceIndex", "selfUseTax", "generalTax"].forEach((field) => { if (transfer[field] === null) missing.push(`previousTransfers[${index}].${field}`); }));
  return missing;
}

const confidenceFor = (land, missing) => {
  const present = [land.landNumber, land.area, land.announcedValue, land.shareNumerator, land.shareDenominator].filter((value) => value !== "" && value !== null).length;
  return present === 5 && !missing.length ? "high" : present >= 3 ? "medium" : "low";
};

export function parseGenericLandTaxPdf(items, template = detectPdfTemplate(items)) {
  const records = [];
  for (const page of [...new Set(items.map((item) => item.page))]) {
    const pageItems = items.filter((item) => item.page === page); const rows = groupRows(pageItems); const identity = parseIdentity(rows, pageItems);
    const area = parseArea(rows, pageItems); const announcedValue = parseAnnouncedValue(rows, pageItems); const share = parseShare(rows, pageItems);
    if (!identity.landNumber && area === null && announcedValue === null) continue;
    const data = { ...identity, area, owner: "", announcedValue, shareNumerator: share.numerator, shareDenominator: share.denominator, previousTransfers: parseTransfers(rows, pageItems) };
    const missingFields = missingFieldsFor(data);
    records.push({ data, meta: { template, confidence: confidenceFor(data, missingFields), missingFields, page } });
  }
  const merged = [];
  for (const record of records) {
    const previous = merged.at(-1);
    if (previous && !record.data.landNumber) {
      for (const field of ["city", "district", "section", "subsection", "landNumber", "rawLandNumber", "area", "announcedValue", "shareNumerator", "shareDenominator"]) {
        if ((previous.data[field] === null || previous.data[field] === "") && record.data[field] !== null && record.data[field] !== "") previous.data[field] = record.data[field];
      }
      previous.data.previousTransfers.push(...record.data.previousTransfers);
    } else {
      merged.push(record);
    }
  }

  const allSelfUseTaxes = globalNumbers("selfUseTax", items).map((entry) => Math.round(entry.value));
  const allGeneralTaxes = globalNumbers("generalTax", items).map((entry) => Math.round(entry.value));
  for (const record of merged) {
    record.data.previousTransfers.forEach((transfer, index) => {
      if (transfer.selfUseTax === null && allSelfUseTaxes[index] !== undefined) transfer.selfUseTax = allSelfUseTaxes[index];
      if (transfer.generalTax === null && allGeneralTaxes[index] !== undefined) transfer.generalTax = allGeneralTaxes[index];
    });
    record.meta.missingFields = missingFieldsFor(record.data);
    record.meta.confidence = confidenceFor(record.data, record.meta.missingFields);
  }
  return merged;
}

export function parseNormalizedTextItems(items, fileName = "") {
  const template = detectPdfTemplate(items); const records = parseGenericLandTaxPdf(items, template); const missingFields = [...new Set(records.flatMap((record) => record.meta.missingFields))];
  const confidence = records.length ? (records.every((record) => record.meta.confidence === "high") ? "high" : records.some((record) => record.meta.confidence === "medium") ? "medium" : "low") : "low";
  if (DEBUG_PDF_PARSER) console.debug("[PDF parser]", { PDF: fileName, template, records, missing: missingFields });
  return { lands: records.map((record) => record.data), meta: { template, confidence, missingFields, records: records.map((record) => record.meta) } };
}

export async function extractPdfTextItems(file) {
  const pdfjs = await getPdfJs(); const data = new Uint8Array(await file.arrayBuffer()); const document = await pdfjs.getDocument({ data }).promise; const items = [];
  for (let page = 1; page <= document.numPages; page += 1) {
    const content = await (await document.getPage(page)).getTextContent();
    items.push(...content.items.map((item) => normalizePdfItem(item, page)).filter((item) => item.text));
  }
  return items;
}

export async function parseLandTaxPdfDetailed(file) {
  const items = await extractPdfTextItems(file);
  if (!items.length) throw new Error("此 PDF 沒有可讀取的文字內容，目前請手動輸入土地資料。");
  const result = parseNormalizedTextItems(items, file.name);
  if (!result.lands.length) throw new Error("此 PDF 無法自動辨識土地資料，目前請手動輸入土地資料。");
  return result;
}

export async function parseLandTaxPdf(file) { return (await parseLandTaxPdfDetailed(file)).lands; }
