import {
  extractPdfTextItems,
  normalizeText,
  parseNumericValue,
  parseShareText
} from "./pdf-parser.js";

export const DEBUG_TRANSCRIPT_PARSER = false;

export const TRANSCRIPT_FIELD_ALIASES = Object.freeze({
  ownershipOwner: ["所有權人", "權利人", "姓名", "權利人姓名"]
});

const SECTION_NAMES = Object.freeze({
  "土地標示部": "property",
  "建物標示部": "property",
  "土地所有權部": "ownership",
  "建物所有權部": "ownership",
  "他項權利部": "encumbrance"
});

const PAGE_NOISE = [
  /^土地登記第一類謄本/,
  /^列印時間/,
  /^本謄本係網路申領/,
  /^謄本種類碼/,
  /^資料管轄機關/,
  /^樹地電謄字/,
  /^新北市樹林地政事務所$/,
  /^本謄本未申請列印/,
  /^本謄本僅係/,
  /^〈本謄本列印完畢〉$/,
  /^※注意/,
  /^[一二三四五六七八九十]+、/,
  /^\(?續次頁\)?$/,
  /^(?:RE|FB|EF|I0|0E|\d{1,2})$/
];

function normalizeRowText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[：:]/g, "：")
    .replace(/[／⁄]/g, "/")
    .replace(/[\s\u00a0]+/g, "")
    .trim();
}

function cleanValue(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\*+/g, "")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
  return /^(?:\(?空白\)?|---(?:\(空白\))?.*)$/.test(text) ? "" : text;
}

function compactValue(value) {
  return cleanValue(value).replace(/\s+/g, "");
}

function cleanOwnerValue(value) {
  return String(value ?? "")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

function groupRows(items, tolerance = 2.5) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
    let row = rows.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) <= tolerance);
    if (!row) {
      row = { page: item.page, y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    const text = row.items.map((item) => item.text).join("");
    return { ...row, text, normalizedText: normalizeRowText(text) };
  });
}

export function detectTranscriptSection(value) {
  const text = typeof value === "string" ? normalizeText(value) : normalizeText(value?.text);
  return Object.entries(SECTION_NAMES).find(([label]) => text.includes(normalizeText(label)))?.[1] ?? null;
}

function propertyHeader(row) {
  const text = normalizeRowText(row.text);
  const match = text.match(/^(.+?區)(.+?段)(?:([一二三四五六七八九十百]+)小段)?([0-9]+-[0-9]+)地號/);
  if (!match) return null;
  return {
    district: match[1].replace(/區$/, ""),
    section: match[2].replace(/段$/, ""),
    subsection: match[3] ?? "",
    rawLandNumber: match[4],
    landNumber: match[4]
  };
}

function pagesByProperty(rows) {
  const pageHeaders = new Map();
  for (const row of rows) {
    const header = propertyHeader(row);
    if (header && !pageHeaders.has(row.page)) pageHeaders.set(row.page, header);
  }
  const groups = [];
  for (const page of [...new Set(rows.map((row) => row.page))].sort((a, b) => a - b)) {
    const header = pageHeaders.get(page);
    if (!header) continue;
    let group = groups.find((candidate) => candidate.header.rawLandNumber === header.rawLandNumber);
    if (!group) {
      group = { header, pages: [] };
      groups.push(group);
    }
    group.pages.push(page);
  }
  return groups;
}

function valueAfter(text, label, nextLabels = []) {
  const normalized = normalizeRowText(text);
  const start = normalized.indexOf(`${label}：`);
  if (start < 0) return "";
  let value = normalized.slice(start + label.length + 1);
  for (const next of nextLabels) {
    const index = value.indexOf(`${next}：`);
    if (index >= 0) value = value.slice(0, index);
  }
  return cleanValue(value);
}

