export const FILING_DRAFT_STORAGE_KEY = "land-tax-tool:real-price-filing-draft:v1";
export const FILING_SCHEMA_VERSION = 1;
export const COMMON_FILING_NOTE = "新建案管委會籌組中";

export const GOVERNMENT_CODE_SOURCE = Object.freeze({
  title: "內政部實價登錄縣市、鄉鎮市區及地政事務所代碼表",
  versionDate: "2023-02-18",
  file: "material/real-price-government-codes-20230218.csv",
  note: "Phase 4A 取得之官方 JSON 格式附件；代碼如有異動，須更新快照後再產檔。",
});

export const GOVERNMENT_SECTION_SOURCE = Object.freeze({
  title: "國土測繪中心代碼服務－地段清單",
  versionDate: "2026-10-22",
  file: "material/real-price-section-codes-20261022.json",
  dataset: "https://data.gov.tw/dataset/102010",
});

export const CAR_TYPES = Object.freeze([
  ["1", "坡道平面"], ["2", "升降平面"], ["3", "坡道機械"], ["4", "升降機械"],
  ["5", "塔式車位"], ["6", "一樓平面"], ["7", "其他"],
]);

export const CAR_FLOORS = Object.freeze([
  ["2", "二樓含以上"], ["1", "一樓"], ["B1", "地下一樓"], ["B2", "地下二樓"],
  ["B3", "地下三樓"], ["B4", "地下四樓"], ["B5", "地下五樓含以下"], ["0", "無固定樓層"],
]);

export const SPECIAL_OPTIONS = Object.freeze([
  ["p1sp_code0201", "關係人間交易"], ["p1sp_code0202", "建商與地主間交易"],
  ["p1sp_code0301", "陽台外推"], ["p1sp_code0302", "頂樓加蓋"], ["p1sp_code0303", "夾層"],
  ["p1sp_code0304", "其他增建"], ["p1sp_code0305", "未登記建物"],
  ["p1sp_code0401", "土地上有未登記建物"], ["p1sp_code0402", "土地上有農作物"],
  ["p1sp_code0403", "土地上有機電設備"], ["p1sp_code0404", "土地上有農業設施"],
  ["p1sp_code0501", "急買急賣"], ["p1sp_code0502", "受民情風俗因素影響"], ["p1sp_code0503", "瑕疵物件"],
  ["p1sp_code0504", "含租約"], ["p1sp_code0505", "毛胚屋"], ["p1sp_code0506", "具重建、重劃或都更效益"],
  ["p1sp_code0507", "畸零地或有合併使用效益"], ["p1sp_code0508", "借名登記返還"],
  ["p1sp_code0509", "受債權債務關係影響或債務抵償"], ["p1sp_code0510", "雙方合意或法院判決解除契約"],
  ["p1sp_code0511", "土地價格含未來興建房屋成本"], ["p1sp_code0601", "塔位／墓園"],
  ["p1sp_code0602", "地上權房屋"], ["p1sp_code0603", "市場攤位"], ["p1sp_code0604", "含公共設施保留地"],
  ["p1sp_code0701", "政府機關標讓售"], ["p1sp_code0702", "地清或未辦繼承標售"],
  ["p1sp_code0703", "水利地承銷"], ["p1sp_code0704", "協議價購"],
]);

const CONTENT_FIELDS = [
  "case_type", "case_no", "p1ma_caseSeq", "case_x45", "case_x45c", "case_x46", "case_x46c", "case_unit", "case_unitc",
  "p1ma_date", "caseflag3", "caseflag5", "notify_type0", "notify_type1", "agents_name", "agents_sign", "agents_idNo",
  "agents_tel", "agents_mail", "agents_x45", "agents_x45c", "agents_x46", "agents_x46c", "agents_addr", "agent_entrust1",
  "agent_month", "agent_entrust2", "p1ma_build1", "p1ma_build2", "p1ma_build3", "p1ma_build4", "p1ma_manage",
  "p1ma_build11", "p1ma_totprice", "p1ma_parkflag", "p1ma_cntpark", "p1ma_parkflag2", "p1ma_parkprice",
  "p1sp_code0101", "p1sp_price0101", "p1sp_code0102", "p1sp_price0102", "p1sp_code0103", "p1sp_price0103",
  "p1sp_code0104", "p1sp_price0104", "p1sp_code0105", "p1sp_price0105", "p1sp_code0106", "p1sp_desc0106",
  "p1sp_price0106", ...SPECIAL_OPTIONS.map(([field]) => field), "p1sp_code0801", "p1sp_code0901", "p1sp_code0901no", "p1ma_note",
];

