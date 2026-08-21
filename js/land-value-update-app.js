import { formatArea, formatLandNumber, formatMoney, parseFormattedNumber } from "./formatters.js";
import { LAND_VALUE_DATA, LAND_VALUE_SOURCES, getLandValueSource } from "./land-value-sources.js";
import { buildLandValueDiagnosticKey, buildLandValueKey, compareLandValueRecord, normalizeCity, normalizeLandValueRecord, splitSectionAndSubsection } from "./land-value-normalization.js";
import { clearSessionState, loadSessionState, saveSessionState } from "./session-state.js";

const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const SOURCE_IDS = Object.keys(LAND_VALUE_SOURCES);
const HEADER_ALIASES = Object.freeze({
  city: ["縣市", "縣市別", "城市", "city", "country"],
  district: ["區", "行政區", "district"],
  section: ["段", "段小段", "段名", "segment"],
  subsection: ["小段", "subsection"],
  landNumber: ["地號", "landnumber", "landno", "lid"],
  area: ["面積", "土地面積", "area"],
  announcedValue: ["公告現值", "公告土地現值", "announcedvalue", "officialvalue"]
});

const LAND_VALUE_STORAGE_KEY = "landTool.landValueUpdateState";
const restoredState = loadSessionState(LAND_VALUE_STORAGE_KEY) ?? {};
const state = {
  sources: Object.fromEntries(SOURCE_IDS.map((id) => [id, createEmptySourceState()])),
  queryFile: null, queryFileName: "", workbookRows: [], headerRowIndex: -1, headers: [], columnMap: {}, records: [], fallbackCity: "", sheetName: "", error: "", showOriginalValue: true, showOfficialPrice: true,
  ...restoredState
};
state.queryFile = null;
for (const id of SOURCE_IDS) state.sources[id] = { ...createEmptySourceState(), ...(restoredState.sourceMetadata?.[id] ?? {}) };
for (const record of state.records) {
  const city = normalizeCity(record.city || state.fallbackCity);
  const sourceId = city === "臺北市" ? "taipei" : city === "新北市" ? "newTaipei" : "";
  if (sourceId && restoredState.sourceMetadata?.[sourceId]?.sourceMode === "manual") record.preserveRestoredResult = true;
}

const elements = {
  accordionButton: document.querySelector("#sourceAccordionButton"), accordionContent: document.querySelector("#sourceAccordionContent"),
  bundledSummary: document.querySelector("#bundledSourceSummary"),
  sourceCards: document.querySelector("#sourceCards"), queryZone: document.querySelector("#queryDropZone"), queryInput: document.querySelector("#queryFile"),
  queryFileList: document.querySelector("#queryFileList"), resultSummary: document.querySelector("#resultSummary"), resultEmpty: document.querySelector("#resultEmpty"),
  tableWrap: document.querySelector("#resultTableWrap"), headerRow: document.querySelector("#resultHeaderRow"), rows: document.querySelector("#resultRows"), actionMessage: document.querySelector("#actionMessage"),
  showOriginal: document.querySelector("#showOriginalValue"), showOfficialPrice: document.querySelector("#showOfficialPrice"),
  clearPageState: document.querySelector("#clearLandValuePageState"), download: document.querySelector("#downloadResult")
};

let sheetJsPromise;
let clearingPageState = false;
function savePageState() {
  if (clearingPageState) return;
  saveSessionState(LAND_VALUE_STORAGE_KEY, {
    queryFileName: state.queryFile?.name || state.queryFileName,
    workbookRows: state.workbookRows, headerRowIndex: state.headerRowIndex, headers: state.headers,
    columnMap: state.columnMap, records: state.records, fallbackCity: state.fallbackCity,
    sheetName: state.sheetName, showOriginalValue: state.showOriginalValue, showOfficialPrice: state.showOfficialPrice,
    sourceMetadata: Object.fromEntries(SOURCE_IDS.map((id) => [id, { activeYear: state.sources[id].activeYear, manualYear: state.sources[id].manualYear, sourceMode: state.sources[id].sourceMode }]))
  });
}
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const canonical = (value) => String(value ?? "").replace(/[\s　\r\n_()（）／/・,，.。:：-]/g, "").toLowerCase();
const yieldToUi = () => new Promise((resolve) => requestAnimationFrame(resolve));
const isSafari = /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent);
const DEBUG_LAND_VALUE_UPDATE = globalThis.DEBUG_LAND_VALUE_UPDATE === true || new URLSearchParams(location.search).has("debug");