function parseProperty(rows, header) {
  const property = {
    type: "土地",
    district: header.district,
    section: header.section,
    subsection: header.subsection,
    landNumber: header.landNumber,
    rawLandNumber: header.rawLandNumber,
    registrationDate: "",
    registrationReason: "",
    area: null,
    zoning: "",
    landUseCategory: "",
    announcedLandValueDate: "",
    announcedLandValue: null,
    buildingCount: null,
    otherRegistrationItems: ""
  };
  const propertyStart = rows.findIndex((row) => detectTranscriptSection(row) === "property");
  const ownershipStart = rows.findIndex((row) => detectTranscriptSection(row) === "ownership");
  const body = rows.slice(Math.max(0, propertyStart + 1), ownershipStart < 0 ? rows.length : ownershipStart);
  const otherLines = [];
  let collectingOther = false;
  for (const row of body) {
    const text = row.normalizedText;
    if (/^登記日期：/.test(text)) {
      property.registrationDate = valueAfter(text, "登記日期", ["登記原因"]);
      property.registrationReason = valueAfter(text, "登記原因");
    } else if (/^面積：/.test(text)) {
      property.area = parseNumericValue(valueAfter(text, "面積"));
    } else if (/^使用分區：/.test(text)) {
      property.zoning = valueAfter(text, "使用分區", ["使用地類別"]);
      property.landUseCategory = valueAfter(text, "使用地類別");
    } else if (/公告土地現值：/.test(text)) {
      const match = text.match(/(?:民國)?(\d{2,3}年\d{1,2}月)公告土地現值：(.+?)(?:元|$)/);
      property.announcedLandValueDate = match?.[1] ?? "";
      property.announcedLandValue = parseNumericValue(match?.[2]);
    } else if (/^地上建物建號：/.test(text)) {
      property.buildingCount = parseNumericValue(valueAfter(text, "地上建物建號"));
    } else if (/^其他登記事項：/.test(text)) {
      collectingOther = true;
      const value = valueAfter(text, "其他登記事項");
      if (value) otherLines.push(value);
    } else if (collectingOther && !PAGE_NOISE.some((pattern) => pattern.test(text))) {
      otherLines.push(cleanValue(row.text));
    }
  }
  property.otherRegistrationItems = otherLines.filter(Boolean).join("\n");
  return property;
}

function extractDateAndAmount(text) {
  const normalized = normalizeRowText(text).replace(/\*+/g, "");
  const match = normalized.match(/(?:民國)?(\d{2,3}年\d{1,2}月).*?([\d,]+(?:\.\d+)?)元/);
  return { date: match?.[1] ?? "", value: parseNumericValue(match?.[2]) };
}

function isOwnerCandidate(value) {
  const text = cleanOwnerValue(value);
  const normalized = normalizeRowText(text);
  if (!normalized || /^\d+(?:\.\d+)?$/.test(normalized)) return false;
  if (/^(?:民國)?\d{2,3}年\d{1,2}月/.test(normalized) || /^[A-Z][12]?\d{8,9}$/i.test(normalized)) return false;
  if (/(?:統一編號|身分證|出生日期|住址|地址|權狀字號|權利範圍|地號|平方公尺|分之|登記日期|登記原因|原因發生日期|當期申報地價|前次移轉)/.test(normalized)) return false;
  if (TRANSCRIPT_FIELD_ALIASES.ownershipOwner.some((alias) => normalized === normalizeRowText(alias))) return false;
  return /[\p{Script=Han}○●＊*]/u.test(text) && text.length <= 30;
}

