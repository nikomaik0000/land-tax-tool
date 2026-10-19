import { formatLandNumber } from "./formatters.js";

const INDEXED_COMMON_PART = /^PUB_FAC_(?:CNSTRT_NO|AREA|SHR_NMRT|SHR_DNT)_(\d+)$/;
const INDEXED_FLOOR = /^HOU_(?:FLOOR_NO|AREA)_(\d+)$/;
const INDEXED_STRUCTURE = /^STRUC_CD_(\d+)$/;
const INDEXED_SUB_BUILDING = /^SUB_(?:FLOOR_NO|AREA|USE_CD)_(\d+)$/;
const INDEXED_PREVIOUS_TRANSFER = /^PRE_(\d+)$/;

export function decodeWangExport(input, { encoding = "big5" } = {}) {
  if (typeof input === "string") return input.replace(/^\uFEFF/, "");

  const bytes = input instanceof Uint8Array
    ? input
    : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : null;

  if (!bytes) throw new TypeError("王代書匯出資料必須是文字、ArrayBuffer 或 Uint8Array");

  return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
}

export function parseWangKeyValueText(input) {
  const text = decodeWangExport(input);
  const fields = {};
  const warnings = [];

  text.split(/\r?\n/).forEach((line, lineIndex) => {
    if (!line.trim()) return;

    const separator = line.indexOf("=");
    if (separator < 1) {
      warnings.push({ code: "malformed-line", line: lineIndex + 1 });
      return;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (Object.hasOwn(fields, key)) {
      warnings.push({ code: "duplicate-field", field: key, line: lineIndex + 1 });
    }
    fields[key] = value;
  });

  return { fields, warnings };
}

export function parseWangBuildingExport(input) {
  const parsed = parseWangKeyValueText(input);
  const { fields, warnings } = parsed;
  const commonPartCount = readCount(fields, "PUB_FACs", warnings);
  const commonPartIndices = resolveIndices(fields, INDEXED_COMMON_PART, commonPartCount, "PUB_FACs", warnings);
  const floorCount = readCount(fields, "HOU_FLOORs", warnings);
  const floorIndices = resolveIndices(fields, [INDEXED_FLOOR, INDEXED_STRUCTURE], floorCount, "HOU_FLOORs", warnings);
  const subBuildingIndices = findIndices(fields, INDEXED_SUB_BUILDING);

  return {
    sourceType: "wang-building",
    rawFields: fields,
    mainBuilding: {
      registrationMarkRaw: nullableText(fields.HOU_CNSTRT_NO),
      buildingNumberRaw: nullableText(fields.MAIN_BUILD_NO),
      buildingNumber: formatRegistryNumber(fields.MAIN_BUILD_NO),
      taxNumber: nullableText(fields.HOU_LOSN),
      sourceCurrentValue: readNumber(fields, "TRAN_PRC", warnings),
      section: nullableText(fields.SEC_CHI_NM),
      subsection: nullableText(fields.SSC_CHI_NM),
      address: nullableText(fields.HOU_LOC),
      floorDetails: floorIndices.map((index) => ({
        index,
        floor: nullableText(fields[`HOU_FLOOR_NO_${index}`]),
        structure: nullableText(fields[`STRUC_CD_${index}`]),
        area: readNumber(fields, `HOU_AREA_${index}`, warnings),
      })),
      subBuildings: subBuildingIndices.map((index) => ({
        index,
        floorOrUse: nullableText(fields[`SUB_FLOOR_NO_${index}`]),
        useCode: nullableText(fields[`SUB_USE_CD_${index}`]),
        area: readNumber(fields, `SUB_AREA_${index}`, warnings),
      })),
    },
    commonPartCount,
    commonParts: commonPartIndices.map((index) => ({
      index,
      buildingNumberRaw: nullableText(fields[`PUB_FAC_CNSTRT_NO_${index}`]),
      buildingNumber: formatRegistryNumber(fields[`PUB_FAC_CNSTRT_NO_${index}`]),
      area: readNumber(fields, `PUB_FAC_AREA_${index}`, warnings),
      share: {
        numerator: readNumber(fields, `PUB_FAC_SHR_NMRT_${index}`, warnings),
        denominator: readNumber(fields, `PUB_FAC_SHR_DNT_${index}`, warnings),
      },
      relatedMainBuildingNumbers: [],
      relationStatus: "not-provided",
    })),
    otherBuildingCount: readCount(fields, "OTH_BUILD_NOS", warnings),
    parties: parseBuildingParties(fields, warnings),
    agentCandidate: {
      idNumber: nullableText(fields.AGENT_IDN_BAN),
      name: nullableText(fields.AGENT_NM),
      phone: nullableText(fields.AGENT_TEL_NO),
    },
    warnings,
  };
}

export function parseWangLandExport(input) {
  const parsed = parseWangKeyValueText(input);
  const { fields, warnings } = parsed;
  const previousTransferCount = readCount(fields, "PRES", warnings);
  const previousTransferIndices = resolveIndices(
    fields,
    INDEXED_PREVIOUS_TRANSFER,
    previousTransferCount,
    "PRES",
    warnings,
  );

  return {
    sourceType: "wang-land",
    rawFields: fields,
    registrationReasonCode: nullableText(fields.TRAN_REAS),
    parcel: {
      registrationMarkRaw: nullableText(fields.LND_MARK),
      locationRaw: nullableText(fields.LOC_NM),
      area: readNumber(fields, "TRAN_AREA", warnings),
      registeredArea: readNumber(fields, "LUMP_LND_AREA", warnings),
      announcedCurrentValue: readNumber(fields, "ANNO_PR_VAL_PRC", warnings),
      transactionShare: {
        numerator: readNumber(fields, "TRAN_RATE_NMRT", warnings),
        denominator: readNumber(fields, "TRAN_RATE_DNT", warnings),
      },
      sourceTotalCurrentValue: readNumber(fields, "TRAN_PRC", warnings),
      houseTaxNumber: nullableText(fields.HOU_LOSN),
      previousTransfers: previousTransferIndices.map((index) => parsePreviousTransfer(fields[`PRE_${index}`], index)),
    },
    parties: parseLandParties(fields, warnings),
    agentCandidate: {
      idNumber: nullableText(fields.AGT_IDN),
      name: nullableText(fields.AGENT_NM),
      phone: nullableText(fields.AGT_TEL),
      address: nullableText(fields.AGENT_ADD),
    },
    warnings,
  };
}

function parsePreviousTransfer(rawValue, index) {
  const raw = nullableText(rawValue);
  if (!raw) return { index, raw: null };

  const parts = raw.split("_");
  if (parts.length < 6) return { index, raw, parseStatus: "unrecognized" };

  const denominator = parts.pop();
  const numerator = parts.pop();
  const announcedCurrentValue = parts.pop();
  const transferYearMonth = parts.pop();
  const landNumberRaw = parts.pop();

  return {
    index,
    raw,
    parseStatus: "parsed",
    partyIdNumber: nullableText(parts.join("_")),
    landNumberRaw: nullableText(landNumberRaw),
    landNumber: formatRegistryNumber(landNumberRaw),
    transferYearMonth: nullableText(transferYearMonth),
    announcedCurrentValue: toNumber(announcedCurrentValue),
    share: {
      numerator: toNumber(numerator),
      denominator: toNumber(denominator),
    },
  };
}

function parseBuildingParties(fields, warnings) {
  return {
    oldOwners: parseIndexedParties(fields, readCount(fields, "O_HOLDERS", warnings), {
      id: "O_HOLDER_IDN_BAN",
      name: "O_HOLDER_NM",
      phone: "O_HOLDER_TEL",
      birthDate: "OBORN_DATE",
      homeAddress: "O_HOLDER_HADDR",
      contactAddress: "O_HOLDER_CADDR",
      numerator: "O_HOLDER_TRAN_NMRT",
      denominator: "O_HOLDER_TRAN_DNT",
    }, warnings),
    newOwners: parseIndexedParties(fields, readCount(fields, "N_HOLDERS", warnings), {
      id: "N_HOLDER_IDN_BAN",
      name: "N_HOLDER_NM",
      phone: "N_HOLDER_TEL",
      birthDate: "NBORN_DATE",
      homeAddress: "N_HOLDER_HADDR",
      contactAddress: "N_HOLDER_CADDR",
      numerator: "N_HOLDER_TRAN_NMRT",
      denominator: "N_HOLDER_TRAN_DNT",
    }, warnings),
  };
}

function parseLandParties(fields, warnings) {
  return {
    oldOwners: parseIndexedParties(fields, readCount(fields, "O_HOLDERS", warnings), {
      id: "OIDN_BAN",
      name: "OIDN_NM",
      phone: "O_HOLDER_TEL",
      birthDate: "OBORN_DATE",
      homeAddress: "O_HOLDER_HADDR",
      contactAddress: "O_HOLDER_CADDR",
      numerator: "O_HOLDER_TRAN_NMRT",
      denominator: "O_HOLDER_TRAN_DNT",
    }, warnings),
    newOwners: parseIndexedParties(fields, readCount(fields, "N_HOLDERS", warnings), {
      id: "NIDN_BAN",
      name: "NIDN_NM",
      phone: "N_HOLDER_TEL",
      birthDate: "NBORN_DATE",
      homeAddress: "N_HOLDER_HADDR",
      contactAddress: "N_HOLDER_CADDR",
      numerator: "N_HOLDER_TRAN_NMRT",
      denominator: "N_HOLDER_TRAN_DNT",
    }, warnings),
  };
}

function parseIndexedParties(fields, count, keys, warnings) {
  if (count === null) return [];
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    return {
      index,
      idNumber: nullableText(fields[`${keys.id}_${index}`]),
      name: nullableText(fields[`${keys.name}_${index}`]),
      phone: nullableText(fields[`${keys.phone}_${index}`]),
      birthDate: nullableText(fields[`${keys.birthDate}_${index}`]),
      homeAddress: nullableText(fields[`${keys.homeAddress}_${index}`]),
      contactAddress: nullableText(fields[`${keys.contactAddress}_${index}`]),
      share: {
        numerator: readNumber(fields, `${keys.numerator}_${index}`, warnings),
        denominator: readNumber(fields, `${keys.denominator}_${index}`, warnings),
      },
    };
  });
}

