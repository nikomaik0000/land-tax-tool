import { formatLandNumber } from "./formatters.js";

export const CASE_TYPES = [
  ["sale", "買賣"],
  ["gift", "贈與"],
  ["inheritance", "繼承"],
  ["mortgage", "設定"],
  ["cancellation", "塗銷"],
  ["other", "其他"],
];

const REGISTRATION_REASON_MAP = {
  "21": { label: "買賣", caseType: "sale" },
  "25": { label: "贈與", caseType: "gift" },
};

const PARTY_ROLE_SUGGESTIONS = {
  sale: ["權利人", "義務人"],
  gift: ["權利人", "義務人"],
  inheritance: ["繼承人", "被繼承人"],
  mortgage: ["權利人", "債務人", "義務人"],
  cancellation: [],
  other: [],
};

const FOUR_STEP_ITEMS = [
  ["filing", "申報"],
  ["arrears", "查欠"],
  ["pickup", "領件"],
  ["notarization", "公證"],
];

const PROGRESS_DEFINITIONS = {
  sale: [taxGroup("land-value-tax", "土地增值稅", FOUR_STEP_ITEMS), taxGroup("deed-tax", "契稅", FOUR_STEP_ITEMS)],
  gift: [taxGroup("land-value-tax", "土地增值稅", FOUR_STEP_ITEMS), taxGroup("deed-tax", "契稅", FOUR_STEP_ITEMS)],
  inheritance: [taxGroup("estate-tax", "遺產稅", Array.from({ length: 6 }, (_, index) => [
    `item-${index + 1}`,
    `項目${toChineseNumber(index + 1)}（待確認）`,
    true,
  ]))],
  mortgage: [],
  cancellation: [],
  other: [],
};

export function createCaseDocumentState() {
  const progressValues = {};
  const progressLabels = {};
  Object.values(PROGRESS_DEFINITIONS).flat().forEach((group) => {
    group.items.forEach((item) => {
      progressValues[`${group.id}:${item.id}`] = "";
      progressLabels[`${group.id}:${item.id}`] = item.label;
    });
  });

  return {
    sequence: 0,
    caseInfo: {
      district: "",
      districtManual: false,
      districtSources: [],
      caseNumber: "",
      registrationReason: "",
      registrationReasonManual: false,
      registrationReasonCode: "",
      registrationReasonCodes: [],
      reasonDate: "",
      reasonDateRaw: "",
      reasonDateManual: false,
      caseType: "",
      caseTypeManual: false,
      otherCaseType: "",
    },
    partySettings: {
      showShare: true,
      shareVisibilityMode: "auto",
      mergeDebtorAndObligor: false,
    },
    parties: [],
    progressValues,
    progressLabels,
    lands: [],
    buildings: [],
    commonParts: [],
    buildingMeta: {
      material: "",
      totalFloors: "",
      materialManual: false,
      materialNeedsConfirmation: false,
      totalFloorsNeedsConfirmation: true,
    },
    notices: [],
    importedFiles: [],
  };
}

export function getProgressGroups(caseType) {
  return PROGRESS_DEFINITIONS[caseType] || [];
}

export function getPartyRoleSuggestions(caseType) {
  return PARTY_ROLE_SUGGESTIONS[caseType] || [];
}

export function reconcileImportedPartyRoles(state) {
  if (state.caseInfo.caseType !== "sale" && state.caseInfo.caseType !== "gift") return;
  state.parties.forEach((party) => {
    if (!party.imported || party.titleManual) return;
    if (party.importRoleKey === "old-owner") party.title = "義務人";
    if (party.importRoleKey === "new-owner") party.title = "權利人";
    party.sourceRoleHint = party.importRoleKey === "old-owner"
      ? "CSV 舊權利人（已確認對應義務人）"
      : "CSV 新權利人（已確認對應權利人）";
  });
}

export function reconcilePartyShareVisibility(state) {
  if (state.partySettings.shareVisibilityMode === "manual") return state.partySettings.showShare;
  if (state.caseInfo.caseType !== "sale" && state.caseInfo.caseType !== "gift") {
    state.partySettings.showShare = true;
    return true;
  }
  const rights = countDistinctPartiesByTitle(state.parties, "權利人");
  const obligors = countDistinctPartiesByTitle(state.parties, "義務人");
  state.partySettings.showShare = rights > 0 && obligors > 0 ? rights > 1 || obligors > 1 : true;
  return state.partySettings.showShare;
}