export function createRealPriceFilingDraft() {
  return {
    schemaVersion: FILING_SCHEMA_VERSION,
    location: { cityCode: "", cityName: "", districtCode: "", districtName: "", officeCode: "", officeName: "", manual: {} },
    transaction: {
      propertyType: "", propertyTypeManual: false, sourceFileKeys: [], propertyTypeHint: "",
      contractDate: "", totalPrice: "",
    },
    applicantKind: "16",
    buyers: [],
    sellers: [],
    agent: {
      enabled: false, source: "saved", savedId: "", name: "", idNumber: "", phone: "", email: "",
      cityCode: "", cityName: "", districtCode: "", districtName: "", addressRemainder: "", entrustType: "2", months: "", manual: {},
    },
    building: { rooms: "", halls: "", bathrooms: "", noPartitions: false, management: "", elevator: "" },
    parking: { hasParking: "", pricingMode: "", totalPrice: "", items: [] },
    fees: {
      p1sp_code0101: false, p1sp_price0101: "", p1sp_code0102: false, p1sp_price0102: "",
      p1sp_code0103: false, p1sp_price0103: "", p1sp_code0104: false, p1sp_price0104: "",
      p1sp_code0105: false, p1sp_price0105: "", p1sp_code0106: false, p1sp_desc0106: "", p1sp_price0106: "",
    },
    special: Object.fromEntries([...SPECIAL_OPTIONS.map(([field]) => [field, false]), ["p1sp_code0901", false], ["p1sp_code0901no", ""], ["noteMode", "none"], ["note", ""]]),
    lists: {
      land: { enabled: false, items: [] },
      build: { enabled: false, items: [] },
      base: { enabled: false, items: [] },
    },
  };
}

export function loadRealPriceFilingDraft(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(FILING_DRAFT_STORAGE_KEY) || "null");
    if (parsed?.schemaVersion !== FILING_SCHEMA_VERSION) return createRealPriceFilingDraft();
    return normalizeRealPriceFilingDraft(parsed);
  } catch {
    return createRealPriceFilingDraft();
  }
}

export function normalizeRealPriceFilingDraft(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const draft = mergeDraft(source);
  if (source.transaction && !("propertyTypeManual" in source.transaction) && source.transaction.propertyType) {
    draft.transaction.propertyTypeManual = true;
  }
  if (!source.special?.noteMode) {
    draft.special.noteMode = !draft.special.note ? "none" : draft.special.note === COMMON_FILING_NOTE ? "common" : "custom";
  }
  return draft;
}

export function saveRealPriceFilingDraft(storage, draft) {
  storage?.setItem(FILING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function clearRealPriceFilingDraft(storage) {
  storage?.removeItem(FILING_DRAFT_STORAGE_KEY);
}

export function parseGovernmentCodeCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    const [cityName, cityCode, officeShortName, officeCode, districtName, districtCode] = line.split(",").map((item) => item.trim());
    return {
      cityName, cityCode, officeCode, districtName, districtCode,
      officeName: officeShortName.endsWith("地政事務所") ? officeShortName : `${officeShortName}地政事務所`,
    };
  }).filter((row) => row.cityCode && row.districtCode && row.officeCode);
}

export function syncRealPriceFilingFromCase(draft, caseState, codeRows) {
  const parties = distinctCaseParties(caseState?.parties || []);
  draft.buyers = syncPartyGroup(draft.buyers, parties.filter((item) => item.role === "buyer"), codeRows);
  draft.sellers = syncPartyGroup(draft.sellers, parties.filter((item) => item.role === "seller"), codeRows);

  if (!draft.location.manual.cityCode || !draft.location.manual.districtCode) {
    const inferred = inferCaseLocation(caseState, codeRows);
    if (inferred) {
      if (!draft.location.manual.cityCode) {
        draft.location.cityCode = inferred.cityCode;
        draft.location.cityName = inferred.cityName;
      }
      if (!draft.location.manual.districtCode) {
        draft.location.districtCode = inferred.districtCode;
        draft.location.districtName = inferred.districtName;
      }
    }
  }
  syncTransactionTypeFromCase(draft, caseState);
  syncOfficeSuggestion(draft, codeRows);
  return draft;
}

export function inferTransactionTypeFromCase(caseState) {
  const files = (caseState?.importedFiles || []).filter((file) => file?.type === "land" || file?.type === "building");
  if (!files.length) return { propertyType: "", sourceFileKeys: [], hint: "" };
  const sourceFileKeys = [...new Set(files.map((file) => `${file.type}:${file.fingerprint || file.id || file.name || "unknown"}`))].sort();
  const hasLand = files.some((file) => file.type === "land");
  const hasBuilding = files.some((file) => file.type === "building");
  if (hasLand && !hasBuilding) return { propertyType: "land-only", sourceFileKeys, hint: "" };
  if (hasBuilding && !hasLand) {
    return {
      propertyType: "normal",
      sourceFileKeys,
      hint: "目前只有建物 CSV，已暫選一般交易；建物資料無法判斷是否為僅車位交易，請人工確認。",
    };
  }
  return { propertyType: "normal", sourceFileKeys, hint: "" };
}