function createEmptySourceState() {
  return { status: "idle", message: "尚未載入", progress: 0, index: new Map(), file: null, count: 0, mode: "full", sourceMode: "bundled", activeYear: LAND_VALUE_DATA.year, manualYear: LAND_VALUE_DATA.year, encodingChoice: "auto", detectedEncoding: "", buffer: null };
}

export function normalizeHeaderText(value) {
  return String(value ?? "").replace(/[\r\n]/g, "").replace(/[\s　]+/g, "").trim();
}

function loadSheetJs() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  sheetJsPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = SHEETJS_URL;
    script.onload = () => globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("Excel 讀取元件載入失敗。"));
    script.onerror = () => reject(new Error("無法載入 Excel 元件，請確認網路連線後重試。"));
    document.head.append(script);
  });
  return sheetJsPromise;
}

function sourceCard(source) {
  return `<article class="source-card" data-source-id="${source.id}">
    <h3>${escapeHtml(source.city)}</h3>
    <div class="source-meta"><span>預設資料：<strong>${source.year} 年</strong></span><span class="source-path">${escapeHtml(source.bundledPath)}</span></div>
    <p class="source-status" data-source-status>正在讀取…</p>
    <div class="source-progress" aria-hidden="true"><span data-source-progress></span></div>
    <div class="upload-zone source-drop-zone" data-source-drop tabindex="0">
      <p class="upload-title">手動上傳其他年度${escapeHtml(source.city)} CSV</p>
      <p>可拖曳或點擊選擇 .csv</p>
      <label class="btn btn-secondary file-picker" for="source-file-${source.id}">選擇其他年度 CSV</label>
      <input id="source-file-${source.id}" class="visually-hidden" data-source-input type="file" accept=".csv,text/csv">
    </div>
    <label class="source-year-field"><span>手動資料年度</span><input data-manual-year type="number" min="1" step="1" value="${source.year}"></label>
    <fieldset class="source-encoding">
      <legend>檔案編碼</legend>
      <div class="source-encoding-options">
        <label class="radio-option"><input data-encoding-choice name="encoding-${source.id}" type="radio" value="auto" checked><span>自動偵測</span></label>
        <label class="radio-option"><input data-encoding-choice name="encoding-${source.id}" type="radio" value="utf-8"><span>UTF-8</span></label>
        <label class="radio-option"><input data-encoding-choice name="encoding-${source.id}" type="radio" value="big5"><span>Big5 / CP950</span></label>
      </div>
      <button class="btn btn-secondary" data-action="reparse" type="button" disabled>重新解析</button>
    </fieldset>
    <div class="file-list source-file-row" data-source-file aria-live="polite"></div>
    <div class="source-actions">
      <a class="btn btn-secondary" href="${source.datasetPageUrl}" target="_blank" rel="noreferrer">前往官方資料頁</a>
      <button class="btn btn-secondary" data-action="restore" type="button" disabled>恢復 ${source.year} 年預設資料</button>
    </div>
  </article>`;
}

function renderSources() {
  elements.sourceCards.innerHTML = SOURCE_IDS.map((id) => sourceCard(getLandValueSource(id))).join("");
  SOURCE_IDS.forEach(updateSourceView);
}

function updateSourceView(sourceId) {
  const card = elements.sourceCards.querySelector(`[data-source-id="${sourceId}"]`); if (!card) return;
  const sourceState = state.sources[sourceId];
  card.querySelector("[data-source-status]").textContent = sourceState.message;
  card.querySelector("[data-source-progress]").style.width = `${sourceState.progress}%`;
  card.querySelector('[data-action="restore"]').disabled = sourceState.sourceMode !== "manual" || sourceState.status === "loading";
  card.querySelector('[data-action="reparse"]').disabled = !sourceState.file || sourceState.status === "loading";
  card.querySelector("[data-manual-year]").value = sourceState.manualYear;
  const selectedEncoding = card.querySelector(`[data-encoding-choice][value="${sourceState.encodingChoice}"]`);
  if (selectedEncoding) selectedEncoding.checked = true;
  card.querySelector("[data-source-file]").innerHTML = sourceState.file
    ? `<div class="file-row"><span class="file-name">${escapeHtml(sourceState.file.name)}</span><span class="file-status">${sourceState.status === "ready" ? `✓ 已讀取 · 編碼：${escapeHtml(sourceState.detectedEncoding)} · ${sourceState.count.toLocaleString("zh-TW")} 筆` : sourceState.status === "error" ? "解析失敗" : "讀取中…"}</span><button class="icon-button" data-action="remove-source" type="button" aria-label="移除 CSV">×</button></div>` : "";
  updateBundledSummary();
  updateQueryAvailability();
}