export function addLandFromParsed(state, parsed, { sourceFileId = "" } = {}) {
  const location = parseLandLocation(parsed.parcel.locationRaw);
  const land = {
    id: nextId(state, "land"),
    sourceFileId,
    district: location.district,
    section: location.section,
    subsection: location.subsection,
    locationLabel: location.sectionAndSubsection,
    locationNeedsConfirmation: location.needsConfirmation,
    locationRaw: nullableInput(parsed.parcel.locationRaw),
    landNumber: location.landNumber || formatLandNumber(parsed.parcel.registrationMarkRaw?.slice(-8) || ""),
    area: nullableInput(parsed.parcel.area),
    announcedCurrentValue: nullableInput(parsed.parcel.announcedCurrentValue),
    shareNumerator: nullableInput(parsed.parcel.transactionShare.numerator),
    shareDenominator: nullableInput(parsed.parcel.transactionShare.denominator),
    totalCurrentValue: nullableInput(parsed.parcel.sourceTotalCurrentValue),
    previousTransfers: parsed.parcel.previousTransfers.map((item) => ({ ...item })),
    previousTransferText: formatPreviousTransfers(parsed.parcel.previousTransfers),
    sourceTotalPreserved: true,
  };
  state.lands.push(land);

  addDistrictSource(state, location.district, "land", sourceFileId);
  applyRegistrationReasonCode(state, parsed.registrationReasonCode);
  if (!state.caseInfo.reasonDate) {
    const rawDate = nullableInput(parsed.rawFields.TRD_DATE || parsed.rawFields.FLG_DATE);
    state.caseInfo.reasonDateRaw = rawDate;
    state.caseInfo.reasonDate = formatRocDate(rawDate);
  }
  addImportedParties(state, parsed.parties, "land", {
    kind: "land",
    targetNumber: land.landNumber,
    targetNumberRaw: parsed.parcel.registrationMarkRaw?.slice(-8) || "",
  }, sourceFileId);
  reconcileImportedPartyRoles(state);
  reconcilePartyShareVisibility(state);

  reconcileLandLocations(state);
  return land;
}

export function addBuildingFromParsed(state, parsed, { sourceFileId = "" } = {}) {
  const details = parsed.mainBuilding.floorDetails || [];
  const detailMapping = classifyBuildingDetails(details);
  const mainDetail = detailMapping.mainDetail;
  const ownerShare = parsed.parties.newOwners.length === 1 ? parsed.parties.newOwners[0].share : {};
  const buildingNumberRaw = parsed.mainBuilding.buildingNumberRaw || parsed.mainBuilding.buildingNumber || "";
  const building = {
    id: nextId(state, "building"),
    sourceFileId,
    buildingNumber: parsed.mainBuilding.buildingNumber || buildingNumberRaw,
    buildingNumberRaw,
    address: parsed.mainBuilding.address || "",
    floor: mainDetail?.floor || "",
    area: nullableInput(mainDetail?.area),
    shareNumerator: nullableInput(ownerShare.numerator),
    shareDenominator: nullableInput(ownerShare.denominator),
    currentValue: nullableInput(parsed.mainBuilding.sourceCurrentValue),
    taxNumber: parsed.mainBuilding.taxNumber || "",
    accessories: detailMapping.accessories,
    accessoryText: formatAccessories(detailMapping.accessories),
    sourceSection: parsed.mainBuilding.section || "",
    sourceSubsection: parsed.mainBuilding.subsection || "",
    detailMappingNeedsConfirmation: detailMapping.needsConfirmation,
    original: {
      buildingNumber: parsed.mainBuilding.buildingNumber || "",
      buildingNumberRaw,
      address: parsed.mainBuilding.address || "",
      floorDetails: details.map((item) => ({ ...item })),
    },
  };
  state.buildings.push(building);

  parsed.commonParts.forEach((item) => {
    state.commonParts.push({
      id: nextId(state, "common"),
      sourceFileId,
      buildingNumber: item.buildingNumber || item.buildingNumberRaw || "",
      buildingNumberRaw: item.buildingNumberRaw || item.buildingNumber || "",
      area: nullableInput(item.area),
      shareNumerator: nullableInput(item.share.numerator),
      shareDenominator: nullableInput(item.share.denominator),
      relatedMainBuildingNumber: building.buildingNumber,
      relatedMainBuildingNumberRaw: buildingNumberRaw,
      relationStatus: "source-file-main",
      original: { ...item },
    });
  });

  mergeBuildingMaterial(state, details.map((item) => item.structure).filter(Boolean));
  addDistrictSource(state, extractDistrictFromAddress(building.address), "building", sourceFileId);
  if (!state.caseInfo.reasonDate) {
    const rawDate = nullableInput(parsed.rawFields.CONTRCT_DATE);
    state.caseInfo.reasonDateRaw = rawDate;
    state.caseInfo.reasonDate = formatRocDate(rawDate);
  }
  addImportedParties(state, parsed.parties, "building", {
    kind: "building",
    targetNumber: building.buildingNumber,
    targetNumberRaw: buildingNumberRaw,
  }, sourceFileId);
  reconcileImportedPartyRoles(state);
  reconcilePartyShareVisibility(state);
  reconcileLandLocations(state);
  return building;
}