export function syncTransactionTypeFromCase(draft, caseState) {
  const inferred = inferTransactionTypeFromCase(caseState);
  if (!inferred.sourceFileKeys.length) {
    draft.transaction.propertyTypeHint = "";
    return draft;
  }
  const previousKeys = Array.isArray(draft.transaction.sourceFileKeys) ? draft.transaction.sourceFileKeys : [];
  const sameCase = previousKeys.length > 0 && inferred.sourceFileKeys.some((key) => previousKeys.includes(key));
  if (!previousKeys.length) {
    if (!draft.transaction.propertyType) draft.transaction.propertyType = inferred.propertyType;
  } else if (!sameCase) {
    draft.transaction.propertyType = inferred.propertyType;
    draft.transaction.propertyTypeManual = false;
  } else if (!draft.transaction.propertyTypeManual) {
    draft.transaction.propertyType = inferred.propertyType;
  }
  draft.transaction.sourceFileKeys = inferred.sourceFileKeys;
  draft.transaction.propertyTypeHint = inferred.hint;
  return draft;
}

export function selectSavedFilingAgent(draft, savedAgent, codeRows) {
  draft.agent.savedId = savedAgent?.id || "";
  if (!savedAgent) return draft;
  draft.agent.name = savedAgent.name || "";
  draft.agent.idNumber = savedAgent.idNumber || "";
  draft.agent.phone = savedAgent.phone || "";
  draft.agent.email = savedAgent.email || "";
  const split = splitGovernmentAddress(savedAgent.address || "", codeRows);
  draft.agent.cityCode = split.cityCode;
  draft.agent.cityName = split.cityName;
  draft.agent.districtCode = split.districtCode;
  draft.agent.districtName = split.districtName;
  draft.agent.addressRemainder = split.addressRemainder;
  draft.agent.manual = {};
  return draft;
}

export function splitGovernmentAddress(address, codeRows) {
  const raw = String(address || "").trim();
  if (!raw) return emptyAddress();
  const normalized = normalizeTaiwanText(raw);
  const cities = uniqueBy(codeRows, (row) => row.cityCode);
  const city = cities.find((row) => normalized.startsWith(normalizeTaiwanText(row.cityName)));
  if (city) {
    const afterCity = normalized.slice(normalizeTaiwanText(city.cityName).length);
    const district = codeRows.find((row) => row.cityCode === city.cityCode && afterCity.startsWith(normalizeTaiwanText(row.districtName)));
    if (district) return { ...district, addressRemainder: afterCity.slice(normalizeTaiwanText(district.districtName).length) };
  }
  const districtMatches = uniqueBy(codeRows.filter((row) => normalized.startsWith(normalizeTaiwanText(row.districtName))), (row) => `${row.cityCode}|${row.districtCode}`);
  if (districtMatches.length === 1) {
    const district = districtMatches[0];
    return { ...district, addressRemainder: normalized.slice(normalizeTaiwanText(district.districtName).length) };
  }
  return { ...emptyAddress(), addressRemainder: raw };
}

export function getOfficeCandidates(draft, codeRows) {
  return uniqueBy(codeRows.filter((row) => row.cityCode === draft.location.cityCode && row.districtCode === draft.location.districtCode), (row) => row.officeCode);
}

export function syncOfficeSuggestion(draft, codeRows) {
  if (draft.location.manual.officeCode) return;
  const candidates = getOfficeCandidates(draft, codeRows);
  if (candidates.length === 1) {
    draft.location.officeCode = candidates[0].officeCode;
    draft.location.officeName = candidates[0].officeName;
  } else if (!candidates.some((row) => row.officeCode === draft.location.officeCode)) {
    draft.location.officeCode = "";
    draft.location.officeName = "";
  }
}