function updateBundledSummary() {
  const labels = SOURCE_IDS.map((id) => `${getLandValueSource(id).city.replace("市", "")} ${state.sources[id].status === "ready" ? "✓" : state.sources[id].status === "loading" ? "載入中" : "未就緒"}`);
  elements.bundledSummary.textContent = `公告現值資料：${LAND_VALUE_DATA.year} 年　${labels.join("　")}`;
}

function updateQueryAvailability() {
  const loading = SOURCE_IDS.some((id) => state.sources[id].status === "loading");
  elements.queryInput.disabled = loading;
  elements.queryZone.classList.toggle("is-disabled", loading);
  elements.queryZone.setAttribute("aria-disabled", String(loading));
}

export function decodeCsvFile(buffer, encodingChoice = "auto") {
  const bytes = new Uint8Array(buffer);
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (encodingChoice === "utf-8") return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: hasUtf8Bom ? "UTF-8 BOM" : "UTF-8" };
  if (encodingChoice === "big5") return { text: new TextDecoder("big5", { fatal: true }).decode(bytes), encoding: "Big5 / CP950" };
  if (hasUtf8Bom) return { text: new TextDecoder("utf-8").decode(bytes), encoding: "UTF-8 BOM" };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" }; }
  catch { return { text: new TextDecoder("big5", { fatal: true }).decode(bytes), encoding: "Big5 / CP950" }; }
}

function parseCsvLine(line) {
  const values = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  values.push(value.trim()); return values;
}

function findFieldIndex(headers, aliases) {
  const keys = aliases.map(canonical);
  return headers.findIndex((header) => keys.includes(canonical(header)) || keys.some((key) => canonical(header).includes(key)));
}

function sourceColumnMap(headers, source) {
  return Object.fromEntries(Object.entries(source.fields).map(([field, aliases]) => [field, findFieldIndex(headers, aliases)]));
}

function sourceQueryFilter(source) {
  if (!isSafari || !state.records.length) return null;
  if (state.records.some((record) => !normalizeCity(record.city || state.fallbackCity))) return null;
  return new Set(state.records.filter((record) => normalizeCity(record.city || state.fallbackCity) === source.city).map((record) => buildLandValueKey({ ...record, city: record.city || state.fallbackCity })));
}

