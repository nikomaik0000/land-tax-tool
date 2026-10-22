export const AGENT_STORAGE_KEY = "land-tax-tool:frequent-agents:v1";

export function createAuthorizationDocumentState() {
  return {
    houseTax: {
      principalPartyId: "",
      buildingIds: [],
      agentMode: "saved",
      agentId: "",
      manualAgent: blankAgent(),
      applicationItems: ["房屋稅稅籍證明"],
    },
    realPrice: {
      agentMode: "saved",
      agentId: "",
      manualAgent: blankAgent(),
      city: "",
      district: "",
      propertyDescription: "",
      propertyFontMode: "auto",
      propertyFontSize: 12,
      matter: "申報登錄資訊",
      locationManual: false,
      propertyDescriptionManual: false,
    },
  };
}

export function normalizeAuthorizationDocumentState(value = {}) {
  const defaults = createAuthorizationDocumentState();
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const houseTax = source.houseTax || {};
  const realPrice = source.realPrice || {};
  return {
    houseTax: {
      ...defaults.houseTax,
      ...houseTax,
      buildingIds: Array.isArray(houseTax.buildingIds) ? [...houseTax.buildingIds] : [],
      applicationItems: Array.isArray(houseTax.applicationItems) ? [...houseTax.applicationItems] : [...defaults.houseTax.applicationItems],
      manualAgent: normalizeAgent(houseTax.manualAgent),
    },
    realPrice: {
      ...defaults.realPrice,
      ...realPrice,
      manualAgent: normalizeAgent(realPrice.manualAgent),
    },
  };
}

export function addAuthorizationAgentSnapshots(documents, agents = []) {
  const snapshot = normalizeAuthorizationDocumentState(documents);
  [snapshot.houseTax, snapshot.realPrice].forEach((documentState) => {
    const selected = documentState.agentMode === "saved" ? agents.find((agent) => agent.id === documentState.agentId) : null;
    documentState.savedAgentSnapshot = selected ? normalizeAgent(selected) : normalizeAgent(documentState.savedAgentSnapshot);
  });
  return snapshot;
}

export function restoreAuthorizationAgentSnapshots(documents, agents = []) {
  const restored = normalizeAuthorizationDocumentState(documents);
  [restored.houseTax, restored.realPrice].forEach((documentState) => {
    if (documentState.agentMode !== "saved" || !documentState.agentId || agents.some((agent) => agent.id === documentState.agentId)) return;
    if (!documentState.savedAgentSnapshot?.name) return;
    documentState.agentMode = "manual";
    documentState.agentId = "";
    documentState.manualAgent = normalizeAgent(documentState.savedAgentSnapshot);
  });
  return restored;
}

export function loadAgents(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(AGENT_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.map(normalizeAgent).filter((item) => item.id) : [];
  } catch {
    return [];
  }
}

export function saveAgents(agents, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(AGENT_STORAGE_KEY, JSON.stringify(agents.map(normalizeAgent)));
}

export function upsertAgent(agents, input, idFactory = defaultIdFactory) {
  const agent = normalizeAgent({ ...input, id: input.id || idFactory() });
  const index = agents.findIndex((item) => item.id === agent.id);
  if (index < 0) return [...agents, agent];
  return agents.map((item, itemIndex) => itemIndex === index ? agent : item);
}

export function removeAgent(agents, id) {
  return agents.filter((item) => item.id !== id);
}

export function getHouseTaxPrincipalCandidates(caseState) {
  return distinctRoleParties(caseState.parties, "義務人");
}

export function getRealPriceEntrustors(caseState) {
  return [
    ...distinctRoleParties(caseState.parties, "權利人"),
    ...distinctRoleParties(caseState.parties, "義務人"),
  ];
}

export function buildCaseDocumentFieldMap(caseState) {
  const rights = distinctRoleParties(caseState.parties, "權利人");
  const obligors = distinctRoleParties(caseState.parties, "義務人");
  const location = inferAdministrativeLocation(caseState);
  const buildings = caseState.buildings.map((item) => ({
    id: item.id,
    buildingNumber: clean(item.buildingNumber),
    address: clean(item.address),
    transferShare: formatShare(item.shareNumerator, item.shareDenominator),
    label: [clean(item.buildingNumber), clean(item.address)].filter(Boolean).join("｜"),
  }));
  const lands = caseState.lands.map((item) => ({
    id: item.id,
    city: clean(location.city),
    district: clean(item.district || caseState.caseInfo.district),
    section: clean(item.section),
    subsection: clean(item.subsection),
    landNumber: clean(item.landNumber),
    transferShare: formatShare(item.shareNumerator, item.shareDenominator),
    label: formatLandTarget(item, caseState.caseInfo.district, location.city),
  }));
  return {
    parties: { rights, obligors },
    buildings,
    lands,
    registration: {
      reason: clean(caseState.caseInfo.registrationReason),
      reasonDate: clean(caseState.caseInfo.reasonDate),
    },
    location,
    propertyDescription: formatRealPricePropertyDescription(lands, buildings),
  };
}