function findOwnerInChunk(chunk) {
  const labels = [];
  const candidates = [];
  for (let rowIndex = 0; rowIndex < chunk.length; rowIndex += 1) {
    const row = chunk[rowIndex];
    for (const alias of TRANSCRIPT_FIELD_ALIASES.ownershipOwner) {
      const pattern = new RegExp(`${alias}[：:]?`);
      const match = row.text.match(pattern);
      if (!match) continue;
      const labelItem = row.items.find((item) => normalizeRowText(item.text).includes(normalizeRowText(alias)));
      const label = { alias, page: row.page, x: labelItem?.x ?? row.items[0]?.x ?? 0, y: row.y, rowIndex };
      labels.push(label);
      const inline = cleanOwnerValue(row.text.slice((match.index ?? 0) + match[0].length));
      if (isOwnerCandidate(inline)) candidates.push({ value: inline, source: "same-row", distance: 0, page: row.page, x: label.x, y: row.y });
      for (let nextIndex = rowIndex + 1; nextIndex < Math.min(chunk.length, rowIndex + 4); nextIndex += 1) {
        const nextRow = chunk[nextIndex];
        if (nextRow.page !== row.page) break;
        for (const item of nextRow.items) {
          const value = cleanOwnerValue(item.text);
          if (!isOwnerCandidate(value)) continue;
          const distance = Math.abs(nextRow.y - row.y) + Math.abs(item.x - label.x) * 0.4;
          candidates.push({ value, source: "below", distance, page: nextRow.page, x: item.x, y: nextRow.y });
        }
      }
    }
  }
  const selected = candidates.sort((a, b) => (a.source === "same-row" ? -1 : 0) - (b.source === "same-row" ? -1 : 0) || a.distance - b.distance)[0] ?? null;
  return { value: selected?.value ?? "", labels, candidates, selected, reason: selected ? "nearest valid candidate" : labels.length ? "no valid candidate in record" : "owner label absent from text layer" };
}

function parseOwnership(chunk) {
  const first = chunk[0]?.normalizedText ?? "";
  const start = first.match(/^[（(](\d+)[）)]登記次序：([0-9]+)/);
  const ownership = {
    sequence: start?.[1] ?? "",
    registrationOrder: start?.[2] ?? "",
    registrationDate: "",
    registrationReason: "",
    causeDate: "",
    ownerName: "",
    idNumber: "",
    birthDate: "",
    address: "",
    shareType: "",
    shareNumerator: null,
    shareDenominator: null,
    certificateNumber: "",
    declaredLandValueDate: "",
    declaredLandValue: null,
    previousTransferDate: "",
    previousTransferValue: null,
    historicalShareType: "",
    historicalShareNumerator: null,
    historicalShareDenominator: null,
    notes: ""
  };
  const notes = [];
  for (let index = 0; index < chunk.length; index += 1) {
    const row = chunk[index];
    const text = row.normalizedText;
    if (/^登記日期：/.test(text)) {
      ownership.registrationDate = valueAfter(text, "登記日期", ["登記原因"]);
      ownership.registrationReason = valueAfter(text, "登記原因");
    } else if (/^原因發生日期：/.test(text)) ownership.causeDate = valueAfter(text, "原因發生日期");
    else if (/^所有權人：/.test(text)) {
      const rawOwner = row.text.replace(/^.*?所有權人[：:]?/, "").split(/出生日期[：:]?/)[0];
      ownership.ownerName = cleanOwnerValue(rawOwner);
    }
    else if (/^統一編號：/.test(text)) ownership.idNumber = compactValue(valueAfter(text, "統一編號", ["出生日期"]));
    else if (text.includes("出生日期：")) ownership.birthDate = valueAfter(text, "出生日期");
    else if (/^住址：/.test(text)) ownership.address = valueAfter(row.text, "住址");
    else if (/^權利範圍：/.test(text)) {
      const raw = cleanValue(valueAfter(text, "權利範圍"));
      ownership.shareType = raw.includes("公同共有") ? "公同共有" : "";
      const share = parseShareText(raw.replace("公同共有", ""));
      ownership.shareNumerator = share.numerator;
      ownership.shareDenominator = share.denominator;
    } else if (/^權狀字號：/.test(text)) ownership.certificateNumber = valueAfter(row.text, "權狀字號");
    else if (/^當期申報地價：/.test(text)) {
      const parsed = extractDateAndAmount(text);
      ownership.declaredLandValueDate = parsed.date;
      ownership.declaredLandValue = parsed.value;
    } else if (/^前次移轉現值或原規定地價：/.test(text)) {
      const parsed = extractDateAndAmount(`${text}${chunk[index + 1]?.normalizedText ?? ""}`);
      ownership.previousTransferDate = parsed.date;
      ownership.previousTransferValue = parsed.value;
    } else if (/^歷次取得權利範圍：/.test(text)) {
      const raw = cleanValue(valueAfter(text, "歷次取得權利範圍"));
      ownership.historicalShareType = raw.includes("公同共有") ? "公同共有" : "";
      const share = parseShareText(raw.replace("公同共有", ""));
      ownership.historicalShareNumerator = share.numerator;
      ownership.historicalShareDenominator = share.denominator;
    } else if (/^其他登記事項：/.test(text)) {
      const note = valueAfter(row.text, "其他登記事項");
      if (note) notes.push(note);
    } else if (/^[（(]一般註記事項[）)]/.test(text)) notes.push(cleanValue(row.text));
  }
  const ownerLookup = findOwnerInChunk(chunk);
  if (!ownership.ownerName) ownership.ownerName = ownerLookup.value;
  Object.defineProperty(ownership, "_ownerDebug", { value: ownerLookup, enumerable: false });
  ownership.notes = notes.join("\n");
  return ownership;
}