async function createSourceIndex(text, sourceId, encoding) {
  const source = getLandValueSource(sourceId); const sourceState = state.sources[sourceId];
  const firstBreak = text.indexOf("\n");
  if (firstBreak < 0) throw new Error("CSV 內容為空。 ");
  const headers = parseCsvLine(text.slice(0, firstBreak).replace(/^\uFEFF/, "").replace(/\r$/, ""));
  const columns = sourceColumnMap(headers, source);
  for (const required of ["district", "segment", "landNumber", "officialValue"]) if (columns[required] < 0) throw new Error(`CSV 缺少必要欄位：${required}`);
  const filter = sourceQueryFilter(source); sourceState.mode = filter ? "query-filter" : "full";
  const index = new Map(); let position = firstBreak + 1; let count = 0;
  sourceState.message = `正在建立索引…（${encoding}）`; sourceState.progress = 12; updateSourceView(sourceId);
  while (position < text.length) {
    for (let batch = 0; batch < 5000 && position < text.length; batch += 1) {
      let next = text.indexOf("\n", position); if (next < 0) next = text.length;
      const line = text.slice(position, next).replace(/\r$/, ""); position = next + 1;
      if (!line.trim()) continue;
      const cells = parseCsvLine(line);
      const combined = splitSectionAndSubsection(cells[columns.segment], "");
      const record = normalizeLandValueRecord({
        city: columns.city >= 0 ? cells[columns.city] : source.city,
        district: cells[columns.district], section: combined.section, subsection: combined.subsection,
        landNumber: cells[columns.landNumber], area: columns.area >= 0 ? cells[columns.area] : null, officialValue: cells[columns.officialValue],
        officialPrice: columns.officialPrice >= 0 ? cells[columns.officialPrice] : null
      });
      if (!record.district || !record.section || !record.landNumber || !Number.isFinite(record.officialValue)) continue;
      const key = buildLandValueKey(record);
      if (!filter || filter.has(key)) {
        index.set(key, record); count += 1;
      }
    }
    sourceState.progress = Math.min(98, 12 + Math.round((position / text.length) * 86));
    sourceState.message = filter ? `正在建立查詢索引… ${count.toLocaleString("zh-TW")} 筆` : `正在建立索引… ${count.toLocaleString("zh-TW")} 筆`;
    updateSourceView(sourceId); await yieldToUi();
  }
  sourceState.index = index; sourceState.count = count; sourceState.progress = 100; sourceState.status = "ready"; sourceState.detectedEncoding = encoding;
  const sourceLabel = sourceState.sourceMode === "manual" ? `手動資料 ${sourceState.activeYear} 年` : `${sourceState.activeYear} 年資料`;
  sourceState.message = `✓ ${sourceLabel}已就緒 · ${encoding} · ${count.toLocaleString("zh-TW")} 筆`;
  updateSourceView(sourceId); compareRecords();
}

async function handleSourceBuffer(buffer, sourceId, encodingChoice = state.sources[sourceId].encodingChoice) {
  const sourceState = state.sources[sourceId];
  sourceState.status = "loading"; sourceState.progress = 5; sourceState.message = "正在讀取 CSV…"; updateSourceView(sourceId);
  sourceState.buffer = buffer;
  const decoded = decodeCsvFile(buffer, encodingChoice); await createSourceIndex(decoded.text, sourceId, decoded.encoding);
}

async function handleSourceFile(file, sourceId) {
  if (!file || !/\.csv$/i.test(file.name)) { showActionMessage("請上傳 CSV (.csv) 檔案。"); return; }
  state.records.forEach((record) => { const city = normalizeCity(record.city || state.fallbackCity); if ((sourceId === "taipei" && city === "臺北市") || (sourceId === "newTaipei" && city === "新北市")) record.preserveRestoredResult = false; });
  const sourceState = state.sources[sourceId]; sourceState.file = file; sourceState.sourceMode = "manual"; sourceState.activeYear = Number(sourceState.manualYear) || LAND_VALUE_DATA.year;
  try { await handleSourceBuffer(await file.arrayBuffer(), sourceId); }
  catch (error) { sourceState.status = "error"; sourceState.progress = 0; sourceState.message = `此 CSV 可能使用不同文字編碼。${error.message ? ` ${error.message}` : ""}`; updateSourceView(sourceId); }
}

async function loadBundledSource(sourceId) {
  const source = getLandValueSource(sourceId); const sourceState = state.sources[sourceId];
  sourceState.sourceMode = "bundled"; sourceState.activeYear = LAND_VALUE_DATA.year; sourceState.file = null; sourceState.status = "loading"; sourceState.progress = 4; sourceState.message = "正在讀取…"; updateSourceView(sourceId);
  try {
    const response = await fetch(source.bundledPath, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await handleSourceBuffer(await response.arrayBuffer(), sourceId, source.bundledEncoding);
  } catch (error) {
    sourceState.status = "missing"; sourceState.progress = 0; sourceState.index = new Map();
    sourceState.message = `資料檔案未找到：${source.bundledPath}`; updateSourceView(sourceId); compareRecords();
  }
}

async function loadBundledLandValueData() {
  for (const sourceId of SOURCE_IDS) {
    if (state.sources[sourceId].status === "idle") { state.sources[sourceId].status = "loading"; state.sources[sourceId].message = "正在讀取…"; updateSourceView(sourceId); }
  }
  for (const sourceId of SOURCE_IDS) await loadBundledSource(sourceId);
}

function workbookHeaderMap(headers) {
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, findFieldIndex(headers, aliases)]));
}