export function formatRocContractDate(value) {
  const raw = String(value || "").trim().replace(/[.\/-]/g, "");
  if (!/^\d{7}$/.test(raw)) return "";
  const year = Number(raw.slice(0, 3));
  const month = Number(raw.slice(3, 5));
  const day = Number(raw.slice(5, 7));
  const date = new Date(Date.UTC(year + 1911, month - 1, day));
  if (date.getUTCFullYear() !== year + 1911 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return raw;
}

export function validateRealPriceFiling(draft, codeRows, sectionRows = []) {
  const issues = [];
  const add = (key, message, severity = "warning") => issues.push({ key, message: message.trim(), severity });
  const warn = (key, message) => add(key, message, "warning");
  const error = (key, message) => add(key, message, "error");
  if (!draft.applicantKind) warn("applicantKind", "請明確選擇申報人身分。");
  else if (!["13", "15", "16"].includes(draft.applicantKind)) error("applicantKind", "申報人身分代碼不正確。");

  const contractDate = String(draft.transaction.contractDate || "").trim();
  if (!contractDate) warn("contractDate", "私契日期尚未填寫。");
  else if (!formatRocContractDate(contractDate)) error("contractDate", "私契日期須為有效的民國 7 碼日期。");
  const totalPrice = String(draft.transaction.totalPrice || "").trim();
  if (!totalPrice) warn("totalPrice", "成交總價尚未填寫。");
  else if (!isWholeMoney(totalPrice, { positive: true })) error("totalPrice", "成交總價須為新臺幣正整數。");

  const propertyType = draft.transaction.propertyType;
  if (!propertyType) warn("propertyType", "請確認交易標的類型。");
  else if (!["normal", "land-only", "parking-only"].includes(propertyType)) error("propertyType", "交易標的類型代碼不正確。");

  const hasLocationCodes = Boolean(draft.location.cityCode && draft.location.districtCode);
  const locationMatch = codeRows.some((row) => row.cityCode === draft.location.cityCode && row.districtCode === draft.location.districtCode);
  if (!hasLocationCodes) warn("location", "縣市與行政區尚未完整選擇。");
  else if (!locationMatch) error("location", "縣市與行政區代碼不符合官方代碼表。");
  const officeMatch = getOfficeCandidates(draft, codeRows).some((row) => row.officeCode === draft.location.officeCode);
  if (!draft.location.officeCode) warn("office", "地政事務所尚未選擇。");
  else if (!officeMatch) error("office", "地政事務所代碼與目前縣市、行政區不一致。");

  validateParties(draft.buyers, "buyer", "買方", codeRows, warn, error);
  validateParties(draft.sellers, "seller", "賣方", codeRows, warn, error);
  if (!draft.buyers.length) warn("buyers", "至少需要一位買方。");
  if (!draft.sellers.length) warn("sellers", "至少需要一位賣方。");

  if (draft.applicantKind === "16" && !draft.agent.enabled) warn("agentEnabled", "申報人身分為代理人時，申報代理人資料尚未啟用。");
  if (draft.agent.enabled) validateAgent(draft.agent, codeRows, warn, error);

  const normalBuilding = draft.transaction.propertyType === "normal";
  if (normalBuilding) {
    if (!draft.building.noPartitions && ![draft.building.rooms, draft.building.halls, draft.building.bathrooms].every(isWholeNumber)) {
      const values = [draft.building.rooms, draft.building.halls, draft.building.bathrooms];
      const severity = values.some((value) => String(value || "").trim() && !isWholeNumber(value)) ? "error" : "warning";
      add("buildingLayout", "有建物交易時，請填房、廳、衛數量，或勾選無隔間。", severity);
    }
    validateBinaryChoice(draft.building.management, "buildingManagement", "請確認有無管理組織。", warn, error);
    validateBinaryChoice(draft.building.elevator, "buildingElevator", "請確認有無電梯。", warn, error);
  }

  validateParking(draft, warn, error);
  validateFees(draft, warn, error);
  validateConditionalLists(draft, sectionRows, warn, error);
  if (String(draft.special.note || "").length > 200) error("note", "其他說明不得超過 200 個中文字。");

  const json = buildRealPriceGovernmentJson(draft);
  const content = json.case_detail?.tab1?.case_content;
  if (!content || !Array.isArray(json.case_detail?.tab1?.buyer) || !Array.isArray(json.case_detail?.tab1?.seller)) {
    error("output", "候選 JSON 結構無法正確產生。");
  } else if (content.caseflag3 && content.caseflag5) {
    error("propertyType", "交易類型代碼互相矛盾，無法產生候選申報檔。");
  }
  return issues;
}

export function buildRealPriceGovernmentJson(draft) {
  const content = Object.fromEntries(CONTENT_FIELDS.map((field) => [field, ""]));
  Object.assign(content, {
    case_type: "A", case_no: "", p1ma_caseSeq: "01",
    case_x45: draft.location.cityCode, case_x45c: draft.location.cityName,
    case_x46: draft.location.districtCode, case_x46c: draft.location.districtName,
    case_unit: draft.location.officeCode, case_unitc: draft.location.officeName,
    p1ma_date: formatRocContractDate(draft.transaction.contractDate),
    caseflag3: draft.transaction.propertyType === "land-only" ? "3" : "",
    caseflag5: draft.transaction.propertyType === "parking-only" ? "5" : "",
    p1ma_totprice: normalizeInteger(draft.transaction.totalPrice),
  });

  if (draft.agent.enabled) Object.assign(content, {
    agents_name: draft.agent.name.trim(), agents_sign: "", agents_idNo: normalizeId(draft.agent.idNumber),
    agents_tel: normalizePhone(draft.agent.phone), agents_mail: draft.agent.email.trim(),
    agents_x45: draft.agent.cityCode, agents_x45c: draft.agent.cityName,
    agents_x46: draft.agent.districtCode, agents_x46c: draft.agent.districtName,
    agents_addr: draft.agent.addressRemainder.trim(), agent_entrust1: "", agent_month: "", agent_entrust2: "2",
  });

  if (draft.transaction.propertyType === "normal") Object.assign(content, {
    p1ma_build1: draft.building.noPartitions ? "" : normalizeInteger(draft.building.rooms),
    p1ma_build2: draft.building.noPartitions ? "" : normalizeInteger(draft.building.halls),
    p1ma_build3: draft.building.noPartitions ? "" : normalizeInteger(draft.building.bathrooms),
    p1ma_build4: draft.building.noPartitions ? "Y" : "",
    p1ma_manage: draft.building.management,
    p1ma_build11: draft.building.elevator,
  });

  const hasParking = draft.transaction.propertyType === "parking-only" || draft.parking.hasParking === "yes";
  content.p1ma_parkflag = hasParking ? "01" : "2";
  if (hasParking) {
    content.p1ma_cntpark = String(draft.parking.items.length);
    content.p1ma_parkflag2 = draft.parking.pricingMode;
    content.p1ma_parkprice = draft.parking.pricingMode === "0" ? normalizeInteger(draft.parking.totalPrice) : "";
  }
  content.p1sp_code0801 = draft.transaction.propertyType === "parking-only" ? "Y" : "";

  for (const [field] of SPECIAL_OPTIONS) content[field] = draft.special[field] ? "Y" : "";
  for (const field of ["p1sp_code0101", "p1sp_code0102", "p1sp_code0103", "p1sp_code0104", "p1sp_code0105", "p1sp_code0106"]) {
    content[field] = draft.fees[field] ? "Y" : "";
    const priceField = field.replace("code", "price");
    content[priceField] = draft.fees[field] ? normalizeInteger(draft.fees[priceField]) : "";
  }
  content.p1sp_desc0106 = draft.fees.p1sp_code0106 ? draft.fees.p1sp_desc0106.trim() : "";
  content.p1sp_code0901 = draft.special.p1sp_code0901 ? "Y" : "";
  content.p1sp_code0901no = draft.special.p1sp_code0901 ? draft.special.p1sp_code0901no.trim() : "";
  content.p1ma_note = draft.special.note.trim();

  const tab = {
    case_content: content,
    buyer: draft.buyers.map((party, index) => governmentParty(party, "buy", index)),
    seller: draft.sellers.map((party, index) => governmentParty(party, "sell", index)),
  };
  if (hasParking) tab.case_park = draft.parking.items.map((item, index) => governmentParking(item, index, draft.parking.pricingMode));
  if (draft.lists.land.enabled) tab.case_land = draft.lists.land.items.map((item, index) => governmentListItem(item, "land", index, draft));
  if (draft.lists.build.enabled) tab.case_build = draft.lists.build.items.map((item, index) => governmentListItem(item, "build", index, draft));
  if (draft.lists.base.enabled) tab.case_base = draft.lists.base.items.map((item, index) => governmentListItem(item, "base", index, draft));

  return {
    case_master: {
      case_type: "A", case_no: "", case_kind: draft.applicantKind,
      case_x45: draft.location.cityCode, case_unit: draft.location.officeCode,
      caseflag: "", apply_caid: "", notify_type: "", tab_cnt: 1,
    },
    case_detail: { tab1: tab },
  };
}

export function createCandidateBasename(draft, now = new Date()) {
  const buyerId = normalizeId(draft.buyers[0]?.idNumber || "") || "NOID";
  const rocYear = String(now.getFullYear() - 1911).padStart(3, "0");
  const stamp = `${rocYear}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `RPS0401_${buyerId}_${stamp}`;
}

export function createSingleFileZip(filename, content, now = new Date()) {
  const encoder = new TextEncoder();
  const name = encoder.encode(filename);
  const data = encoder.encode(content);
  const crc = crc32(data);
  const dos = dosDateTime(now);
  const local = new Uint8Array(30 + name.length + data.length);
  const lv = new DataView(local.buffer);
  write32(lv, 0, 0x04034b50); write16(lv, 4, 20); write16(lv, 6, 0x0800); write16(lv, 8, 0);
  write16(lv, 10, dos.time); write16(lv, 12, dos.date); write32(lv, 14, crc); write32(lv, 18, data.length); write32(lv, 22, data.length);
  write16(lv, 26, name.length); write16(lv, 28, 0); local.set(name, 30); local.set(data, 30 + name.length);

  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  write32(cv, 0, 0x02014b50); write16(cv, 4, 20); write16(cv, 6, 20); write16(cv, 8, 0x0800); write16(cv, 10, 0);
  write16(cv, 12, dos.time); write16(cv, 14, dos.date); write32(cv, 16, crc); write32(cv, 20, data.length); write32(cv, 24, data.length);
  write16(cv, 28, name.length); write16(cv, 30, 0); write16(cv, 32, 0); write16(cv, 34, 0); write16(cv, 36, 0); write32(cv, 38, 0); write32(cv, 42, 0);
  central.set(name, 46);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  write32(ev, 0, 0x06054b50); write16(ev, 4, 0); write16(ev, 6, 0); write16(ev, 8, 1); write16(ev, 10, 1);
  write32(ev, 12, central.length); write32(ev, 16, local.length); write16(ev, 20, 0);
  return concatBytes(local, central, end);
}

export function copyCaseTargetsToConditionalList(draft, caseState, type) {
  const location = draft.location;
  if (type === "land" || type === "base") {
    draft.lists[type].items = (caseState.lands || []).map((item) => ({
      sectionCode: "", sectionName: [item.section, item.subsection].filter(Boolean).join("段") + (item.subsection ? "小段" : "段"),
      number: item.landNumber || "", numerator: item.shareNumerator || "", denominator: item.shareDenominator || "",
      cityCode: location.cityCode, districtCode: location.districtCode,
    }));
  } else {
    draft.lists.build.items = (caseState.buildings || []).map((item) => ({
      sectionCode: "", sectionName: [item.sourceSection, item.sourceSubsection].filter(Boolean).join("段") + (item.sourceSubsection ? "小段" : "段"),
      number: item.buildingNumber || "", cityCode: location.cityCode, districtCode: location.districtCode,
    }));
  }
  return draft.lists[type].items;
}

function mergeDraft(saved) {
  const clean = createRealPriceFilingDraft();
  return deepMerge(clean, saved);
}

function deepMerge(base, value) {
  if (Array.isArray(base)) return Array.isArray(value) ? value : base;
  if (!base || typeof base !== "object") return value ?? base;
  const result = { ...base };
  for (const key of Object.keys(base)) result[key] = key in (value || {}) ? deepMerge(base[key], value[key]) : base[key];
  return result;
}

function distinctCaseParties(parties) {
  const result = [];
  const seen = new Set();
  for (const party of parties) {
    const role = party.title === "權利人" ? "buyer" : party.title === "義務人" ? "seller" : "";
    if (!role) continue;
    const key = `${role}|${normalizeId(party.idNumber) || party.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...party, role });
  }
  return result;
}

