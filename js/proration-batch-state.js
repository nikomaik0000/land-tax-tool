import { isBlank, normalizeInput } from "./proration-input-normalization.js";
import { calculateHouseTax, calculateLandTax, calculateCombinedSettlement } from "./proration-calculations.js?v=20261001-1";

export const BATCH_SCHEMA_VERSION = 1;
// One field registry is shared by the resolver and Excel adapter.
export const BATCH_FIELDS = [
  ["customer.label", "戶別", "text", true, false],
  ["customer.doorplate", "門牌", "text", false, false],
  ["customer.buyer", "買方", "text", true, false],
  ["customer.houseTax.amount", "房屋稅額", "number", true, false],
  ["customer.landTax.declaredLandValue", "申報地價（元／㎡）", "number", true, false],
  ["customer.landTax.area", "土地總面積（㎡）", "number", true, false],
  ["customer.landTax.shareNumerator", "土地持分分子", "number", true, false],
  ["customer.landTax.shareDenominator", "土地持分分母", "number", true, false],
  ["customer.houseTax.taxNote", "房屋稅備註", "text", false, false],
  ["customer.note", "其他備註", "text", false, false],
  ["shared.caseName", "案件名稱（選填）", "text", false, true],
  ["shared.seller", "賣方（選填）", "text", true, true],
  ["shared.handoverDate", "交屋日／分算基準日（選填）", "date", false, true],
  ["customer.houseTax.taxableMonths", "房屋稅課稅月數（選填）", "number", true, true],
  ["customer.houseTax.taxStartDate", "房屋稅完整課稅開始日（選填）", "date", true, true],
  ["customer.houseTax.prorationStartDate", "房屋稅本次找補開始日（選填）", "date", true, true],
  ["customer.houseTax.prorationEndDate", "房屋稅本次找補結束日（選填）", "date", true, true],
  ["customer.houseTax.payer", "房屋稅支付方（選填）", "payer", true, true],
  ["customer.landTax.taxYear", "地價稅課稅年度（選填）", "year", true, true],
  ["customer.landTax.prorationStartDate", "地價稅本次找補開始日（選填）", "date", true, true],
  ["customer.landTax.prorationEndDate", "地價稅本次找補結束日（選填）", "date", true, true],
  ["customer.landTax.rate", "地價稅率（%）（選填）", "number", true, true],
  ["customer.landTax.payer", "地價稅支付方（選填）", "payer", true, true]
].map(([path, label, type, required, override]) => Object.freeze({ path, label, type, required, override }));
// The three land fields are also common defaults; every row uses the same
// individual > common resolution path, regardless of Excel column placement.
export const BATCH_COMMON_FIELDS = BATCH_FIELDS.filter((field) => field.override || field.path === "customer.houseTax.taxNote" || [
  "customer.landTax.declaredLandValue", "customer.landTax.area", "customer.landTax.shareDenominator"
].includes(field.path));

export const getField = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
export function setField(object, path, value) {
  const keys = path.split("."); let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
}
export function createBatchState(common = {}) {
  return { schemaVersion: BATCH_SCHEMA_VERSION, common: structuredClone(common), rows: [], metadata: {} };
}
export function createBatchRow(values = {}, { id = globalThis.crypto.randomUUID(), selected = true, source = {} } = {}) {
  return { id, selected, values: structuredClone(values), source: structuredClone(source) };
}