export function detectHeaderRow(rows) {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const map = workbookHeaderMap(rows[index]);
    if (map.district >= 0 && map.section >= 0 && map.landNumber >= 0) return { index, map };
  }
  return null;
}

function cellNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseFormattedNumber(value); return Number.isFinite(parsed) ? parsed : null;
}

async function handleQueryFile(file) {
  if (!file || !/\.(?:xls|xlsx)$/i.test(file.name)) { showActionMessage("請上傳 Excel (.xls / .xlsx) 檔案。"); return; }
  state.queryFile = file; state.queryFileName = file.name; state.error = ""; renderQueryFile("讀取中…");
  try {
    const XLSX = await loadSheetJs(); const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true, cellDates: false });
    let selected = null;
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      const header = detectHeaderRow(rows);
      if (header) { selected = { sheetName, rows, header }; break; }
    }
    if (!selected) throw new Error("Excel 找不到必要欄位：區、段、地號。");
    state.sheetName = selected.sheetName; state.workbookRows = selected.rows; state.headerRowIndex = selected.header.index;
    state.headers = selected.rows[selected.header.index].map(normalizeHeaderText); state.columnMap = selected.header.map;
    state.records = selected.rows.slice(selected.header.index + 1).map((row, offset) => {
      const map = selected.header.map; const combined = splitSectionAndSubsection(row[map.section], map.subsection >= 0 ? row[map.subsection] : "");
      return {
        id: `query-${offset}`, sourceRowIndex: selected.header.index + 1 + offset, originalRow: [...row],
        city: map.city >= 0 ? normalizeCity(row[map.city]) : "", district: row[map.district], section: combined.section,
        subsection: combined.subsection, landNumber: formatLandNumber(row[map.landNumber]),
        queryArea: map.area >= 0 ? cellNumber(row[map.area]) : null, area: map.area >= 0 ? cellNumber(row[map.area]) : null,
        originalAnnouncedValue: map.announcedValue >= 0 ? cellNumber(row[map.announcedValue]) : null,
        latestAnnouncedValue: null, officialPrice: null, lookupStatus: "pending"
      };
    }).filter((record) => String(record.district ?? "").trim() && String(record.section ?? "").trim() && String(record.landNumber ?? "").trim());
    renderQueryFile(`✓ 已讀取 ${state.records.length.toLocaleString("zh-TW")} 筆`); compareRecords();
  } catch (error) { state.error = error.message || "Excel 讀取失敗。"; state.records = []; renderQueryFile(state.error, true); renderResults(); }
}

function compareRecords() {
  const diagnosticRequests = new Map();
  for (const record of state.records) {
    if (record.preserveRestoredResult) continue;
    record.diagnosticMessage = "";
    const city = normalizeCity(record.city || state.fallbackCity);
    if (!city) { record.latestAnnouncedValue = null; record.lookupStatus = "missing-city"; continue; }
    const sourceId = city === "臺北市" ? "taipei" : city === "新北市" ? "newTaipei" : "";
    const sourceState = sourceId ? state.sources[sourceId] : null;
    if (!sourceState || sourceState.status !== "ready") { record.latestAnnouncedValue = null; record.lookupStatus = "source-not-ready"; continue; }
    const queryKey = buildLandValueKey({ ...record, city });
    const match = sourceState.index.get(queryKey);
    Object.assign(record, compareLandValueRecord({ ...record, city }, sourceState.index));
    record.officialPrice = Number.isFinite(match?.officialPrice) ? match.officialPrice : null;
    record.sourceYear = sourceState.activeYear;
    record.sourceMode = sourceState.sourceMode;
    record.area = Number.isFinite(match?.area) ? match.area : record.queryArea;
    if (!match) {
      const diagnosticKey = buildLandValueDiagnosticKey({ ...record, city });
      const request = diagnosticRequests.get(sourceId) ?? { keys: new Set(), districts: new Map(), records: [] };
      request.keys.add(diagnosticKey); request.records.push({ record, diagnosticKey }); diagnosticRequests.set(sourceId, request);
    }
    if (DEBUG_LAND_VALUE_UPDATE && match) console.debug(`LAND VALUE LOOKUP\nQUERY: ${queryKey}\nSOURCE: ${buildLandValueKey(match)}\nDIAGNOSTIC: none`);
  }
  for (const [sourceId, request] of diagnosticRequests) {
    for (const sourceRecord of state.sources[sourceId].index.values()) {
      const diagnosticKey = buildLandValueDiagnosticKey(sourceRecord); if (!request.keys.has(diagnosticKey)) continue;
      const districts = request.districts.get(diagnosticKey) ?? new Set(); districts.add(sourceRecord.district); request.districts.set(diagnosticKey, districts);
    }
    for (const { record, diagnosticKey } of request.records) {
      const districts = request.districts.get(diagnosticKey);
      if (districts?.size === 1) {
        const [district] = districts;
        if (district !== String(record.district ?? "").trim().replace(/區$/, "")) record.diagnosticMessage = `相同段小段地號存在於「${district}區」，請確認行政區。`;
      }
      if (DEBUG_LAND_VALUE_UPDATE) console.debug(`LAND VALUE LOOKUP\nQUERY: ${buildLandValueKey({ ...record, city: record.city || state.fallbackCity })}\nSOURCE: (not found)\nDIAGNOSTIC: ${record.diagnosticMessage || "none"}`);
    }
  }
  renderResults();
}