export function syncAuthorizationDefaults(caseState, documents) {
  const map = buildCaseDocumentFieldMap(caseState);
  const principalIds = new Set(map.parties.obligors.map((item) => item.id));
  if (!principalIds.has(documents.houseTax.principalPartyId)) {
    documents.houseTax.principalPartyId = map.parties.obligors.length === 1 ? map.parties.obligors[0].id : "";
  }

  const buildingIds = new Set(map.buildings.map((item) => item.id));
  documents.houseTax.buildingIds = documents.houseTax.buildingIds.filter((id) => buildingIds.has(id));
  if (!documents.houseTax.buildingIds.length && map.buildings.length === 1) {
    documents.houseTax.buildingIds = [map.buildings[0].id];
  }

  if (!documents.realPrice.locationManual) {
    documents.realPrice.city = map.location.city;
    documents.realPrice.district = map.location.district;
  }
  if (!documents.realPrice.propertyDescriptionManual) {
    documents.realPrice.propertyDescription = map.propertyDescription;
  }
  return map;
}

export function resolveDocumentAgent(documentState, agents) {
  if (documentState.agentMode === "manual") return normalizeAgent(documentState.manualAgent);
  return agents.find((item) => item.id === documentState.agentId) || blankAgent();
}

export function validateHouseTaxDocument(caseState, documentState, agents = []) {
  const map = buildCaseDocumentFieldMap(caseState);
  const principal = map.parties.obligors.find((item) => item.id === documentState.principalPartyId);
  const agent = resolveDocumentAgent(documentState, agents);
  const warnings = [];
  if (!map.parties.obligors.length) warnings.push("案件中沒有可選擇的義務人");
  else if (!principal) warnings.push("請選擇一位義務人作為委任人");
  if (principal && !principal.name) warnings.push("委任人姓名缺漏");
  if (principal && !principal.idNumber) warnings.push("委任人身分證統一編號缺漏");
  if (!documentState.buildingIds.length) warnings.push("請選擇至少一筆申請建物");
  documentState.buildingIds.forEach((id) => {
    const building = map.buildings.find((item) => item.id === id);
    if (building && !building.address) warnings.push(`建物 ${building.buildingNumber || id} 的完整房屋坐落缺漏`);
  });
  if (!documentState.applicationItems.includes("房屋稅稅籍證明")) warnings.push("尚未勾選房屋稅稅籍證明");
  appendAgentWarnings(warnings, agent, "代理人", { includeAddress: false });
  return unique(warnings);
}

export function validateRealPriceDocument(caseState, documentState, agents = []) {
  const map = buildCaseDocumentFieldMap(caseState);
  const entrustors = getRealPriceEntrustors(caseState);
  const agent = resolveDocumentAgent(documentState, agents);
  const warnings = [];
  if (!map.parties.rights.length) warnings.push("案件中沒有適用的權利人");
  if (!map.parties.obligors.length) warnings.push("案件中沒有適用的義務人");
  entrustors.forEach((party) => {
    const prefix = `${party.title}${party.name ? `「${party.name}」` : ""}`;
    if (!party.name) warnings.push(`${party.title}姓名缺漏`);
    if (!party.idNumber) warnings.push(`${prefix}身分證統一編號缺漏`);
    if (!party.address) warnings.push(`${prefix}地址缺漏`);
  });
  appendAgentWarnings(warnings, agent, "受託人");
  if (!documentState.city) warnings.push("縣市待填");
  if (!documentState.district) warnings.push("行政區待填");
  if (!documentState.propertyDescription) warnings.push("不動產標的待填");
  if (!documentState.propertyDescriptionManual) {
    [...map.lands, ...map.buildings].forEach((item) => {
      if (!item.transferShare) warnings.push(`${item.label || item.id}的本次買賣移轉持分待確認`);
    });
  }
  return unique(warnings);
}

export function getRealPriceLayoutRule(caseState) {
  const map = buildCaseDocumentFieldMap(caseState);
  const count = map.parties.rights.length + map.parties.obligors.length;
  if (count <= 2) {
    return { mode: "single-page", label: `${count} 位委託人：使用官方第一頁主表`, requiresAppendix: false, extensionCandidate: false };
  }
  return {
    mode: "appendix",
    label: `${count} 位委託人：官方版使用附表${count <= 4 ? "；3～4 人單頁延伸版待受理機關確認" : ""}`,
    requiresAppendix: true,
    extensionCandidate: count <= 4,
  };
}

export function buildHouseTaxPreviewData(caseState, documentState, agents = []) {
  const map = buildCaseDocumentFieldMap(caseState);
  return {
    principal: map.parties.obligors.find((item) => item.id === documentState.principalPartyId) || null,
    buildings: documentState.buildingIds.map((id) => map.buildings.find((item) => item.id === id)).filter(Boolean),
    agent: resolveDocumentAgent(documentState, agents),
    applicationItems: [...documentState.applicationItems],
    warnings: validateHouseTaxDocument(caseState, documentState, agents),
  };
}

