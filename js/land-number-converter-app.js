import { formatLandNumber } from "./formatters.js";
import { normalizeCity, normalizeDistrict } from "./land-value-normalization.js";
import { applyLookup, createDistrictLookup, detectLandNumberHeaderRow, expandResultRows, parseWorkbookRecords } from "./land-number-converter-core.js";
import { LAND_NUMBER_SOURCES, getLandNumberSourceByCity } from "./land-number-sources.js";
import { clearSessionState, loadSessionState, saveSessionState } from "./session-state.js";

const STORAGE_KEY = "landTool.landNumberConverterState";
const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const restored = loadSessionState(STORAGE_KEY) ?? {};
const state = {
  direction: "old-to-new", queryFile: null, queryFileName: "", workbookRows: [], headerRowIndex: -1,
  headers: [], columnMap: {}, records: [], sheetName: "", manifests: {}, selectedCity: "新北市", loadedDistricts: [], error: "", ...restored
};
state.queryFile = null;
const lookupCache = { "old-to-new": new Map(), "new-to-old": new Map() };
let sheetJsPromise;
let clearing = false;

const elements = {
  sourceSummary: document.querySelector("#converterSourceSummary"), accordion: document.querySelector("#converterSourceAccordion"),
  accordionContent: document.querySelector("#converterSourceContent"), sourceCities: document.querySelector("#sourceCitySummaries"), loadedDistricts: document.querySelector("#loadedDistricts"),
  dropZone: document.querySelector("#converterDropZone"), fileInput: document.querySelector("#converterFile"), fileList: document.querySelector("#converterFileList"),
  resultSummary: document.querySelector("#converterResultSummary"), resultEmpty: document.querySelector("#converterResultEmpty"),
  resultWrap: document.querySelector("#converterResultWrap"), resultHeader: document.querySelector("#converterResultHeader"), resultRows: document.querySelector("#converterResultRows"),
  actionMessage: document.querySelector("#converterActionMessage"), clear: document.querySelector("#clearConverterState"), download: document.querySelector("#downloadConverterResult")
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const statusLabel = (status) => ({ found: "已找到", multiple: "一對多", "not-found": "找不到", pending: "待查詢" })[status] ?? "待查詢";
const displaySection = (value, suffix) => value ? `${value}${suffix}` : "";

function savePageState() {
  if (clearing) return;
  saveSessionState(STORAGE_KEY, {
    queryFileName: state.queryFile?.name || state.queryFileName, workbookRows: state.workbookRows,
    headerRowIndex: state.headerRowIndex, headers: state.headers, columnMap: state.columnMap,
    records: state.records, direction: state.direction, selectedCity: state.selectedCity, sheetName: state.sheetName,
    loadedCity: state.selectedCity, loadedDistricts: state.loadedDistricts, uiOptions: {}
  });
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

function showMessage(message) { elements.actionMessage.textContent = message; elements.actionMessage.hidden = !message; }

function manifestDate(manifest) {
  if (manifest.sourceUpdatedThrough) {
    const [year, month, day] = String(manifest.sourceUpdatedThrough).split("-");
    return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
  }
  if (manifest.sourceUpdatedAt) return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(manifest.sourceUpdatedAt));
  return "依官方最新版本";
}

async function loadManifest(source) {
  if (state.manifests[source.id]) return state.manifests[source.id];
  const response = await fetch(`${source.bundledBase}${source.manifest}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`${source.city} bundled data manifest 載入失敗（HTTP ${response.status}）。`);
  const manifest = await response.json(); state.manifests[source.id] = manifest; return manifest;
}

async function loadAllManifests() {
  const entries = await Promise.all(Object.values(LAND_NUMBER_SOURCES).map(async (source) => [source, await loadManifest(source)]));
  elements.sourceSummary.textContent = entries.map(([source]) => `✓ ${source.city}`).join("　");
  elements.sourceCities.innerHTML = entries.map(([source, manifest]) => `<article class="converter-source-city"><strong>${escapeHtml(source.city)}</strong><span>資料更新：${escapeHtml(manifestDate(manifest))}</span><span>${escapeHtml(source.freshnessNote)}</span></article>`).join("");
}

function districtConfig(manifest, district) {
  const normalized = `${normalizeDistrict(district)}區`;
  return Object.values(manifest?.districts ?? {}).find((item) => item.name === normalized);
}

async function loadDistrictIndex(city, district, direction) {
  const normalizedCity = normalizeCity(city); const normalizedDistrict = normalizeDistrict(district);
  const cacheKey = `${normalizedCity}|${normalizedDistrict}`;
  const cached = lookupCache[direction].get(cacheKey);
  if (cached) return cached;
  const source = getLandNumberSourceByCity(normalizedCity);
  if (!source) throw new Error(`目前不支援「${normalizedCity || city}」。`);
  const manifest = await loadManifest(source); const config = districtConfig(manifest, normalizedDistrict);
  if (!config) throw new Error(`${normalizedCity} bundled data 沒有「${normalizedDistrict}區」。`);
  const response = await fetch(`${source.bundledBase}${config.file}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`${normalizedCity}${normalizedDistrict}區資料載入失敗（HTTP ${response.status}）。`);
  const csvText = await response.text();
  const { index } = createDistrictLookup(csvText, direction, normalizedCity);
  lookupCache[direction].set(cacheKey, index);
  return index;
}

async function runLookup() {
  if (!state.records.length) { renderResults(); return; }
  showMessage(""); elements.resultSummary.textContent = "正在載入需要的行政區並建立索引…";
  try {
    const areas = [...new Map(state.records.map((record) => [`${record.city}|${record.district}`, { city: record.city, district: normalizeDistrict(record.district) }])).values()];
    const pairs = await Promise.all(areas.map(async ({ city, district }) => [`${city}|${district}`, await loadDistrictIndex(city, district, state.direction)]));
    state.loadedDistricts = areas;
    state.records = applyLookup(state.records, new Map(pairs), state.direction);
    elements.loadedDistricts.textContent = `查詢時實際載入：${areas.map(({ city, district }) => `${city}${district}區`).join("、")}`;
  } catch (error) {
    showMessage(error.message || "新舊地號查詢失敗。");
  }
  renderResults();
}

function renderFile(message = "", isError = false) {
  const name = state.queryFile?.name || state.queryFileName;
  elements.fileList.innerHTML = name ? `<div class="file-row"><span class="file-name">${escapeHtml(name)}</span><span class="file-status ${isError ? "is-error" : ""}">${escapeHtml(message || `✓ 已恢復 ${state.records.length.toLocaleString("zh-TW")} 筆`)}</span><button class="icon-button" data-action="remove-query" type="button" aria-label="移除 Excel">×</button></div>` : "";
}

function renderResults() {
  const expanded = expandResultRows(state.records, state.direction); const hasRows = expanded.length > 0;
  const target = state.direction === "old-to-new" ? "新" : "舊";
  elements.resultHeader.innerHTML = `<th>原縣市</th><th>原區</th><th>原段</th><th>原小段</th><th>原地號</th><th>查詢狀態</th><th>${target}縣市</th><th>${target}區</th><th>${target}段</th><th>${target}小段</th><th>${target}地號</th>`;
  elements.resultRows.innerHTML = expanded.map((item) => `<tr class="${item.status === "not-found" ? "is-not-found" : ""}">
    <td>${escapeHtml(item.record.city)}</td><td>${escapeHtml(`${item.record.district}區`)}</td><td>${escapeHtml(displaySection(item.record.section, "段"))}</td><td>${escapeHtml(displaySection(item.record.subsection, "小段"))}</td><td>${escapeHtml(formatLandNumber(item.record.landNumber))}</td>
    <td class="status-cell">${statusLabel(item.status)}</td><td>${escapeHtml(item.landNumber ? item.city : "")}</td><td>${escapeHtml(item.district)}</td><td>${escapeHtml(displaySection(item.section, "段"))}</td><td>${escapeHtml(displaySection(item.subsection, "小段"))}</td><td>${escapeHtml(formatLandNumber(item.landNumber))}</td></tr>`).join("");
  const found = state.records.filter((record) => record.status === "found").length;
  const multiple = state.records.filter((record) => record.status === "multiple").length;
  const notFound = state.records.filter((record) => record.status === "not-found").length;
  elements.resultSummary.textContent = hasRows ? `原始 ${state.records.length.toLocaleString("zh-TW")} 筆，結果 ${expanded.length.toLocaleString("zh-TW")} 列；已找到 ${found.toLocaleString("zh-TW")} 筆、一對多 ${multiple.toLocaleString("zh-TW")} 筆、找不到 ${notFound.toLocaleString("zh-TW")} 筆。` : "尚未載入土地資料 Excel。";
  elements.resultWrap.hidden = !hasRows; elements.resultEmpty.hidden = hasRows; elements.download.disabled = !hasRows;
  savePageState();
}

async function handleQueryFile(file) {
  if (!file || !/\.(?:xls|xlsx)$/i.test(file.name)) { showMessage("請上傳 Excel (.xls / .xlsx) 檔案。"); return; }
  state.queryFile = file; state.queryFileName = file.name; state.error = ""; renderFile("讀取中…");
  try {
    const XLSX = await loadSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true, cellDates: false });
    let selected = null;
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      const header = detectLandNumberHeaderRow(rows, 30);
      if (header) { selected = { sheetName, rows, header }; break; }
    }
    if (!selected) throw new Error("Excel 找不到必要欄位：區、段、地號。");
    const parsed = parseWorkbookRecords(selected.rows, selected.header, state.selectedCity);
    const unsupported = [...new Set(parsed.records.map((record) => normalizeCity(record.city)).filter((city) => !getLandNumberSourceByCity(city)))];
    if (unsupported.length) throw new Error(`目前只支援臺北市與新北市；Excel 內含：${unsupported.join("、")}。`);
    state.sheetName = selected.sheetName; state.workbookRows = selected.rows; state.headerRowIndex = selected.header.index;
    state.headers = parsed.headers; state.columnMap = selected.header.map; state.records = parsed.records;
    renderFile(`✓ 已讀取 ${state.records.length.toLocaleString("zh-TW")} 筆`); await runLookup();
  } catch (error) {
    state.error = error.message || "Excel 讀取失敗。"; state.records = []; renderFile(state.error, true); renderResults(); showMessage(state.error);
  }
}