export function addBlankLand(state) {
  const land = {
    id: nextId(state, "land"), district: "", section: "", subsection: "", locationLabel: "",
    locationNeedsConfirmation: false, landNumber: "", area: "", announcedCurrentValue: "",
    shareNumerator: "", shareDenominator: "", totalCurrentValue: "", previousTransfers: [], previousTransferText: "",
    sourceTotalPreserved: true,
  };
  state.lands.push(land);
  return land;
}

export function addBlankBuilding(state) {
  const building = {
    id: nextId(state, "building"), buildingNumber: "", buildingNumberRaw: "", address: "", floor: "", area: "",
    shareNumerator: "", shareDenominator: "", currentValue: "", taxNumber: "",
    accessories: [], accessoryText: "", sourceSection: "", sourceSubsection: "",
    detailMappingNeedsConfirmation: false, original: null,
  };
  state.buildings.push(building);
  return building;
}

export function addBlankCommonPart(state) {
  const item = {
    id: nextId(state, "common"), buildingNumber: "", buildingNumberRaw: "", area: "", shareNumerator: "",
    shareDenominator: "", relatedMainBuildingNumber: "", relatedMainBuildingNumberRaw: "", relationStatus: "manual",
    original: null,
  };
  state.commonParts.push(item);
  return item;
}

export function addBlankParty(state, overrides = {}) {
  const party = {
    id: nextId(state, "party"),
    title: "",
    titleManual: false,
    name: "",
    birthDate: "",
    idNumber: "",
    address: "",
    share: "",
    shareManual: false,
    phoneNote: "",
    imported: false,
    sourceRoleHint: "",
    importFingerprint: "",
    importRoleKey: "",
    identityNeedsConfirmation: false,
    identityConflict: false,
    interests: [],
    original: null,
    originalSources: [],
    manualFields: [],
    ...overrides,
  };
  state.parties.push(party);
  return party;
}

export function reconcileCaseDistrict(state) {
  if (state.caseInfo.districtManual) return state.caseInfo.district;
  const districts = [...new Set(state.caseInfo.districtSources.map((item) => item.district).filter(Boolean))];
  state.caseInfo.district = districts.length === 1 ? districts[0] : "";
  if (districts.length > 1) addNotice(state, "土地與建物行政區不一致，請手動確認");
  return state.caseInfo.district;
}

export function reconcileLandLocations(state) {
  const candidates = state.buildings
    .filter((item) => item.sourceSection)
    .map((item) => ({ section: item.sourceSection, subsection: item.sourceSubsection || "" }));

  state.lands.forEach((land) => {
    if (!land.locationLabel || (land.section && !land.locationNeedsConfirmation)) return;
    const matches = candidates.filter(({ section, subsection }) => `${section}${subsection}` === land.locationLabel);
    const unique = uniqueBy(matches, (item) => `${item.section}|${item.subsection}`);
    if (unique.length !== 1) return;
    land.section = unique[0].section;
    land.subsection = unique[0].subsection;
    land.locationNeedsConfirmation = false;
  });
}

export function mergeSpans(rows, keySelector) {
  const spans = Array(rows.length).fill(0);
  let index = 0;
  while (index < rows.length) {
    const key = keySelector(rows[index]);
    if (!key) {
      spans[index] = 1;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < rows.length && keySelector(rows[end]) === key) end += 1;
    spans[index] = end - index;
    index = end;
  }
  return spans;
}

export function formatRocDate(value) {
  const raw = nullableInput(value);
  if (!raw) return "";
  const separated = raw.match(/^(\d{2,4})[.\/-](\d{1,2})(?:[.\/-](\d{1,2}))?$/);
  if (separated) return assembleRocDate(separated[1], separated[2], separated[3]);
  if (!/^\d+$/.test(raw)) return raw;

  let year;
  let month;
  let day;
  if (raw.length === 8 && Number(raw.slice(0, 4)) >= 1912) {
    year = String(Number(raw.slice(0, 4)) - 1911);
    month = raw.slice(4, 6);
    day = raw.slice(6, 8);
  } else if (raw.length === 7) {
    [year, month, day] = [raw.slice(0, 3), raw.slice(3, 5), raw.slice(5, 7)];
  } else if (raw.length === 6) {
    [year, month, day] = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)];
  } else if (raw.length === 5) {
    [year, month] = [raw.slice(0, 3), raw.slice(3, 5)];
  } else if (raw.length === 4) {
    [year, month] = [raw.slice(0, 2), raw.slice(2, 4)];
  } else {
    return raw;
  }
  return assembleRocDate(year, month, day) || raw;
}

