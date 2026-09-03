import { normalizeDistrict } from "./land-value-normalization.js";

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
    item.page === label.page && item.y < label.y - 4 && label.y - item.y <= 300
    && Math.abs(item.x - label.x) <= 60 && isNumericCandidate(item)
  ));
  return [...direct, ...columns]
    .map((item) => ({ value: parseNumericValue(item.text), page: item.page, y: item.y }))
    .filter((entry) => entry.value !== null && !seen.has(`${entry.page}:${entry.y}:${entry.value}`) && seen.add(`${entry.page}:${entry.y}:${entry.value}`))
    .sort((a, b) => a.page - b.page || b.y - a.y);
}

function globalShares(items) {
  const seen = new Set();
  return items.map((item) => ({ ...parseShareText(item.text), page: item.page, y: item.y, x: item.x }))
    .filter((entry) => !entry.needsConfirmation && !seen.has(`${entry.page}:${entry.y}:${entry.numerator}/${entry.denominator}`) && seen.add(`${entry.page}:${entry.y}:${entry.numerator}/${entry.denominator}`))
    .sort((a, b) => a.page - b.page || b.y - a.y);
}

function numericAtHeaderColumn(row, header, field, items) {
  const labels = aliasFragments(items.filter((item) => item.page === header.page && Math.abs(item.y - header.y) <= 4), FIELD_ALIASES[field]);
  const label = labels[0]; if (!label) return null;
  return parseNumericValue(row.items.filter(isNumericCandidate).sort((a, b) => Math.abs(a.x - label.x) - Math.abs(b.x - label.x))[0]?.text);
}

const roundedOrNull = (value) => value === null || value === undefined ? null : Math.round(value);

function valueItemsAfterLabel(row, labelText) {
  const label = normalizeText(labelText);
  const rowText = normalizeText(row.text);
  if (!rowText.startsWith(label)) return [];
  const labelWidth = row.items.filter((item) => item.x < 220).reduce((right, item) => Math.max(right, item.x + item.width), 0);
  return row.items.filter((item) => item.x > Math.max(200, labelWidth + 8));
}

function rowNumericAfterLabel(row, labelText) {
  return parseNumericValue(valueItemsAfterLabel(row, labelText).map((item) => item.text).join(""));
}

function rowShareAfterLabel(row, labelText) {
  return parseShareText(valueItemsAfterLabel(row, labelText).map((item) => item.text).join(""));
}

function sourceTransferCurrentValue(land, transfer) {
  const denominator = Number(transfer.shareDenominator);
  return denominator ? Math.round(Number(land.area) * Number(land.announcedValue) * Number(transfer.shareNumerator) / denominator) : null;
}

function parseTaipeiTransfers(rows, land) {
  const documentRows = [...rows].sort((a, b) => a.page - b.page || b.y - a.y);
  const starts = documentRows.map((row, index) => normalizeText(row.text).startsWith("前次移轉現值(元/平方公尺)") ? index : -1).filter((index) => index >= 0);
  return starts.map((start, transferIndex) => {
    const block = documentRows.slice(start, starts[transferIndex + 1] ?? documentRows.length);
    const find = (label) => block.find((row) => normalizeText(row.text).startsWith(normalizeText(label)));
    const rawDate = valueItemsAfterLabel(find("原地價年月") ?? { text: "", items: [] }, "原地價年月").map((item) => item.text).join("");
    const dateMatch = normalizeText(rawDate).match(/(\d{2,3})年(\d{1,2})月/);
    const share = rowShareAfterLabel(find("歷次權利範圍") ?? { text: "", items: [] }, "歷次權利範圍");
    const sourcePriceIndex = rowNumericAfterLabel(block.find((row) => /^物價指數(?:\d|\.)/.test(normalizeText(row.text))) ?? { text: "", items: [] }, "物價指數");
    const transfer = {
      date: dateMatch ? `${dateMatch[1]}年${dateMatch[2].padStart(2, "0")}月` : rawDate,
      rawDate,
      previousValue: rowNumericAfterLabel(block[0], "前次移轉現值(元/平方公尺)"),
      shareNumerator: share.numerator,
      shareDenominator: share.denominator,
      sourcePriceIndex,
      priceIndex: sourcePriceIndex,
      sourceAppreciationAmount: null,
      sourceSelfUseTax: rowNumericAfterLabel(find("自用住宅用地應納稅額") ?? { text: "", items: [] }, "自用住宅用地應納稅額"),
      sourceGeneralTax: rowNumericAfterLabel(find("一般土地應納稅額") ?? { text: "", items: [] }, "一般土地應納稅額"),
      calculatedSelfUseTax: null,
      calculatedGeneralTax: null
    };
    transfer.currentValue = sourceTransferCurrentValue(land, transfer);
    transfer.selfUseTax = roundedOrNull(transfer.sourceSelfUseTax);
    transfer.generalTax = roundedOrNull(transfer.sourceGeneralTax);
    return transfer;
  });
}