function statusLabel(status) {
  return ({ same: "相同", changed: "已變更", "not-found": "查無資料", "missing-city": "請指定縣市", "source-not-ready": "資料未載入", pending: "待比對" })[status] ?? "待比對";
}

function renderResults() {
  const hasRecords = state.records.length > 0; elements.tableWrap.hidden = !hasRecords; elements.resultEmpty.hidden = hasRecords;
  elements.headerRow.innerHTML = `<th>縣市</th><th>區</th><th>段</th><th>小段</th><th>地號</th><th>面積</th>${state.showOriginalValue ? "<th>原公告現值</th>" : ""}<th>最新公告現值</th>${state.showOfficialPrice ? "<th>公告地價</th>" : ""}<th>狀態</th>`;
  elements.rows.innerHTML = state.records.map((record) => {
    const city = normalizeCity(record.city || state.fallbackCity);
    return `<tr data-record-id="${record.id}"><td>${escapeHtml(city)}</td><td>${escapeHtml(record.district)}</td><td>${escapeHtml(record.section)}</td><td>${escapeHtml(record.subsection)}</td><td>${escapeHtml(formatLandNumber(record.landNumber))}</td><td>${escapeHtml(formatArea(record.area) || "—")}</td>
      ${state.showOriginalValue ? `<td class="money">${escapeHtml(formatMoney(record.originalAnnouncedValue) || "—")}</td>` : ""}<td class="money">${escapeHtml(formatMoney(record.latestAnnouncedValue) || "—")}</td>
      ${state.showOfficialPrice ? `<td class="money">${escapeHtml(formatMoney(record.officialPrice) || "—")}</td>` : ""}<td class="status-cell">${statusLabel(record.lookupStatus)}${record.diagnosticMessage ? `<span class="source-diagnostic">${escapeHtml(record.diagnosticMessage)}</span>` : ""}</td></tr>`;
  }).join("");
  const ready = state.records.filter((record) => ["same", "changed"].includes(record.lookupStatus)).length;
  const changed = state.records.filter((record) => record.lookupStatus === "changed").length;
  const notFound = state.records.filter((record) => record.lookupStatus === "not-found").length;
  elements.resultSummary.textContent = hasRecords ? `共 ${state.records.length.toLocaleString("zh-TW")} 筆；完成比對 ${ready.toLocaleString("zh-TW")} 筆、已變更 ${changed.toLocaleString("zh-TW")} 筆、查無資料 ${notFound.toLocaleString("zh-TW")} 筆。` : "尚未載入土地資料 Excel。";
  elements.download.disabled = !hasRecords;
  savePageState();
}

function showActionMessage(message) { elements.actionMessage.textContent = message; elements.actionMessage.hidden = !message; }