export function buildRealPricePreviewData(caseState, documentState, agents = []) {
  const entrustors = getRealPriceEntrustors(caseState).map(formatRealPricePersonAddress);
  const agent = formatRealPricePersonAddress(resolveDocumentAgent(documentState, agents));
  return {
    entrustors,
    agent,
    city: clean(documentState.city),
    district: clean(documentState.district),
    propertyDescription: clean(documentState.propertyDescription),
    propertyFontMode: documentState.propertyFontMode === "manual" ? "manual" : "auto",
    propertyFontSize: normalizePropertyFontSize(documentState.propertyFontSize),
    matter: clean(documentState.matter),
    layoutRule: getRealPriceLayoutRule(caseState),
    warnings: validateRealPriceDocument(caseState, documentState, agents),
  };
}

function normalizePropertyFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 12;
  return Math.min(13, Math.max(9, Math.round(numeric * 2) / 2));
}

export function formatRealPriceAddress(value) {
  return clean(value)
    .replace(
      /(縣|市|區|鄉|鎮)([^縣市區鄉鎮村路街巷弄號樓\d\s]{1,12}里)(?=(?:(?:第)?[0-9０-９一二三四五六七八九十百〇○]+鄰)|(?:[^縣市區鄉鎮村路街巷弄號樓\d\s]{1,20}(?:大道|路|街|巷|弄))|(?:[0-9０-９]+號))/g,
      "$1",
    )
    .replace(/(?:第)?[0-9０-９一二三四五六七八九十百〇○]+鄰/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatRealPricePersonAddress(person) {
  return { ...person, address: formatRealPriceAddress(person?.address) };
}

function distinctRoleParties(parties, title) {
  const seen = new Set();
  return parties.filter((party) => party.title === title).filter((party) => {
    const key = partyIdentityKey(party);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((party) => ({
    id: party.id,
    title,
    name: clean(party.name),
    idNumber: clean(party.idNumber),
    birthDate: clean(party.birthDate),
    address: clean(party.address),
    phone: getPartyPhone(party),
  }));
}

function getPartyPhone(party) {
  return clean((party.originalSources || []).map((item) => item.phone).find(Boolean) || party.original?.phone || party.phoneNote);
}

function partyIdentityKey(party) {
  const id = clean(party.idNumber).replace(/[\s-]/g, "").toUpperCase();
  return id || `record:${party.id}`;
}

function inferAdministrativeLocation(caseState) {
  const addresses = caseState.buildings.map((item) => clean(item.address)).filter(Boolean);
  const cities = unique(addresses.map((address) => address.match(/^(.+?[市縣])/)?.[1] || "").filter(Boolean));
  const districts = unique([
    clean(caseState.caseInfo.district),
    ...addresses.map((address) => address.match(/[市縣](.+?[區鄉鎮市])/)?.[1] || ""),
  ].filter(Boolean));
  return {
    city: cities.length === 1 ? cities[0] : "",
    district: districts.length === 1 ? districts[0] : "",
    cityNeedsConfirmation: cities.length !== 1,
    districtNeedsConfirmation: districts.length !== 1,
  };
}

function formatLandTarget(item, fallbackDistrict, fallbackCity = "") {
  const sectionName = clean(item.section);
  const subsectionName = clean(item.subsection);
  const section = `${sectionName}${sectionName ? "段" : ""}${subsectionName}${subsectionName ? "小段" : ""}`;
  const number = clean(item.landNumber);
  return [clean(item.city || fallbackCity), clean(item.district || fallbackDistrict), section, number ? `${number}地號` : ""].filter(Boolean).join("");
}

function formatRealPricePropertyDescription(lands, buildings) {
  const lines = [
    ...lands.map((item) => {
      const section = [item.section ? `${item.section}段` : "", item.subsection ? `${item.subsection}小段` : ""].filter(Boolean).join("");
      const target = [item.city, item.district, section, item.landNumber ? `${item.landNumber}地號` : ""].filter(Boolean).join("");
      return target ? `${target}　持分：${item.transferShare || "待確認"}` : "";
    }),
    ...buildings.map((item) => item.address ? `${item.address}　持分：${item.transferShare || "待確認"}` : ""),
  ].filter(Boolean);
  return lines.length ? `不動產坐落：\n${lines.join("\n")}` : "";
}

function appendAgentWarnings(warnings, agent, label, { includeAddress = true } = {}) {
  if (!agent.name) warnings.push(`請選擇或輸入${label}`);
  if (!agent.idNumber) warnings.push(`${label}身分證統一編號缺漏`);
  if (includeAddress && !agent.address) warnings.push(`${label}通訊地址缺漏`);
}

function formatShare(numerator, denominator) {
  const top = clean(numerator);
  const bottom = clean(denominator);
  return top && bottom && Number(bottom) !== 0 ? `${top}/${bottom}` : "";
}

function blankAgent() {
  return { id: "", name: "", idNumber: "", phone: "", email: "", address: "" };
}

function normalizeAgent(input = {}) {
  return {
    id: clean(input.id),
    name: clean(input.name),
    idNumber: clean(input.idNumber),
    phone: clean(input.phone),
    email: clean(input.email),
    address: clean(input.address),
  };
}

function defaultIdFactory() {
  return globalThis.crypto?.randomUUID?.() || `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function unique(items) {
  return [...new Set(items)];
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}