export function formatPreviousTransfers(items) {
  if (!items.length) return "";
  return items.map((item) => {
    if (!item || item.parseStatus === "unrecognized") return "";
    const date = formatRocDate(item.transferYearMonth);
    const value = formatNumberText(item.announcedCurrentValue);
    const parts = [];
    if (date) parts.push(`日期：${date}`);
    if (value) parts.push(`金額：${value}`);
    return parts.join("　");
  }).filter(Boolean).join("\n");
}

export function formatBuildingNumberDisplay(value) {
  const raw = nullableInput(value);
  if (!raw) return "";
  const formattedMatch = raw.match(/^(\d+)-([1-9])000$/);
  if (formattedMatch) return `${Number(formattedMatch[1])}-${formattedMatch[2]}`;
  if (/^\d{8}$/.test(raw)) {
    const main = String(Number(raw.slice(0, 4)));
    const sub = raw.slice(4);
    if (sub === "0000") return main;
    if (/^[1-9]000$/.test(sub)) return `${main}-${sub[0]}`;
    return formatLandNumber(raw);
  }
  return raw;
}

export function formatAccessories(items) {
  return (items || []).map((item) => {
    const use = nullableInput(item.use ?? item.floor);
    const area = formatNumberText(item.area);
    return [use, area].filter(Boolean).join(" ");
  }).filter(Boolean).join("、");
}

export function formatBuildingAddressForCard(address, district) {
  const full = nullableInput(address);
  const region = nullableInput(district);
  if (!full || !region) return full;
  const index = full.indexOf(region);
  return index >= 0 ? full.slice(index + region.length).trim() : full;
}

export function shouldShowCommonPartRelation(commonParts) {
  const byMain = new Map();
  commonParts.forEach((item) => {
    const main = nullableInput(item.relatedMainBuildingNumberRaw || item.relatedMainBuildingNumber);
    if (!main) return;
    const signature = [
      nullableInput(item.buildingNumberRaw || item.buildingNumber),
      nullableInput(item.area),
      nullableInput(item.shareNumerator),
      nullableInput(item.shareDenominator),
    ].join("|");
    if (!byMain.has(main)) byMain.set(main, []);
    byMain.get(main).push(signature);
  });
  if (byMain.size <= 1) return false;
  const signatures = [...byMain.values()].map((items) => [...items].sort().join("~"));
  return new Set(signatures).size > 1;
}

function isConfirmedCommonRelation(item) {
  return Boolean(nullableInput(item.relatedMainBuildingNumberRaw || item.relatedMainBuildingNumber))
    && item.relationStatus !== "manual"
    && item.relationStatus !== "not-provided";
}

export function getRenderableParties(state) {
  const roleOrder = getPartyRoleSuggestions(state.caseInfo.caseType);
  const parties = state.parties.map((item, index) => ({ ...item, sourceOrder: index }))
    .sort((left, right) => {
      const leftIndex = roleOrder.indexOf(left.title);
      const rightIndex = roleOrder.indexOf(right.title);
      const leftRank = leftIndex < 0 ? roleOrder.length : leftIndex;
      const rightRank = rightIndex < 0 ? roleOrder.length : rightIndex;
      return leftRank - rightRank || left.sourceOrder - right.sourceOrder;
    });
  if (state.caseInfo.caseType !== "mortgage" || !state.partySettings.mergeDebtorAndObligor) return parties;

  const consumed = new Set();
  const output = [];
  parties.forEach((party, index) => {
    if (consumed.has(index)) return;
    if (party.title !== "債務人" && party.title !== "義務人") {
      output.push(party);
      return;
    }
    const targetTitle = party.title === "債務人" ? "義務人" : "債務人";
    const matchIndex = parties.findIndex((candidate, candidateIndex) => (
      candidateIndex > index
      && !consumed.has(candidateIndex)
      && candidate.title === targetTitle
      && partyIdentity(candidate) === partyIdentity(party)
    ));
    if (matchIndex < 0) {
      output.push(party);
      return;
    }
    consumed.add(matchIndex);
    output.push({ ...party, title: "債務人／義務人" });
  });
  return output;
}