function renderQueryFile(message = "", error = false) {
  const name = state.queryFile?.name || state.queryFileName;
  elements.queryFileList.innerHTML = name ? `<div class="file-row"><span class="file-name">${escapeHtml(name)}</span><span class="file-status ${error ? "is-error" : ""}">${escapeHtml(message || `✓ 已恢復 ${state.records.length.toLocaleString("zh-TW")} 筆`)}</span><button class="icon-button" data-action="remove-query" type="button" aria-label="移除 Excel">×</button></div>` : "";
}

async function downloadResult() {
  const XLSX = await loadSheetJs(); const rows = state.workbookRows.map((row) => [...row]);
  const originalHeader = state.headers; let nextIndex = originalHeader.length;
  const originalIndex = state.showOriginalValue ? nextIndex++ : -1; const latestIndex = nextIndex++; const priceIndex = state.showOfficialPrice ? nextIndex++ : -1; const statusIndex = nextIndex++;
  rows[state.headerRowIndex] = [...rows[state.headerRowIndex], ...(state.showOriginalValue ? ["原公告現值"] : []), "最新公告現值", ...(state.showOfficialPrice ? ["公告地價"] : []), "查詢狀態"];
  state.records.forEach((record) => {
    const row = [...record.originalRow]; if (originalIndex >= 0) row[originalIndex] = record.originalAnnouncedValue; row[latestIndex] = record.latestAnnouncedValue; if (priceIndex >= 0) row[priceIndex] = record.officialPrice; row[statusIndex] = statusLabel(record.lookupStatus); rows[record.sourceRowIndex] = row;
  });
  const workbook = XLSX.utils.book_new(); const worksheet = XLSX.utils.aoa_to_sheet(rows);
  for (const record of state.records) {
    for (const column of [originalIndex, latestIndex, priceIndex].filter((column) => column >= 0)) {
      const address = XLSX.utils.encode_cell({ r: record.sourceRowIndex, c: column });
      if (worksheet[address] && Number.isFinite(Number(worksheet[address].v))) { worksheet[address].t = "n"; worksheet[address].z = "#,##0"; }
    }
  }
  const activeYears = SOURCE_IDS.map((id) => {
    const source = getLandValueSource(id);
    return state.records.find((record) => normalizeCity(record.city || state.fallbackCity) === source.city && record.sourceYear)?.sourceYear ?? state.sources[id].activeYear;
  });
  const commonYear = activeYears.every((year) => year === activeYears[0]) ? `${activeYears[0]} 年` : "各城市使用不同年度";
  const metadata = XLSX.utils.aoa_to_sheet([
    ["公告現值資料年度", commonYear],
    ...SOURCE_IDS.map((id) => {
      const source = getLandValueSource(id); const sourceState = state.sources[id];
      const savedRecord = state.records.find((record) => normalizeCity(record.city || state.fallbackCity) === source.city && record.sourceYear);
      const year = savedRecord?.sourceYear ?? sourceState.activeYear; const mode = savedRecord?.sourceMode ?? sourceState.sourceMode;
      return [source.city, `${year} 年（${mode === "manual" ? "手動資料" : "專案預設資料"}）`];
    })
  ]);
  XLSX.utils.book_append_sheet(workbook, metadata, "資料來源");
  XLSX.utils.book_append_sheet(workbook, worksheet, state.sheetName || "公告現值更新結果");
  const stem = (state.queryFile?.name || state.queryFileName).replace(/\.(?:xls|xlsx)$/i, "") || "土地資料";
  XLSX.writeFile(workbook, `${stem}_公告現值更新.xlsx`);
}

function droppedFile(dataTransfer) {
  const items = [...(dataTransfer?.items || [])].filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean);
  return items[0] || dataTransfer?.files?.[0] || null;
}

function setupDropZone(zone, handler) {
  let depth = 0;
  zone.addEventListener("dragenter", (event) => { event.preventDefault(); depth += 1; zone.classList.add("is-dragging"); });
  zone.addEventListener("dragover", (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; zone.classList.add("is-dragging"); });
  zone.addEventListener("dragleave", (event) => { event.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove("is-dragging"); });
  zone.addEventListener("drop", (event) => { event.preventDefault(); event.stopPropagation(); depth = 0; zone.classList.remove("is-dragging"); handler(droppedFile(event.dataTransfer)); });
}