function parseNewTaipeiTransfers(rows, land) {
  const transferHeader = rows.find((row) => normalizeText(row.text).includes("前次移轉年月") && normalizeText(row.text).includes("物價指數"));
  const transferEnd = rows.find((row) => normalizeText(row.text).startsWith("持分合計"));
  if (!transferHeader || !transferEnd) return [];
  const transferRows = rows.filter((row) => row.page === transferHeader.page && row.y < transferHeader.y && row.y > transferEnd.y);
  const transfers = transferRows.map((row) => {
    const byX = (minimum, maximum) => row.items.filter((item) => item.x >= minimum && item.x < maximum).map((item) => item.text).join("");
    const parsedDate = parseRocDateText(byX(0, 150));
    const share = parseShareText(byX(420, Number.POSITIVE_INFINITY));
    if (!parsedDate.valid || share.needsConfirmation) return null;
    const transfer = {
      date: parsedDate.date, rawDate: parsedDate.rawDate,
      previousValue: parseNumericValue(byX(280, 420)),
      shareNumerator: share.numerator, shareDenominator: share.denominator,
      priceIndex: parseNumericValue(byX(150, 280)),
      sourceAppreciationAmount: null, sourceSelfUseTax: null, sourceGeneralTax: null,
      calculatedSelfUseTax: null, calculatedGeneralTax: null
    };
    transfer.currentValue = sourceTransferCurrentValue(land, transfer);
    return transfer;
  }).filter(Boolean);
  const taxHeader = rows.find((row) => normalizeText(row.text).includes("土地漲價總數額") && normalizeText(row.text).includes("一般/工業用地稅額"));
  const totalRow = rows.find((row) => normalizeText(row.text).startsWith("[總計]"));
  const taxRows = taxHeader && totalRow ? rows.filter((row) => row.page === taxHeader.page && row.y < taxHeader.y && row.y > totalRow.y) : [];
  taxRows.slice(0, transfers.length).forEach((row, index) => {
    const values = row.items.filter(isNumericCandidate).sort((a, b) => a.x - b.x).map((item) => parseNumericValue(item.text));
    const transfer = transfers[index];
    [transfer.sourceAppreciationAmount, transfer.sourceGeneralTax, transfer.sourceSelfUseTax] = values;
    transfer.selfUseTax = roundedOrNull(transfer.sourceSelfUseTax);
    transfer.generalTax = roundedOrNull(transfer.sourceGeneralTax);
  });
  return transfers;
}

function parseOwner(rows) {
  const row = rows.find((candidate) => normalizeText(candidate.text).startsWith("所有權人"));
  return row ? normalizeText(row.text).replace(/^所有權人/, "") : "";
}

function parseNewTaipeiDistrict(rows) {
  const matched = rows.map((row) => normalizeText(row.text).match(/行政區([^\d\[\](),，。:：()（）]{1,8}區)/)?.[1]).find(Boolean) ?? "";
  const district = normalizeDistrict(matched);
  return district ? `${district}區` : "";
}