function styleWorksheet(XLSX, worksheet, rowCount, columnCount) {
  worksheet["!cols"] = Array.from({ length: columnCount }, (_, index) => ({ wch: index < state.headers.length ? 14 : 12 }));
  worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: state.headerRowIndex, c: 0 }, { r: Math.max(state.headerRowIndex, rowCount - 1), c: columnCount - 1 }) };
  worksheet["!freeze"] = { xSplit: 0, ySplit: state.headerRowIndex + 1 };
}

async function downloadResult() {
  const XLSX = await loadSheetJs(); const expanded = expandResultRows(state.records, state.direction);
  const targetLabel = state.direction === "old-to-new" ? "新" : "舊";
  const resultHeaders = ["原縣市", "查詢方向", "查詢狀態", "對應縣市", `對應區`, `對應段`, `對應小段`, `對應地號`];
  const rows = state.workbookRows.slice(0, state.headerRowIndex).map((row) => [...row]);
  rows.push([...state.headers, ...resultHeaders]);
  for (const item of expanded) rows.push([...item.record.originalRow, item.record.city, state.direction === "old-to-new" ? "舊地號 → 新地號" : "新地號 → 舊地號", statusLabel(item.status), item.landNumber ? item.city : "", item.district, item.section, item.subsection, item.landNumber]);
  const workbook = XLSX.utils.book_new(); const resultSheet = XLSX.utils.aoa_to_sheet(rows);
  styleWorksheet(XLSX, resultSheet, rows.length, rows[state.headerRowIndex]?.length ?? resultHeaders.length);
  XLSX.utils.book_append_sheet(workbook, resultSheet, "完整查詢結果");
  const convertedRows = [["縣市", "區", "段", "小段", "地號"]];
  for (const item of expanded) {
    if (!item.landNumber) continue;
    convertedRows.push([item.city, normalizeDistrict(item.district), item.section, item.subsection, item.landNumber]);
  }
  const convertedSheet = XLSX.utils.aoa_to_sheet(convertedRows);
  convertedSheet["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
  convertedSheet["!autofilter"] = { ref: `A1:E${convertedRows.length}` }; convertedSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, convertedSheet, "轉換後土地清單");
  const stem = (state.queryFile?.name || state.queryFileName).replace(/\.(?:xls|xlsx)$/i, "") || "土地資料";
  XLSX.writeFile(workbook, `${stem}_${targetLabel}地號查詢結果.xlsx`);
}