export function renderCaseCard(state) {
  const groups = getProgressGroups(state.caseInfo.caseType);
  const parties = getRenderableParties(state);
  const partySpans = mergeSpans(parties, (item) => item.title || "");
  const sectionSpans = mergeSpans(state.lands, (item) => item.section || "");
  const subsectionSpans = mergeSpans(
    state.lands,
    (item) => item.section && item.subsection ? `${item.section}|${item.subsection}` : "",
  );
  const showCommonRelation = shouldShowCommonPartRelation(state.commonParts);
  const commonRelationSpans = mergeSpans(state.commonParts, (item) => (
    isConfirmedCommonRelation(item)
      ? nullableInput(item.relatedMainBuildingNumberRaw || item.relatedMainBuildingNumber)
      : ""
  ));
  const showPartyShare = state.partySettings.showShare;

  return `
    <header class="case-card-header">
      <h2>案件資料卡</h2>
    </header>
    <table class="case-card-meta" aria-label="案件基本資料">
      <tbody>
        <tr><th>區域</th><td>${cardText(state.caseInfo.district)}</td><th>案件編號</th><td>${cardText(state.caseInfo.caseNumber)}</td></tr>
        <tr><th>登記原因</th><td>${cardText(state.caseInfo.registrationReason)}</td><th>原因日期</th><td>${cardText(formatRocDate(state.caseInfo.reasonDate))}</td></tr>
      </tbody>
    </table>
    ${renderProgress(groups, state)}
    ${parties.length ? `<section class="case-card-section party-card-section ${showPartyShare ? "" : "party-share-hidden"}">
      <h3>當事人</h3>
      <table class="case-card-table party-card-table">
        <thead><tr><th>稱謂</th><th>姓名</th><th>生日</th><th>身分證統一編號</th><th>地址</th>${showPartyShare ? "<th>持分</th>" : ""}<th>電話／備註</th></tr></thead>
        <tbody>${parties.map((party, index) => `<tr>
          ${partySpans[index] ? `<td rowspan="${partySpans[index]}">${cardText(party.title)}</td>` : ""}
          <td>${cardText(party.name)}</td><td class="card-nowrap">${cardText(formatRocDate(party.birthDate))}</td>
          <td class="card-id-number">${cardText(party.idNumber)}</td><td class="card-address">${cardText(party.address)}</td>
          ${showPartyShare ? `<td class="card-share">${cardText(party.share)}</td>` : ""}<td>${cardMultiline(party.phoneNote)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </section>` : ""}
    ${state.lands.length ? `<section class="case-card-section land-card-section">
      <h3>土地</h3>
      <table class="case-card-table land-card-table">
        <thead><tr><th>段</th><th>小段</th><th>地號</th><th>面積</th><th>公告現值<br>（元／㎡）</th><th>持分</th><th>總現值</th><th>前次移轉</th></tr></thead>
        <tbody>${state.lands.map((land, index) => `<tr>
          ${sectionSpans[index] ? `<td rowspan="${sectionSpans[index]}">${cardText(land.section)}</td>` : ""}
          ${subsectionSpans[index] ? `<td rowspan="${subsectionSpans[index]}">${cardText(land.subsection)}</td>` : ""}
          <td>${cardText(land.landNumber)}</td>
          <td class="card-number">${cardNumber(land.area)}</td>
          <td class="card-number">${cardNumber(land.announcedCurrentValue)}</td>
          <td class="card-nowrap">${cardShare(land.shareNumerator, land.shareDenominator)}</td>
          <td class="card-number">${cardNumber(land.totalCurrentValue)}</td>
          <td class="card-transfer">${cardMultiline(land.previousTransferText)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </section>` : ""}
    ${state.buildings.length ? `<section class="case-card-section building-card-section">
      <div class="building-heading-group"><h3>建物</h3>
      <div class="building-summary"><span>建材：${cardText(state.buildingMeta.material)}</span><span>總層數：${cardText(state.buildingMeta.totalFloors)}</span></div></div>
      <table class="case-card-table building-card-table">
        <thead><tr><th>建號</th><th>門牌</th><th>層別</th><th>面積</th><th>持分</th><th>附屬建物</th><th>房屋現值</th><th>稅籍編號</th></tr></thead>
        <tbody>${state.buildings.map((item) => `<tr>
          <td>${cardText(formatBuildingNumberDisplay(item.buildingNumber))}</td><td class="card-address">${cardText(formatBuildingAddressForCard(item.address, state.caseInfo.district))}</td>
          <td>${cardText(item.floor)}</td><td class="card-number">${cardNumber(item.area)}</td>
          <td class="card-nowrap">${cardShare(item.shareNumerator, item.shareDenominator)}</td>
          <td class="card-accessory">${cardMultiline(item.accessoryText)}</td>
          <td class="card-number">${cardNumber(item.currentValue)}</td><td>${cardText(item.taxNumber)}</td>
        </tr>`).join("")}</tbody>
      </table>
      ${state.commonParts.length ? `<div class="common-part-block"><h4>共有部分</h4><table class="case-card-table common-card-table">
        <thead><tr><th>建號</th><th>面積</th><th>持分</th>${showCommonRelation ? "<th>對應主建號</th>" : ""}</tr></thead>
        <tbody>${state.commonParts.map((item, index) => `<tr><td>${cardText(formatBuildingNumberDisplay(item.buildingNumber))}</td><td class="card-number">${cardNumber(item.area)}</td><td class="card-nowrap">${cardShare(item.shareNumerator, item.shareDenominator)}</td>${showCommonRelation && commonRelationSpans[index] ? `<td rowspan="${commonRelationSpans[index]}">${cardText(formatBuildingNumberDisplay(item.relatedMainBuildingNumber))}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div>` : ""}
    </section>` : ""}`;
}

function renderProgress(groups, state) {
  if (!groups.length) return "";
  return `<section class="case-card-section case-card-progress"><h3>稅務進度</h3><div class="tax-progress-groups">${groups.map((group) => `<div class="tax-progress-group"><h4>${escapeHtml(group.label)}</h4><div class="tax-progress-grid">${group.items.map((item) => {
    const key = `${group.id}:${item.id}`;
    const label = stripConfirmationText(state.progressLabels[key] || item.label);
    return `<div class="tax-progress-item"><span>${escapeHtml(label)}</span><b>${cardText(formatRocDate(state.progressValues[key]))}</b></div>`;
  }).join("")}</div></div>`).join("")}</div></section>`;
}

function taxGroup(id, label, items) {
  return { id, label, items: items.map(([itemId, itemLabel, editableLabel = false]) => ({ id: itemId, label: itemLabel, editableLabel })) };
}

function applyRegistrationReasonCode(state, codeValue) {
  const code = nullableInput(codeValue);
  if (!code) return;
  if (!state.caseInfo.registrationReasonCodes.includes(code)) state.caseInfo.registrationReasonCodes.push(code);
  state.caseInfo.registrationReasonCode = state.caseInfo.registrationReasonCodes.join("、");
  reconcileRegistrationReason(state);
}

function reconcileRegistrationReason(state) {
  if (state.caseInfo.registrationReasonManual) return;
  const code = state.caseInfo.registrationReasonCodes[0] || "";
  if (!code) {
    state.caseInfo.registrationReason = "";
    if (!state.caseInfo.caseTypeManual) state.caseInfo.caseType = "";
    return;
  }
  if (state.caseInfo.registrationReasonCodes.length === 1 && REGISTRATION_REASON_MAP[code]) {
    state.caseInfo.registrationReason = REGISTRATION_REASON_MAP[code].label;
    if (!state.caseInfo.caseTypeManual) state.caseInfo.caseType = REGISTRATION_REASON_MAP[code].caseType;
    return;
  }
  state.caseInfo.registrationReason = `代碼 ${state.caseInfo.registrationReasonCode}（待確認）`;
  if (!state.caseInfo.caseTypeManual) state.caseInfo.caseType = "";
}

export function refreshCaseMetadataFromImportedFiles(state) {
  const files = state.importedFiles || [];
  const landFiles = files.filter((file) => file.type === "land");
  state.caseInfo.registrationReasonCodes = [...new Set(landFiles.map((file) => nullableInput(file.parsed.registrationReasonCode)).filter(Boolean))];
  state.caseInfo.registrationReasonCode = state.caseInfo.registrationReasonCodes.join("、");
  reconcileRegistrationReason(state);

  if (!state.caseInfo.reasonDateManual) {
    const rawDate = files.map((file) => file.type === "land"
      ? nullableInput(file.parsed.rawFields.TRD_DATE || file.parsed.rawFields.FLG_DATE)
      : nullableInput(file.parsed.rawFields.CONTRCT_DATE)).find(Boolean) || "";
    state.caseInfo.reasonDateRaw = rawDate;
    state.caseInfo.reasonDate = formatRocDate(rawDate);
  }

  if (!state.buildingMeta.materialManual) {
    const structures = state.buildings.flatMap((item) => item.original?.floorDetails?.map((detail) => detail.structure).filter(Boolean) || []);
    const unique = [...new Set(structures)];
    state.buildingMeta.material = unique.length === 1 ? unique[0] : "";
    state.buildingMeta.materialNeedsConfirmation = unique.length > 1;
  }
}

function addDistrictSource(state, district, sourceType, sourceFileId = "") {
  const normalized = nullableInput(district);
  if (!normalized) return;
  state.caseInfo.districtSources.push({ district: normalized, sourceType, sourceFileId });
  reconcileCaseDistrict(state);
}

function addImportedParties(state, parties, sourceType, target, sourceFileId = "") {
  [
    ["old-owner", parties.oldOwners || [], "CSV 舊權利人，稱謂待確認"],
    ["new-owner", parties.newOwners || [], "CSV 新權利人，稱謂待確認"],
  ].forEach(([sourceRole, sourceItems, hint]) => {
    sourceItems.forEach((item, sourceIndex) => {
      const original = {
        sourceFileId,
        sourceType,
        sourceRole,
        sourceIndex,
        name: nullableInput(item.name),
        birthDate: nullableInput(item.birthDate),
        idNumber: nullableInput(item.idNumber),
        homeAddress: nullableInput(item.homeAddress),
        contactAddress: nullableInput(item.contactAddress),
        phone: nullableInput(item.phone),
        shareNumerator: nullableInput(item.share?.numerator),
        shareDenominator: nullableInput(item.share?.denominator),
        targetKind: target.kind,
        targetNumber: nullableInput(target.targetNumber),
        targetNumberRaw: nullableInput(target.targetNumberRaw),
      };
      const normalizedId = normalizePartyId(original.idNumber);
      const fingerprint = normalizedId
        ? `${sourceRole}|${normalizedId}`
        : `${sourceRole}|missing-id|${sourceType}|${original.targetNumberRaw}|${sourceIndex}`;
      const existing = normalizedId
        ? state.parties.find((party) => party.imported
          && party.importRoleKey === sourceRole
          && normalizePartyId(party.idNumber) === normalizedId)
        : null;
      const interest = createPartyInterest(original);
      if (existing) {
        existing.originalSources.push(original);
        existing.interests = appendUniqueInterest(existing.interests, interest);
        if (!existing.shareManual) existing.share = formatPartyInterests(existing.interests);
        if (existing.name && original.name && normalizePartyName(existing.name) !== normalizePartyName(original.name)) {
          existing.identityConflict = true;
        }
        if (!existing.name) existing.name = original.name;
        if (!existing.birthDate) existing.birthDate = formatRocDate(original.birthDate);
        if (!existing.address) existing.address = original.contactAddress || original.homeAddress;
        if (!existing.phoneNote) existing.phoneNote = original.phone;
        return;
      }
      addBlankParty(state, {
        name: original.name,
        birthDate: formatRocDate(original.birthDate),
        idNumber: original.idNumber,
        address: original.contactAddress || original.homeAddress,
        share: formatPartyInterests(interest ? [interest] : []),
        phoneNote: original.phone,
        imported: true,
        sourceRoleHint: hint,
        importFingerprint: fingerprint,
        importRoleKey: sourceRole,
        identityNeedsConfirmation: !normalizedId,
        interests: interest ? [interest] : [],
        original,
        originalSources: [original],
        manualFields: [],
      });
    });
  });
}

export function formatPartyInterests(interests) {
  const usable = (interests || []).filter((item) => item.numerator && item.denominator);
  const groups = [
    ["land", "土"],
    ["building", "建"],
  ];
  return groups.map(([kind, prefix]) => {
    const records = usable.filter((item) => item.kind === kind);
    if (!records.length) return "";
    const shares = [...new Set(records.map((item) => `${item.numerator}/${item.denominator}`))];
    if (shares.length === 1) return `${prefix}：${shares[0]}`;
    return records.map((item) => {
      const number = kind === "building" ? formatBuildingNumberDisplay(item.targetNumber) : nullableInput(item.targetNumber);
      return number ? `${prefix}${number}：${item.numerator}/${item.denominator}` : "";
    }).filter(Boolean).join("、");
  }).filter(Boolean).join("　");
}

function createPartyInterest(original) {
  if (!original.shareNumerator || !original.shareDenominator) return null;
  return {
    kind: original.targetKind,
    targetNumber: original.targetNumber,
    targetNumberRaw: original.targetNumberRaw,
    numerator: original.shareNumerator,
    denominator: original.shareDenominator,
    sourceType: original.sourceType,
    sourceRole: original.sourceRole,
    sourceFileId: original.sourceFileId,
  };
}

function appendUniqueInterest(interests, interest) {
  if (!interest) return interests;
  const key = partyInterestKey(interest);
  return interests.some((item) => partyInterestKey(item) === key) ? interests : [...interests, interest];
}

function partyInterestKey(item) {
  return [item.kind, item.targetNumberRaw || item.targetNumber, item.numerator, item.denominator, item.sourceRole].join("|");
}

function normalizePartyId(value) {
  return nullableInput(value).replace(/[\s-]/g, "").toUpperCase();
}

function normalizePartyName(value) {
  return nullableInput(value).replace(/\s/g, "");
}

function partyIdentity(item) {
  const id = normalizePartyId(item.idNumber);
  return id || [item.name, item.birthDate, item.address].map(nullableInput).join("|");
}

function countDistinctPartiesByTitle(parties, title) {
  return new Set(parties
    .filter((party) => party.title === title)
    .map((party) => normalizePartyId(party.idNumber) || party.id)).size;
}

function classifyBuildingDetails(details) {
  if (!details.length) return { mainDetail: null, accessories: [], needsConfirmation: false };
  const firstIsAccessory = isConfirmedAccessory(details[0].floor);
  const remainingAreAccessories = details.slice(1).every((item) => isConfirmedAccessory(item.floor));
  if (!firstIsAccessory && remainingAreAccessories) {
    return {
      mainDetail: details[0],
      accessories: details.slice(1).map((item) => ({ use: item.floor || "", area: nullableInput(item.area) })),
      needsConfirmation: false,
    };
  }
  return { mainDetail: null, accessories: [], needsConfirmation: true };
}

function isConfirmedAccessory(value) {
  return /^(陽臺|陽台|雨遮)$/.test(nullableInput(value));
}

function parseLandLocation(rawValue) {
  const raw = nullableInput(rawValue);
  const landNumberMatch = raw.match(/(\d{8})$/);
  const landNumberRaw = landNumberMatch?.[1] || "";
  const withoutNumber = landNumberRaw ? raw.slice(0, -landNumberRaw.length) : raw;
  const district = extractDistrictFromAddress(withoutNumber);
  const districtIndex = district ? withoutNumber.indexOf(district) : -1;
  const sectionAndSubsection = districtIndex >= 0 ? withoutNumber.slice(districtIndex + district.length) : withoutNumber;
  const sectionParts = splitLandSectionAndSubsection(sectionAndSubsection);
  return {
    district,
    sectionAndSubsection,
    section: sectionParts.section,
    subsection: sectionParts.subsection,
    needsConfirmation: sectionParts.needsConfirmation || !district || !landNumberRaw,
    landNumber: landNumberRaw ? formatLandNumber(landNumberRaw) : "",
  };
}

function splitLandSectionAndSubsection(value) {
  const label = nullableInput(value);
  if (!label) return { section: "", subsection: "", needsConfirmation: true };
  const marked = label.match(/^(.+?)段(.+?)小段$/);
  if (marked) return { section: marked[1], subsection: marked[2], needsConfirmation: false };
  const match = label.match(/^(.+?)([一二三四五六七八九十百千]+)$/);
  if (match) return { section: match[1], subsection: match[2], needsConfirmation: false };
  return { section: label, subsection: "", needsConfirmation: false };
}

function extractDistrictFromAddress(address) {
  const raw = nullableInput(address);
  const withoutCounty = raw.replace(/^[^市縣]+[市縣]/, "");
  return withoutCounty.match(/^(.+?區)/)?.[1] || raw.match(/^(.+?區)/)?.[1] || "";
}

function mergeBuildingMaterial(state, structures) {
  const uniqueStructures = [...new Set(structures)];
  if (uniqueStructures.length !== 1) {
    if (uniqueStructures.length > 1) state.buildingMeta.materialNeedsConfirmation = true;
    return;
  }
  if (!state.buildingMeta.material) {
    state.buildingMeta.material = uniqueStructures[0];
    return;
  }
  if (state.buildingMeta.material !== uniqueStructures[0]) state.buildingMeta.materialNeedsConfirmation = true;
}

function assembleRocDate(yearValue, monthValue, dayValue) {
  let year = Number(yearValue);
  const month = Number(monthValue);
  const day = dayValue === undefined ? null : Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
  if (year >= 1912) year -= 1911;
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) return "";
  return `${year}.${String(month).padStart(2, "0")}${day === null ? "" : `.${String(day).padStart(2, "0")}`}`;
}

function addNotice(state, message) {
  if (!state.notices.includes(message)) state.notices.push(message);
}

function nextId(state, prefix) {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}

function nullableInput(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function uniqueBy(items, selector) {
  return [...new Map(items.map((item) => [selector(item), item])).values()];
}

function formatNumberText(value) {
  const text = nullableInput(value);
  if (!text) return "";
  const number = Number(text.replaceAll(",", ""));
  return Number.isFinite(number) ? number.toLocaleString("zh-TW", { maximumFractionDigits: 6 }) : text;
}

function stripConfirmationText(value) {
  return nullableInput(value).replaceAll("（待確認）", "").trim();
}

function cardText(value) {
  const text = nullableInput(value);
  if (!text || text === "待確認" || text.includes("（待確認）")) return "";
  return escapeHtml(text);
}

function cardNumber(value) {
  return escapeHtml(formatNumberText(value));
}

function cardShare(numerator, denominator) {
  const first = nullableInput(numerator);
  const second = nullableInput(denominator);
  return first && second ? `${escapeHtml(first)}/${escapeHtml(second)}` : "";
}

function cardMultiline(value) {
  const text = nullableInput(value);
  if (!text || text === "待確認" || text.includes("（待確認）")) return "";
  return text.split("\n").map(escapeHtml).join("<br>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toChineseNumber(value) {
  return ["零", "一", "二", "三", "四", "五", "六"][value] || String(value);
}