function parseNewTaipeiArea(rows) {
  const header = rows.find((row) => normalizeText(row.text).includes("登記面積"));
  if (!header) return null;
  const labelItems = header.items.filter((item) => normalizeText(item.text).includes("登記") || normalizeText(item.text).includes("面積"));
  const x = labelItems.length ? Math.min(...labelItems.map((item) => item.x)) : 390;
  const candidates = rows.filter((row) => row.page === header.page && row.y < header.y && header.y - row.y < 90)
    .filter((row) => !/進度\d+%/.test(normalizeText(row.text)))
    .flatMap((row) => row.items.filter((item) => Math.abs(item.x - x) <= 45 && isNumericCandidate(item)).map((item) => ({ item, distance: header.y - row.y + Math.abs(item.x - x) })) )
    .sort((a, b) => a.distance - b.distance);
  return parseNumericValue(candidates[0]?.item.text);
}

export function compareRocYearMonth(left, right) {
  const parse = (value) => {
    const matched = normalizeText(value).match(/^(\d{1,3})年(\d{1,2})月$/);
    return matched ? { year: Number(matched[1]), month: Number(matched[2]) } : null;
  };
  const a = parse(left?.date ?? left); const b = parse(right?.date ?? right);
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.year - b.year || a.month - b.month;
}

export function sortPreviousTransfersOldestFirst(transfers) {
  return (Array.isArray(transfers) ? transfers : []).map((transfer, index) => ({ transfer, index }))
    .sort((a, b) => compareRocYearMonth(a.transfer, b.transfer) || a.index - b.index)
    .map(({ transfer }) => transfer);
}

function ownerFallbackFromFileName(fileName, parsedOwner) {
  const owner = String(parsedOwner ?? "").trim();
  const base = String(fileName ?? "").replace(/\.pdf$/i, "").trim();
  const humanName = /^[\u3400-\u9fff]{2,6}$/.test(base);
  const masked = /[*＊●•]/.test(owner);
  return humanName && (!owner || masked) ? base : owner;
}

function normalizeTaipeiLandNumber(value) {
  const match = String(value ?? "").match(/^(\d+)-(\d+)$/);
  if (!match) return String(value ?? "").replace(/^0+/, "") || "0";
  const main = String(Number(match[1])); const sub = Number(match[2]);
  return sub ? `${main}-${sub}` : main;
}

function parseTransfers(rows, items) {
  const dateHeaders = rows.flatMap((header) => aliasFragments(header.items, FIELD_ALIASES.previousTransferDate).map((label) => ({ header, label })));
  const dates = rows.map((row) => {
    const match = row.normalizedText.match(/(?:民國)?\d{2,3}(?:年|[.\/-])\d{1,2}月?/);
    const dateItem = match ? row.items.find((item) => normalizeText(item.text).includes(match[0].match(/\d{2,3}/)?.[0] ?? "")) : null;
    return match ? { row, dateItem, parsed: parseRocDateText(match[0]) } : null;
  }).filter((entry) => entry?.parsed.valid).filter(({ row, dateItem }) => dateHeaders.some(({ header, label }) =>
    header.page === row.page && header.y > row.y && Math.abs(label.x - (dateItem?.x ?? row.x)) <= 80
  ));

  const collections = { previousValue: globalNumbers("previousValue", items), priceIndex: globalNumbers("priceIndex", items), selfUseTax: globalNumbers("selfUseTax", items).map((x) => ({ ...x, value: Math.round(x.value) })), generalTax: globalNumbers("generalTax", items).map((x) => ({ ...x, value: Math.round(x.value) })) };
  const shares = globalShares(items);
  const select = (field, row, index) => {
    const values = collections[field];
    if (!values.length) return null;
    if (values.length === dates.length) return values[index]?.value ?? null;
    return [...values].sort((a, b) => (a.page === row.page ? Math.abs(a.y - row.y) : 10000) - (b.page === row.page ? Math.abs(b.y - row.y) : 10000))[0]?.value ?? null;
  };
  return dates.map(({ row, parsed }, index) => {
    const header = dateHeaders.filter(({ header: candidate }) => candidate.page === row.page && candidate.y > row.y).sort((a, b) => a.header.y - b.header.y)[0]?.header ?? row;
    const share = shares.length === dates.length ? shares[index] : [...shares].sort((a, b) => (a.page === row.page ? Math.abs(a.y - row.y) : 10000) - (b.page === row.page ? Math.abs(b.y - row.y) : 10000))[0];
    return { date: parsed.date, rawDate: parsed.rawDate, previousValue: numericAtHeaderColumn(row, header, "previousValue", items) ?? select("previousValue", row, index), shareNumerator: share?.numerator ?? null, shareDenominator: share?.denominator ?? null, priceIndex: numericAtHeaderColumn(row, header, "priceIndex", items) ?? select("priceIndex", row, index), selfUseTax: roundedOrNull(numericAtHeaderColumn(row, header, "selfUseTax", items) ?? select("selfUseTax", row, index)), generalTax: roundedOrNull(numericAtHeaderColumn(row, header, "generalTax", items) ?? select("generalTax", row, index)) };
  });
}