renderSources();
elements.accordionButton.addEventListener("click", () => { const open = elements.accordionButton.getAttribute("aria-expanded") !== "true"; elements.accordionButton.setAttribute("aria-expanded", String(open)); elements.accordionContent.hidden = !open; });
elements.sourceCards.addEventListener("click", (event) => {
  const card = event.target.closest("[data-source-id]"); if (!card) return; const sourceId = card.dataset.sourceId;
  if (event.target.matches('[data-action="reparse"]') && state.sources[sourceId].buffer) handleSourceBuffer(state.sources[sourceId].buffer, sourceId).catch((error) => { state.sources[sourceId].status = "error"; state.sources[sourceId].message = error.message; updateSourceView(sourceId); });
  if (event.target.matches('[data-action="restore"]') || event.target.matches('[data-action="remove-source"]')) {
    state.records.forEach((record) => { const city = normalizeCity(record.city || state.fallbackCity); if ((sourceId === "taipei" && city === "臺北市") || (sourceId === "newTaipei" && city === "新北市")) record.preserveRestoredResult = false; });
    loadBundledSource(sourceId);
  }
});
elements.sourceCards.addEventListener("change", (event) => {
  const card = event.target.closest("[data-source-id]"); if (!card) return;
  if (event.target.matches("[data-source-input]")) {
    state.sources[card.dataset.sourceId].manualYear = Number(card.querySelector("[data-manual-year]").value) || LAND_VALUE_DATA.year;
    handleSourceFile(event.target.files[0], card.dataset.sourceId); event.target.value = "";
  }
  if (event.target.matches("[data-encoding-choice]")) { state.sources[card.dataset.sourceId].encodingChoice = event.target.value; updateSourceView(card.dataset.sourceId); }
  if (event.target.matches("[data-manual-year]")) { state.sources[card.dataset.sourceId].manualYear = Number(event.target.value) || LAND_VALUE_DATA.year; if (state.sources[card.dataset.sourceId].sourceMode === "manual") state.sources[card.dataset.sourceId].activeYear = state.sources[card.dataset.sourceId].manualYear; updateSourceView(card.dataset.sourceId); }
});
elements.sourceCards.addEventListener("input", (event) => {
  const card = event.target.closest("[data-source-id]"); if (!card || !event.target.matches("[data-manual-year]")) return;
  state.sources[card.dataset.sourceId].manualYear = Number(event.target.value) || LAND_VALUE_DATA.year;
});
for (const sourceId of SOURCE_IDS) setupDropZone(elements.sourceCards.querySelector(`[data-source-id="${sourceId}"] [data-source-drop]`), (file) => handleSourceFile(file, sourceId));
setupDropZone(elements.queryZone, handleQueryFile);
elements.queryInput.addEventListener("change", (event) => { handleQueryFile(event.target.files[0]); event.target.value = ""; });
document.querySelectorAll('input[name="fallbackCity"]').forEach((input) => { input.checked = input.value === state.fallbackCity; input.addEventListener("change", () => { state.fallbackCity = input.value; compareRecords(); }); });
elements.showOriginal.checked = state.showOriginalValue;
elements.showOfficialPrice.checked = state.showOfficialPrice;
elements.showOriginal.addEventListener("change", () => { state.showOriginalValue = elements.showOriginal.checked; renderResults(); });
elements.showOfficialPrice.addEventListener("change", () => { state.showOfficialPrice = elements.showOfficialPrice.checked; renderResults(); });
elements.queryFileList.addEventListener("click", (event) => { if (event.target.matches('[data-action="remove-query"]')) { state.queryFile = null; state.queryFileName = ""; state.records = []; state.workbookRows = []; renderQueryFile(); renderResults(); } });
elements.clearPageState.addEventListener("click", () => {
  if (!window.confirm("確定清除公告現值更新頁目前資料？其他功能頁不受影響。")) return;
  clearingPageState = true; clearSessionState(LAND_VALUE_STORAGE_KEY); location.reload();
});
elements.download.addEventListener("click", () => downloadResult().catch((error) => showActionMessage(error.message || "Excel 下載失敗。")));
window.addEventListener("pagehide", savePageState);
for (const eventName of ["dragover", "drop"]) document.addEventListener(eventName, (event) => { if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault(); });
renderQueryFile();
renderResults();
loadBundledLandValueData();

export { buildLandValueKey, handleQueryFile };