function syncPartyGroup(existing, sources, codeRows) {
  const bySource = new Map(existing.map((item) => [item.sourceId, item]));
  const synced = sources.map((source) => {
    const current = bySource.get(source.id);
    const split = splitGovernmentAddress(source.address || "", codeRows);
    if (!current) return {
      sourceId: source.id, name: source.name || "", idNumber: source.idNumber || "", phone: source.phoneNote || "", email: "",
      cityCode: split.cityCode, cityName: split.cityName, districtCode: split.districtCode, districtName: split.districtName,
      addressRemainder: split.addressRemainder, manual: {},
    };
    const incoming = { name: source.name || "", idNumber: source.idNumber || "", phone: source.phoneNote || "" };
    for (const [field, value] of Object.entries(incoming)) if (!current.manual?.[field]) current[field] = value;
    return current;
  });
  return [...synced, ...existing.filter((item) => String(item.sourceId || "").startsWith("manual-"))];
}

function inferCaseLocation(caseState, codeRows) {
  const rawValues = [
    ...(caseState?.lands || []).map((item) => item.locationRaw),
    ...(caseState?.buildings || []).map((item) => item.address),
  ].filter(Boolean);
  const candidates = [];
  for (const raw of rawValues) {
    const normalized = normalizeTaiwanText(raw);
    const exact = codeRows.filter((row) => normalized.includes(normalizeTaiwanText(row.cityName)) && normalized.includes(normalizeTaiwanText(row.districtName)));
    candidates.push(...exact);
  }
  if (!candidates.length && caseState?.caseInfo?.district) {
    const district = normalizeTaiwanText(caseState.caseInfo.district);
    const cityHints = rawValues.map(normalizeTaiwanText);
    candidates.push(...codeRows.filter((row) => normalizeTaiwanText(row.districtName) === district && cityHints.some((value) => value.includes(normalizeTaiwanText(row.cityName)))));
  }
  const unique = uniqueBy(candidates, (row) => `${row.cityCode}|${row.districtCode}`);
  return unique.length === 1 ? unique[0] : null;
}

