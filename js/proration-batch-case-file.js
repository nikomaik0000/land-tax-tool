import { BATCH_SCHEMA_VERSION, evaluateBatch } from "./proration-batch-state.js";
import { sanitizeFilename } from "./case-file.js";

export const BATCH_CASE_FILE_VERSION = 1;
const APP = "land-tax-tool", PAGE_TYPE = "tax-proration-batch";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
const fail = (detail) => { throw new Error(`批次案件檔格式錯誤：${detail}。`); };

function encodeDates(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail("日期無效");
    return { $batchDate: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(encodeDates);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeDates(item)]));
  return value;
}

function decodeDates(value) {
  if (Array.isArray(value)) return value.map(decodeDates);
  if (object(value)) {
    if (Object.keys(value).length === 1 && Object.hasOwn(value, "$batchDate")) {
      if (typeof value.$batchDate !== "string" || !Number.isFinite(Date.parse(value.$batchDate))) fail("日期標記無效");
      return new Date(value.$batchDate);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeDates(item)]));
  }
  return value;
}

function validateBatch(batch, { legacy = false } = {}) {
  if (!object(batch)) fail("缺少批次資料");
  if (batch.schemaVersion !== BATCH_SCHEMA_VERSION) throw new Error(`不支援此批次資料版本（${String(batch.schemaVersion ?? "未標示")}）。`);
  if (!object(batch.common)) fail("缺少共用設定");
  if (!Array.isArray(batch.rows)) fail("缺少戶別資料列");
  if (!legacy && !object(batch.metadata)) fail("缺少來源資訊");
  const result = structuredClone(batch);
  if (legacy) {
    result.metadata ??= {};
    result.common.shared ??= {};
    result.common.shared.notes ??= [];
  }
  if (!object(result.common.shared) || !Array.isArray(result.common.shared.notes)) fail("共用備註格式不正確");
  for (const note of result.common.shared.notes) if (!object(note) || typeof note.content !== "string") fail("共用備註缺少文字內容");
  const ids = new Set();
  for (const [index, row] of result.rows.entries()) {
    const location = `第 ${index + 1} 戶`;
    if (!object(row)) fail(`${location}資料不正確`);
    if (typeof row.id !== "string" || !row.id.trim()) fail(`${location}缺少穩定 ID`);
    if (ids.has(row.id)) fail(`${location}的穩定 ID 重複`);
    ids.add(row.id);
    if (!Object.hasOwn(row, "selected")) fail(`${location}缺少是否輸出狀態`);
    if (!object(row.values)) fail(`${location}缺少原始輸入值`);
    if (legacy) row.source ??= {};
    if (!object(row.source)) fail(`${location}來源資訊不正確`);
    if (row.source.rowNumber != null && (!Number.isInteger(row.source.rowNumber) || row.source.rowNumber < 1)) fail(`${location}的 Excel 列號不正確`);
    if (row.source.cells != null && (!Array.isArray(row.source.cells) || row.source.cells.some((cell) => !object(cell) || typeof cell.path !== "string" || typeof cell.address !== "string"))) fail(`${location}來源儲存格不正確`);
    if (row.source.unmappedCells != null && (!Array.isArray(row.source.unmappedCells) || row.source.unmappedCells.some((cell) => !object(cell) || typeof cell.address !== "string"))) fail(`${location}未對應儲存格不正確`);
  }
  // This is the same resolver, validation and single-case calculation path as Excel import.
  try { evaluateBatch(result); } catch { fail("無法重新計算戶別資料"); }
  return result;
}

export function buildBatchCaseFile(batch, savedAt = new Date().toISOString()) {
  const valid = validateBatch(batch);
  return { app: APP, pageType: PAGE_TYPE, version: BATCH_CASE_FILE_VERSION, savedAt, data: encodeDates(valid) };
}

export function parseBatchCaseFile(text) {
  let file;
  try { file = JSON.parse(text); } catch { fail("JSON 內容已損壞"); }
  if (!object(file)) fail("根目錄不正確");
  // Phase 1–4 had no downloadable batch JSON. Accept a direct schema-v1 state
  // as the only safe legacy shape, without guessing any older field meanings.
  if (Object.hasOwn(file, "schemaVersion")) return validateBatch(decodeDates(file), { legacy: true });
  if (file.app !== APP || file.pageType !== PAGE_TYPE) throw new Error("這不是地價稅房屋稅分算找補的批次案件檔。單戶案件請使用單戶版導入。");
  if (file.version !== BATCH_CASE_FILE_VERSION) throw new Error(`不支援此批次案件檔版本（${String(file.version ?? "未標示")}）。`);
  if (typeof file.savedAt !== "string" || !Number.isFinite(Date.parse(file.savedAt))) fail("缺少有效建立時間");
  return validateBatch(decodeDates(file.data));
}

export function batchCaseFilename(caseName, date = new Date()) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const name = String(caseName ?? "").trim();
  return `${sanitizeFilename(name ? `${name}_批次分算_${day}` : `地價稅房屋稅分算找補_批次案件_${day}`)}.json`;
}