export function resolveBatchRow(common, row) {
  const state = { schemaVersion: 5, shared: { notes: [] }, customer: { id: row.id, houseTax: {}, landTax: { legacyAmount: "" } } };
  const errors = [], warnings = [], origins = {};
  const issue = (path, message) => errors.push({ path, message, source: row.source });
  for (const cell of row.source?.unmappedCells ?? []) {
    if (!isBlank(cell.raw)) issue(`source.${cell.address}`, `儲存格 ${cell.address} 有資料但沒有欄位名稱，請確認或移除。`);
  }
  for (const field of BATCH_FIELDS) {
    const individual = getField(row.values, field.path), fallback = getField(common, field.path);
    // Other notes are additive and belong to the individual, not a fallback field.
    const useCommon = field.path !== "customer.note" && isBlank(individual) && !isBlank(fallback);
    const raw = !isBlank(individual) ? individual : useCommon ? fallback : "";
    origins[field.path] = !isBlank(individual) ? "individual" : useCommon ? "common" : "none";
    const sourceCell = row.source?.cells?.find((cell) => cell.path === field.path);
    if (field.path === "customer.landTax.rate" && origins[field.path] === "individual" && sourceCell && Object.is(sourceCell.raw, raw) && /%/.test(sourceCell.numberFormat)) {
      issue(field.path, "地價稅率請使用一般數字格式，數字 1 表示 1%。");
    }
    try {
      const normalized = normalizeInput(raw, field.type, useCommon ? {} : row.source);
      setField(state, field.path, normalized.value);
      warnings.push(...normalized.warnings.map((message) => ({ path: field.path, message })));
      if (field.required && isBlank(normalized.value)) issue(field.path, `請填寫${field.label.replace("（選填）", "")}。`);
    } catch (error) { setField(state, field.path, ""); issue(field.path, error.message); }
  }
  const notes = common?.shared?.notes ?? [];
  if (!Array.isArray(notes)) issue("shared.notes", "共用備註格式不正確。");
  else for (const [index, note] of notes.entries()) {
    if (!note || typeof note.content !== "string") issue("shared.notes", "共用備註必須包含文字 content。");
    else state.shared.notes.push({ id: note.id || `common-${index}`, content: note.content });
  }
  // Project the separate row note into the existing report's notes array, only in
  // the derived single-case state. Raw common/individual notes stay untouched.
  if (state.customer.note) state.shared.notes.push({ id: `row-${row.id}`, content: state.customer.note });
  let selected = false;
  try { selected = isBlank(row.selected) ? true : normalizeInput(row.selected, "boolean").value; }
  catch (error) { issue("selected", error.message); }
  // Protect existing calendar arithmetic from unrepresentable calendar ranges.
  const house = state.customer.houseTax;
  if (Number.isInteger(house.taxableMonths) && house.taxableMonths > 0 && house.taxStartDate) {
    const [year, month] = house.taxStartDate.split("-").map(Number);
    if (year * 12 + month - 1 + house.taxableMonths >= 10000 * 12) issue("customer.houseTax.taxableMonths", "課稅期間超出可處理日期範圍。");
  }
  return { state, origins, errors, warnings, selected };
}

export function evaluateBatchRow(common, row) {
  const resolved = resolveBatchRow(common, row);
  if (resolved.errors.length) return { ...resolved, id: row.id, valid: false, canOutput: false, results: null };
  // No formulas or direction/rounding rules are defined in the batch layer.
  const house = calculateHouseTax(resolved.state.customer.houseTax);
  const land = calculateLandTax(resolved.state.customer.landTax);
  for (const [kind, result] of [["houseTax", house], ["landTax", land]]) {
    for (const [field, message] of Object.entries(result.fieldErrors)) resolved.errors.push({ path: `customer.${kind}.${field}`, message, source: row.source });
    if (result.valid && !Number.isSafeInteger(result.prorationAmount)) resolved.errors.push({ path: `customer.${kind}`, message: "計算金額超出安全整數範圍。", source: row.source });
  }
  if (land.valid && (!Number.isSafeInteger(land.taxableLandValue) || !Number.isSafeInteger(land.taxAmount))) resolved.errors.push({ path: "customer.landTax", message: "計算金額超出安全整數範圍。", source: row.source });
  const valid = resolved.errors.length === 0;
  const total = valid ? calculateCombinedSettlement(house, land) : null;
  if (valid && !Number.isSafeInteger(total)) resolved.errors.push({ path: "total", message: "合計金額超出安全整數範圍。" });
  const finalValid = resolved.errors.length === 0;
  return { ...resolved, id: row.id, valid: finalValid, canOutput: finalValid && resolved.selected, results: { house, land, total: finalValid ? total : null } };
}

export function evaluateBatch(batch) {
  if (batch.schemaVersion !== BATCH_SCHEMA_VERSION || !Array.isArray(batch.rows)) throw new Error("批次資料格式或版本不支援。");
  const evaluated = batch.rows.map((row) => evaluateBatchRow(batch.common, row));
  const groups = new Map();
  evaluated.forEach((row) => {
    const label = row.state.customer.label;
    if (label) { const key = label.normalize("NFKC").toUpperCase(); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  });
  for (const group of groups.values()) if (group.length > 1) for (const row of group) {
    row.errors.push({ path: "customer.label", message: "戶別重複，請確認並修正。" }); row.valid = false; row.canOutput = false;
  }
  return evaluated;
}