function resolveIndices(fields, patterns, count, countField, warnings) {
  const discovered = findIndices(fields, patterns);
  if (count === null) return discovered;

  const expected = Array.from({ length: count }, (_, offset) => offset + 1);
  const resolved = [...new Set([...expected, ...discovered])].sort((a, b) => a - b);
  if (discovered.some((index) => index > count)) {
    warnings.push({ code: "indexed-data-exceeds-count", field: countField });
  }
  return resolved;
}

function findIndices(fields, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const indices = new Set();
  Object.keys(fields).forEach((key) => {
    list.forEach((pattern) => {
      const match = key.match(pattern);
      if (match) indices.add(Number(match[1]));
    });
  });
  return [...indices].sort((a, b) => a - b);
}

function readCount(fields, key, warnings) {
  const value = readNumber(fields, key, warnings);
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    warnings.push({ code: "invalid-count", field: key });
    return null;
  }
  return value;
}

function readNumber(fields, key, warnings) {
  if (!Object.hasOwn(fields, key) || fields[key].trim() === "") return null;
  const value = toNumber(fields[key]);
  if (value === null) warnings.push({ code: "invalid-number", field: key });
  return value;
}

function toNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).trim().replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function formatRegistryNumber(value) {
  const raw = nullableText(value);
  return raw ? formatLandNumber(raw) : null;
}