function validateParties(parties, key, label, codeRows, warn, error) {
  parties.forEach((party, index) => {
    const prefix = `${key}-${index}`;
    if (!party.name.trim()) warn(prefix, `${label} ${index + 1} 缺少姓名。`);
    const id = normalizeId(party.idNumber);
    if (!id) warn(prefix, `${label} ${index + 1} 缺少證號。`);
    else if (id.length > 10) error(prefix, `${label} ${index + 1} 的證號超過 10 碼。`);
    if (!party.phone.trim()) warn(prefix, `${label} ${index + 1} 缺少聯絡電話。`);
    const hasAddressCodes = Boolean(party.cityCode && party.districtCode);
    if (!hasAddressCodes) warn(prefix, `${label} ${index + 1} 的地址縣市、行政區尚未確認。`);
    else if (!codeRows.some((row) => row.cityCode === party.cityCode && row.districtCode === party.districtCode)) error(prefix, `${label} ${index + 1} 的地址代碼不符合官方代碼表。`);
    if (!party.addressRemainder.trim()) warn(prefix, `${label} ${index + 1} 缺少其餘地址。`);
  });
}

function validateAgent(agent, codeRows, warn, error) {
  if (!agent.name.trim()) warn("agent", "申報代理人缺少姓名。");
  const id = normalizeId(agent.idNumber);
  if (!id) warn("agent", "申報代理人缺少證號。");
  else if (id.length > 10) error("agent", "申報代理人證號超過 10 碼。");
  if (!agent.phone.trim()) warn("agent", "申報代理人缺少電話。");
  if (agent.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agent.email.trim())) error("agent", "申報代理人 Email 格式不正確。");
  const hasAddressCodes = Boolean(agent.cityCode && agent.districtCode);
  if (!hasAddressCodes) warn("agent", "申報代理人地址代碼尚未確認。");
  else if (!codeRows.some((row) => row.cityCode === agent.cityCode && row.districtCode === agent.districtCode)) error("agent", "申報代理人地址代碼不符合官方代碼表。");
  if (!agent.addressRemainder.trim()) warn("agent", "申報代理人缺少其餘地址。");
  if (!agent.entrustType) warn("agent", "申報代理人的委任關係尚未確認。");
  else if (agent.entrustType !== "2") error("agent", "目前候選規格的代理委任關係代碼不正確。");
}