function missingFieldsFor(land) {
  const missing = [];
  if (!land.landNumber) missing.push("landNumber"); if (land.area === null) missing.push("area"); if (land.announcedValue === null) missing.push("announcedValue");
  if (land.shareNumerator === null || land.shareDenominator === null) missing.push("share");
  land.previousTransfers.forEach((transfer, index) => ["previousValue", "shareNumerator", "shareDenominator", "priceIndex", "selfUseTax", "generalTax"].forEach((field) => { if (transfer[field] === null) missing.push(`previousTransfers[${index}].${field}`); }));
  return missing;
}

const confidenceFor = (land, missing) => {
  const present = [land.landNumber, land.area, land.announcedValue, land.shareNumerator, land.shareDenominator].filter((value) => value !== "" && value !== null).length;
  return present === 5 && !missing.length ? "high" : present >= 3 ? "medium" : "low";
};

export function parseGenericLandTaxPdf(items, template = detectPdfTemplate(items)) {
  if (template === "taipei" || template === "new-taipei") {
    const rows = groupRows(items); const identity = parseIdentity(rows, items);
    if (template === "taipei") {
      identity.landNumber = normalizeTaipeiLandNumber(identity.landNumber);
      identity.rawLandNumber = identity.landNumber;
    }
    const area = template === "new-taipei" ? parseNewTaipeiArea(rows) : parseArea(rows, items); const announcedValue = parseAnnouncedValue(rows, items); const share = parseShare(rows, items);
    if (template === "new-taipei") { identity.city = "新北市"; identity.district = parseNewTaipeiDistrict(rows); }
    const data = { ...identity, area, owner: parseOwner(rows), announcedValue, shareNumerator: share.numerator, shareDenominator: share.denominator, previousTransfers: [] };
    data.previousTransfers = template === "taipei" ? parseTaipeiTransfers(rows, data) : parseNewTaipeiTransfers(rows, data);
    const missingFields = missingFieldsFor(data);
    return [{ data, meta: { template, confidence: confidenceFor(data, missingFields), missingFields, page: 1 } }];
  }
  const records = [];
  for (const page of [...new Set(items.map((item) => item.page))]) {
    const pageItems = items.filter((item) => item.page === page); const rows = groupRows(pageItems); const identity = parseIdentity(rows, pageItems);
    const area = parseArea(rows, pageItems); const announcedValue = parseAnnouncedValue(rows, pageItems); const share = parseShare(rows, pageItems);
    if (!identity.landNumber && area === null && announcedValue === null) continue;
    const data = { ...identity, area, owner: "", announcedValue, shareNumerator: share.numerator, shareDenominator: share.denominator, previousTransfers: [] };
    data.previousTransfers = template === "taipei" ? parseTaipeiTransfers(rows, data) : template === "new-taipei" ? parseNewTaipeiTransfers(rows, data) : parseTransfers(rows, pageItems);
    for (const transfer of data.previousTransfers) transfer.currentValue ??= sourceTransferCurrentValue(data, transfer);
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

  const allSelfUseTaxes = template === "generic" ? globalNumbers("selfUseTax", items).map((entry) => Math.round(entry.value)) : [];
  const allGeneralTaxes = template === "generic" ? globalNumbers("generalTax", items).map((entry) => Math.round(entry.value)) : [];
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
  for (const record of records) {
    record.data.owner = ownerFallbackFromFileName(fileName, record.data.owner);
    record.data.previousTransfers = sortPreviousTransfersOldestFirst(record.data.previousTransfers);
  }
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
