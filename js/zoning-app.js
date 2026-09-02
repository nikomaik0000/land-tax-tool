import { formatLandNumber } from "./formatters.js";
import { normalizeCity } from "./land-value-normalization.js";
import { clearSessionState, loadSessionState, saveSessionState } from "./session-state.js";
import { parseZoningWorkbookRecords } from "./zoning-core.js";
import { loadTaipeiZoningManifest, lookupZoningRecords } from "./zoning-source.js";

const STORAGE_KEY = "landTool.zoningState";
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const restored = loadSessionState(STORAGE_KEY) ?? {};
let xlsxPromise;
let records = Array.isArray(restored.records) ? restored.records : [];
let headers = Array.isArray(restored.headers) ? restored.headers : [];
let fileName = String(restored.fileName ?? "");
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const statusText = { found: "已找到", multiple: "多分區", "not-found": "找不到", unsupported: "新北尚未支援", pending: "待查詢" };

function saveState() { saveSessionState(STORAGE_KEY, { records, headers, fileName, fallbackCity: $("#fallbackCity").value }); }
function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  xlsxPromise ??= new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = XLSX_URL; script.onload = () => globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("Excel 元件載入失敗。")); script.onerror = () => reject(new Error("無法載入 Excel 元件。")); document.head.append(script); });
  return xlsxPromise;
}
function message(text) { $("#zoningMessage").textContent = text; $("#zoningMessage").hidden = !text; }
function expanded() { return records.flatMap((record) => (record.matches?.length ? record.matches : [null]).map((result) => ({ record, result }))); }
function renderFile(status = "") { $("#zoningFileList").innerHTML = fileName ? `<div class="file-row"><span aria-hidden="true"></span><span class="file-name">${esc(fileName)}</span><span class="file-status">${esc(status || `✓ 已恢復 ${records.length.toLocaleString("zh-TW")} 筆`)}</span><button class="icon-button" data-remove-zoning-file type="button" aria-label="移除 Excel">×</button></div>` : ""; }

function render() {
  const rows = expanded(); const hasRows = records.length > 0;
  $("#zoningRows").innerHTML = rows.map(({ record, result }) => `<tr class="${["not-found", "unsupported"].includes(record.status) ? "is-not-found" : ""}"><td>${esc(record.city)}</td><td>${esc(record.district ? `${record.district}區` : "")}</td><td>${esc(record.section ? `${record.section}段` : "")}</td><td>${esc(record.subsection ? `${record.subsection}小段` : "")}</td><td>${esc(formatLandNumber(record.landNumber))}</td><td>${esc(result?.landType)}</td><td>${esc(result?.zoning)}</td><td>${esc(result?.landUse)}</td><td class="status-cell">${esc(statusText[record.status])}</td></tr>`).join("");
  const counts = Object.fromEntries(["found", "multiple", "not-found", "unsupported"].map((status) => [status, records.filter((record) => record.status === status).length]));
  $("#zoningResultSummary").textContent = hasRows ? `原始 ${records.length.toLocaleString("zh-TW")} 筆；已找到 ${counts.found.toLocaleString("zh-TW")} 筆、多分區 ${counts.multiple.toLocaleString("zh-TW")} 筆、找不到 ${counts["not-found"].toLocaleString("zh-TW")} 筆、新北尚未支援 ${counts.unsupported.toLocaleString("zh-TW")} 筆。` : "尚未載入土地資料 Excel。";
  $("#zoningResultWrap").hidden = !hasRows; $("#zoningEmpty").hidden = hasRows; $("#downloadZoning").disabled = !hasRows; saveState();
}
async function lookup() { records = await lookupZoningRecords(records); render(); }

async function handle(file) {
  if (!file || !/\.(xls|xlsx)$/i.test(file.name)) return message("請上傳 Excel (.xls / .xlsx) 檔案。");
  try {
    message(""); fileName = file.name; renderFile("讀取中…"); const XLSX = await loadXlsx(); const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true }); let parsed;
    for (const name of workbook.SheetNames) { const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" }); try { parsed = parseZoningWorkbookRecords(rows, $("#fallbackCity").value); break; } catch {} }
    if (!parsed) throw new Error("Excel 找不到必要欄位：區、段、地號。"); records = parsed.records; headers = parsed.headers;
    const unsupportedCities = [...new Set(records.map((record) => normalizeCity(record.city)).filter((city) => !["臺北市", "新北市"].includes(city)))];
    if (unsupportedCities.length) throw new Error(`目前只接受臺北市與新北市：${unsupportedCities.join("、")}`);
    renderFile(`✓ 已讀取 ${records.length.toLocaleString("zh-TW")} 筆`); await lookup();
  } catch (error) { records = []; render(); renderFile(error.message || "查詢失敗。"); message(error.message || "查詢失敗。"); }
}

async function download() {
  const XLSX = await loadXlsx(); const output = [[...headers, "縣市", "土地類型", "使用分區", "使用地類別", "查詢狀態"]];
  for (const { record, result } of expanded()) output.push([...record.originalRow, record.city, result?.landType ?? "", result?.zoning ?? "", result?.landUse ?? "", statusText[record.status]]);
  const workbook = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet(output); sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: output.length - 1, c: output[0].length - 1 }) }; sheet["!freeze"] = { xSplit: 0, ySplit: 1 }; sheet["!cols"] = output[0].map(() => ({ wch: 14 })); XLSX.utils.book_append_sheet(workbook, sheet, "使用分區查詢結果"); XLSX.writeFile(workbook, `${fileName.replace(/\.(xls|xlsx)$/i, "") || "土地資料"}_使用分區查詢結果.xlsx`);
}
function formatManifestDate(manifest) { const value = manifest.sourceUpdatedAt ?? manifest.generatedAt; if (!value) return "依官方最新版本"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }

$("#fallbackCity").value = restored.fallbackCity === "新北市" ? "新北市" : "臺北市"; $("#fallbackCity").addEventListener("change", saveState);
$("#zoningSourceAccordion").addEventListener("click", () => { const open = $("#zoningSourceAccordion").getAttribute("aria-expanded") !== "true"; $("#zoningSourceAccordion").setAttribute("aria-expanded", String(open)); $("#zoningSourceContent").hidden = !open; });
$("#zoningFile").addEventListener("change", (event) => { handle(event.target.files[0]); event.target.value = ""; }); $("#zoningDropZone").addEventListener("dragover", (event) => event.preventDefault()); $("#zoningDropZone").addEventListener("drop", (event) => { event.preventDefault(); handle(event.dataTransfer.files[0]); });
$("#downloadZoning").addEventListener("click", () => download().catch((error) => message(error.message))); $("#zoningFileList").addEventListener("click", (event) => { if (!event.target.matches("[data-remove-zoning-file]")) return; records = []; headers = []; fileName = ""; renderFile(); render(); });
$("#clearZoning").addEventListener("click", () => { records = []; headers = []; fileName = ""; clearSessionState(STORAGE_KEY); renderFile(); message(""); render(); }); window.addEventListener("pagehide", saveState);

loadTaipeiZoningManifest().then((manifest) => { const rows = Number(manifest.totalRows ?? manifest.rows ?? 0); $("#zoningSourceSummary").textContent = "✓ 臺北市"; $("#taipeiZoningDate").textContent = `資料更新：${formatManifestDate(manifest)}${rows ? `，${rows.toLocaleString("zh-TW")} 筆` : ""}`; }).catch((error) => message(error.message));
renderFile(); render();