function validateParking(draft, warn, error) {
  if (draft.transaction.propertyType === "land-only") return;
  const forced = draft.transaction.propertyType === "parking-only";
  if (!forced && !["yes", "no"].includes(draft.parking.hasParking)) {
    if (!draft.parking.hasParking) warn("parking", "請確認本案有無車位交易。");
    else error("parking", "有無車位交易的代碼不正確。");
    return;
  }
  const hasParking = forced || draft.parking.hasParking === "yes";
  if (!hasParking) return;
  if (!draft.parking.pricingMode) warn("parking", "請確認車位是否單獨計價。");
  else if (!["0", "1"].includes(draft.parking.pricingMode)) error("parking", "車位計價代碼不正確。");
  if (!draft.parking.items.length) warn("parking", "有車位交易時至少要有一筆車位清冊。");
  draft.parking.items.forEach((item, index) => {
    if (!item.type) warn("parking", `車位 ${index + 1} 缺少類別。`);
    else if (!CAR_TYPES.some(([code]) => code === item.type)) error("parking", `車位 ${index + 1} 的類別代碼不正確。`);
    if (item.type === "7" && !item.typeText?.trim()) warn("parking", `車位 ${index + 1} 選擇其他類別時須填說明。`);
    if (!item.floor) warn("parking", `車位 ${index + 1} 缺少樓層。`);
    else if (!CAR_FLOORS.some(([code]) => code === item.floor)) error("parking", `車位 ${index + 1} 的樓層代碼不正確。`);
    if (draft.parking.pricingMode === "0") {
      if (!String(item.price || "").trim()) warn("parking", `車位 ${index + 1} 缺少單獨價格。`);
      else if (!isWholeMoney(item.price)) error("parking", `車位 ${index + 1} 的單獨價格須為整數。`);
    }
  });
  if (draft.parking.pricingMode === "0") {
    if (!String(draft.parking.totalPrice || "").trim()) warn("parking", "請填車位交易總價。");
    else if (!isWholeMoney(draft.parking.totalPrice)) error("parking", "車位交易總價須為整數。");
    const sum = draft.parking.items.reduce((total, item) => total + Number(normalizeInteger(item.price) || 0), 0);
    if (isWholeMoney(draft.parking.totalPrice) && draft.parking.items.every((item) => isWholeMoney(item.price)) && sum !== Number(normalizeInteger(draft.parking.totalPrice))) error("parking", "各車位價格合計須等於車位交易總價。");
  }
}

function validateFees(draft, warn, error) {
  for (const field of ["p1sp_code0101", "p1sp_code0102", "p1sp_code0103", "p1sp_code0104", "p1sp_code0105", "p1sp_code0106"]) {
    if (draft.fees[field] && draft.fees[field.replace("code", "price")] && !isWholeMoney(draft.fees[field.replace("code", "price")])) error("fees", "非不動產費用金額須為整數，或留空表示無法拆分。");
  }
  if (draft.fees.p1sp_code0106 && !draft.fees.p1sp_desc0106.trim()) warn("fees", "勾選其他費用時須填種類說明。");
}