function sectionChunks(rows, wantedSection) {
  const chunks = [];
  let current = null;
  let inSection = false;
  for (const row of rows) {
    const section = detectTranscriptSection(row);
    if (section === wantedSection) { inSection = true; continue; }
    if (section && section !== wantedSection) { inSection = false; continue; }
    const text = row.normalizedText;
    if (!inSection && !current) continue;
    if (/^[（(]\d+[）)]登記次序：/.test(text)) {
      if (current) chunks.push(current);
      current = [row];
      inSection = true;
      continue;
    }
    if (!current || PAGE_NOISE.some((pattern) => pattern.test(text)) || propertyHeader(row)) continue;
    if (/^(?:紙張謄本|力,應上網至|密文檔案|之完整性)/.test(text)) continue;
    current.push(row);
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseEncumbrance(chunk) {
  const get = (label, next = []) => chunk.map((row) => valueAfter(row.text, label, next)).find(Boolean) ?? "";
  const first = chunk[0]?.normalizedText.match(/^[（(](\d+)[）)]登記次序：([0-9]+)/);
  return {
    sequence: first?.[1] ?? "",
    registrationOrder: first?.[2] ?? "",
    rightType: get("權利種類"),
    receiptDate: get("收件年月日"),
    registrationDate: get("登記日期", ["登記原因"]),
    registrationReason: get("登記原因"),
    rightHolder: get("權利人"),
    totalSecuredAmount: parseNumericValue(get("擔保債權總金額")),
    duration: get("存續期間"),
    payoffDate: get("清償日期"),
    interest: get("利息"),
    penalty: get("違約金"),
    debtor: get("債務人"),
    share: get("設定權利範圍"),
    jointCollateralLandNumbers: get("共同擔保地號"),
    notes: get("備考") || get("其他登記事項")
  };
}

function missingPropertyFields(property) {
  return ["district", "section", "landNumber", "registrationDate", "registrationReason", "area", "announcedLandValue"]
    .filter((field) => property[field] === "" || property[field] === null);
}

function missingOwnershipFields(ownerships) {
  return ownerships.flatMap((ownership, index) => ["registrationOrder", "registrationDate", "registrationReason", "ownerName", "shareNumerator", "shareDenominator"]
    .filter((field) => ownership[field] === "" || ownership[field] === null)
    .map((field) => `ownerships[${index}].${field}`));
}

function maskSensitive(value) {
  const text = String(value ?? "");
  return text.length > 5 ? `${text.slice(0, 4)}****${text.slice(-2)}` : text ? "****" : "";
}

export function parseTranscriptTextItems(items, fileName = "") {
  const rows = groupRows(items);
  const detectedSections = [...new Set(rows.map(detectTranscriptSection).filter(Boolean))];
  const records = pagesByProperty(rows).map((group) => {
    const recordRows = rows.filter((row) => group.pages.includes(row.page));
    const property = parseProperty(recordRows, group.header);
    const ownerships = sectionChunks(recordRows, "ownership").map(parseOwnership);
    const encumbranceStart = recordRows.findIndex((row) => detectTranscriptSection(row) === "encumbrance");
    const encumbrances = encumbranceStart < 0 ? [] : sectionChunks(recordRows.slice(encumbranceStart), "encumbrance").map(parseEncumbrance);
    const meta = {
      pages: [...group.pages],
      propertyMissingFields: missingPropertyFields(property),
      ownershipMissingFields: missingOwnershipFields(ownerships),
      encumbranceMissingFields: [],
      detectedSections: [...new Set(recordRows.map(detectTranscriptSection).filter(Boolean))]
    };
    if (DEBUG_TRANSCRIPT_PARSER) {
      console.debug("[Transcript parser]", {
        landNumber: property.rawLandNumber,
        sections: meta.detectedSections,
        ownershipRecords: ownerships.map((entry) => ({
          record: entry.sequence,
          ownerLabelsFound: entry._ownerDebug?.labels ?? [],
          ownerCandidates: (entry._ownerDebug?.candidates ?? []).map((candidate) => ({ ...candidate, value: maskSensitive(candidate.value) })),
          selectedOwner: entry.ownerName ? maskSensitive(entry.ownerName) : null,
          reason: entry._ownerDebug?.reason,
          idNumber: maskSensitive(entry.idNumber)
        })),
        missingFields: meta
      });
    }
    return { property, ownerships, encumbrances, meta };
  });
  return {
    records,
    meta: {
      sourceFile: fileName,
      pageCount: new Set(items.map((item) => item.page)).size,
      detectedSections,
      propertyMissingFields: records.flatMap((record, index) => record.meta.propertyMissingFields.map((field) => `records[${index}].property.${field}`)),
      ownershipMissingFields: records.flatMap((record, recordIndex) => record.meta.ownershipMissingFields.map((field) => `records[${recordIndex}].${field}`)),
      encumbranceMissingFields: records.flatMap((record) => record.meta.encumbranceMissingFields)
    }
  };
}

export async function parseTranscriptPdf(file) {
  const items = await extractPdfTextItems(file);
  if (!items.length) throw new Error("此謄本 PDF 沒有可讀取的文字內容，目前請手動輸入資料。");
  const result = parseTranscriptTextItems(items, file.name);
  if (!result.records.length) throw new Error("已讀取 PDF 文字，但無法辨識謄本標示資料，請確認或手動輸入。");
  return result;
}

function normalizedRocMonth(value) {
  const text = String(value ?? "").normalize("NFKC").replace(/^民國/, "").trim();
  const match = text.match(/(\d{2,3})(?:年|[.\/-])(\d{1,2})月?/);
  if (!match) return text;
  return `${Number(match[1])}年${Number(match[2])}月`;
}

export function transcriptResultToLands(result) {
  return (result?.records ?? []).flatMap((record) => record.ownerships.map((ownership) => ({
    id: globalThis.crypto?.randomUUID?.() ?? `transcript-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceFileId: null,
    rawSequence: ownership.registrationOrder || ownership.sequence,
    district: record.property.district,
    section: record.property.section,
    subsection: record.property.subsection,
    landNumber: record.property.rawLandNumber || record.property.landNumber,
    rawLandNumber: record.property.rawLandNumber || record.property.landNumber,
    area: record.property.area,
    owner: ownership.ownerName,
    announcedValue: record.property.announcedLandValue,
    shareNumerator: ownership.shareNumerator,
    shareDenominator: ownership.shareDenominator,
    previousTransfers: [{
      date: normalizedRocMonth(ownership.previousTransferDate),
      previousValue: ownership.declaredLandValue,
      priceIndex: null,
      selfUseTax: null,
      generalTax: null,
      assessedTaxReductionRate: 0,
      creditableLandTax: 0
    }],
    currentValue: null,
    sourceMeta: {
      transcriptPages: record.meta.pages,
      ownershipSequence: ownership.sequence,
      registrationOrder: ownership.registrationOrder,
      registrationDate: ownership.registrationDate,
      registrationReason: ownership.registrationReason,
      declaredLandValueDate: ownership.declaredLandValueDate,
      rawPreviousTransferValue: ownership.previousTransferValue,
      shareType: ownership.shareType
    }
  })));
}

export async function parseTranscriptPdfToLands(file) {
  const result = await parseTranscriptPdf(file);
  return { lands: transcriptResultToLands(result), meta: result.meta, rawRecords: result.records };
}