function droppedFile(dataTransfer) {
  return [...(dataTransfer?.items || [])].filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean)[0] || dataTransfer?.files?.[0] || null;
}

function setupDropZone(zone, handler) {
  let depth = 0;
  zone.addEventListener("dragenter", (event) => { event.preventDefault(); depth += 1; zone.classList.add("is-dragging"); });
  zone.addEventListener("dragover", (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; });
  zone.addEventListener("dragleave", (event) => { event.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove("is-dragging"); });
  zone.addEventListener("drop", (event) => { event.preventDefault(); depth = 0; zone.classList.remove("is-dragging"); handler(droppedFile(event.dataTransfer)); });
}

elements.accordion.addEventListener("click", () => { const open = elements.accordion.getAttribute("aria-expanded") !== "true"; elements.accordion.setAttribute("aria-expanded", String(open)); elements.accordionContent.hidden = !open; });
document.querySelectorAll('input[name="queryDirection"]').forEach((input) => {
  input.checked = input.value === state.direction;
  input.addEventListener("change", () => { state.direction = input.value; state.records = state.records.map((record) => ({ ...record, status: "pending", matches: [] })); runLookup(); });
});
document.querySelectorAll('input[name="selectedCity"]').forEach((input) => {
  input.checked = input.value === state.selectedCity;
  input.addEventListener("change", () => { state.selectedCity = normalizeCity(input.value); savePageState(); });
});
setupDropZone(elements.dropZone, handleQueryFile);
elements.fileInput.addEventListener("change", (event) => { handleQueryFile(event.target.files[0]); event.target.value = ""; });
elements.fileList.addEventListener("click", (event) => { if (event.target.matches('[data-action="remove-query"]')) { state.queryFile = null; state.queryFileName = ""; state.workbookRows = []; state.records = []; state.loadedDistricts = []; renderFile(); renderResults(); } });
elements.clear.addEventListener("click", () => { if (!window.confirm("確定清除新舊地號查詢頁目前資料？其他功能頁不受影響。")) return; clearing = true; clearSessionState(STORAGE_KEY); location.reload(); });
elements.download.addEventListener("click", () => downloadResult().catch((error) => showMessage(error.message || "Excel 下載失敗。")));
window.addEventListener("pagehide", savePageState);
for (const eventName of ["dragover", "drop"]) document.addEventListener(eventName, (event) => { if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault(); });

renderFile(); renderResults();
if (state.loadedDistricts.length) elements.loadedDistricts.textContent = `上次查詢載入：${state.loadedDistricts.map((area) => typeof area === "string" ? `${area}區` : `${area.city}${area.district}區`).join("、")}（需要時重新載入）`;
loadAllManifests().catch((error) => { elements.sourceSummary.textContent = error.message; showMessage(error.message); });

export { handleQueryFile, runLookup };