function validateConditionalLists(draft, sectionRows, warn, error) {
  for (const type of ["land", "build", "base"]) {
    const list = draft.lists[type];
    if (!list.enabled) continue;
    if (!list.items.length) warn(`list-${type}`, `已啟用備註清冊但尚無資料。`);
    list.items.forEach((item, index) => {
      const hasSection = Boolean(item.sectionCode && item.sectionName && item.number?.trim());
      const sectionMatch = sectionRows.some((section) => section.cityCode === (item.cityCode || draft.location.cityCode)
        && section.districtCode === (item.districtCode || draft.location.districtCode)
        && section.officeCode === draft.location.officeCode
        && section.code === item.sectionCode
        && section.name === item.sectionName);
      if (!hasSection) warn(`list-${type}`, `清冊第 ${index + 1} 筆尚未完整填寫官方段小段與標的號碼。`);
      else if (!sectionMatch) error(`list-${type}`, `清冊第 ${index + 1} 筆的段小段代碼與目前管轄地所不一致。`);
      if (type !== "build") {
        const numerator = String(item.numerator || "").trim();
        const denominator = String(item.denominator || "").trim();
        if (!numerator || !denominator) warn(`list-${type}`, `清冊第 ${index + 1} 筆權利範圍不完整。`);
        else if (!isWholeNumber(numerator) || !isWholeNumber(denominator) || Number(denominator) === 0) error(`list-${type}`, `清冊第 ${index + 1} 筆權利範圍格式不正確。`);
      }
    });
  }
}

function validateBinaryChoice(value, key, message, warn, error) {
  if (!value) warn(key, message);
  else if (!["0", "1"].includes(value)) error(key, `${message.replace(/。$/, "")}代碼不正確。`);
}

function governmentParty(party, prefix, index) {
  return {
    [`${prefix}_seq`]: String(index + 1), [`${prefix}_sign`]: "", [`${prefix}_name`]: party.name.trim(),
    [`${prefix}_id`]: normalizeId(party.idNumber), [`${prefix}_tel`]: normalizePhone(party.phone), [`${prefix}_mail`]: party.email.trim(),
    [`${prefix}_x45`]: party.cityCode, [`${prefix}_x45c`]: party.cityName, [`${prefix}_x46`]: party.districtCode,
    [`${prefix}_x46c`]: party.districtName, [`${prefix}_addr`]: party.addressRemainder.trim(),
  };
}

function governmentParking(item, index, pricingMode) {
  return {
    car_seq: String(index + 1), car_type: item.type, car_typec: CAR_TYPES.find(([code]) => code === item.type)?.[1] || "",
    car_typeText: item.type === "7" ? String(item.typeText || "").trim() : "", car_price: pricingMode === "0" ? normalizeInteger(item.price) : "",
    car_area: normalizeDecimal(item.area), car_floor: item.floor, car_floorc: CAR_FLOORS.find(([code]) => code === item.floor)?.[1] || "",
  };
}

function governmentListItem(item, prefix, index, draft) {
  const base = {
    [`${prefix}_seq`]: String(index + 1), [`${prefix}_x48`]: item.sectionCode.trim(), [`${prefix}_x48c`]: `${draft.location.districtName}-${item.sectionName.trim()}`,
    [`${prefix}_x45`]: item.cityCode || draft.location.cityCode, [`${prefix}_x45c`]: "",
    [`${prefix}_x46`]: item.districtCode || draft.location.districtCode, [`${prefix}_x46c`]: "",
    [`${prefix}_no`]: item.number.trim(),
  };
  if (prefix !== "build") Object.assign(base, {
    [`${prefix}_rightc`]: "", [`${prefix}_rightDeno`]: normalizeInteger(item.numerator), [`${prefix}_rightNume`]: normalizeInteger(item.denominator),
  });
  return base;
}

function isWholeMoney(value, { positive = false } = {}) {
  const raw = String(value || "").replaceAll(",", "").trim();
  return /^\d+$/.test(raw) && (!positive || Number(raw) > 0);
}

function isWholeNumber(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

function normalizeInteger(value) {
  const raw = String(value ?? "").replaceAll(",", "").trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : "";
}

function normalizeDecimal(value) {
  const raw = String(value ?? "").replaceAll(",", "").trim();
  return /^\d+(?:\.\d+)?$/.test(raw) ? raw : "";
}

function normalizeId(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/[\s()-]/g, "");
}

function normalizeTaiwanText(value) {
  return String(value || "").trim().replaceAll("台", "臺");
}

function emptyAddress() {
  return { cityCode: "", cityName: "", districtCode: "", districtName: "", addressRemainder: "" };
}

function uniqueBy(items, selector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = selector(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pad2(value) { return String(value).padStart(2, "0"); }

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view, offset, value) { view.setUint16(offset, value, true); }
function write32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
