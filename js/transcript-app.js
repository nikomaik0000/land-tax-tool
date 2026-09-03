import { calculateGiftTax, calculateLandCurrentValue, calculateTotalLandCurrentValue, calculateTransferTaxTotals } from "./calculations.js";
import { loadCpiWorkbook, lookupPriceIndex, normalizeRocMonth } from "./cpi-lookup.js";
import { CPI_SOURCE, loadDefaultCpiSource } from "./cpi-source.js";
import { formatArea, formatLandNumber, formatMoney, formatSequence, parseFormattedNumber } from "./formatters.js";
import { calculateLandValueIncrementTaxes } from "./land-value-increment-tax.js";
import { parseTranscriptPdfToLands } from "./transcript-parser.js";
import { renderA4Report } from "./a4-report-renderer.js";
import { exportExcel } from "./excel-export.js";
import { createDefaultReportConfiguration, createReportSettings } from "./report-settings.js";
import { clearSessionState, loadSessionState, saveSessionState } from "./session-state.js";
import { ensureOwner, migrateRelationshipState } from "./relationships.js";

const now = new Date();
const defaultCalculationDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const TRANSCRIPT_STORAGE_KEY = "landTool.transcriptState";
const transcriptDefaults = {
  file: null, lands: [], parseMeta: {}, tryLandTax: false,
  cpiFile: null, cpiData: null, cpiStatus: "idle", cpiMessage: "", cpiSource: { status: "idle", type: null, sourceName: "", loadedAt: null }, calculationDate: defaultCalculationDate, status: "idle", error: "",
  caseName: "土地增值稅試算", owner: "", owners: [], houses: [], house: { address: "", assessedValue: 0, shareNumerator: 1, shareDenominator: 1, currentValue: 0, deedTax: 0 },
  totalLandCurrentValue: 0, caseCurrentValue: 0, ...createDefaultReportConfiguration()
};
const restoredTranscript = loadSessionState(TRANSCRIPT_STORAGE_KEY) ?? {};
export const transcriptState = {
  ...transcriptDefaults,
  ...restoredTranscript,
  file: null,
  cpiFile: null,
  cpiData: null,
  cpiStatus: "idle",
  cpiMessage: "",
  cpiSource: { status: "idle", type: null, sourceName: "", loadedAt: null },
  status: restoredTranscript.lands?.length ? "ready" : "idle",
  house: { ...transcriptDefaults.house, ...(restoredTranscript.house ?? {}) },
  displayOptions: { ...transcriptDefaults.displayOptions, ...(restoredTranscript.displayOptions ?? {}), taxSummaryItems: { ...transcriptDefaults.displayOptions.taxSummaryItems, ...(restoredTranscript.displayOptions?.taxSummaryItems ?? {}) } },
  giftTax: { ...transcriptDefaults.giftTax, ...(restoredTranscript.giftTax ?? {}) }
};
migrateRelationshipState(transcriptState);

const elements = {
  uploadZone: document.querySelector("#transcriptUploadZone"), fileInput: document.querySelector("#transcriptPdfFile"),
  fileList: document.querySelector("#transcriptFileList"), reparse: document.querySelector("#reparseTranscript"),
  status: document.querySelector("#transcriptStatus"), enableTax: document.querySelector("#enableTranscriptTax"),
  cpiBlock: document.querySelector("#cpiUploadBlock"), cpiZone: document.querySelector("#cpiUploadZone"),
  cpiInput: document.querySelector("#cpiWorkbookFile"), cpiFileList: document.querySelector("#cpiFileList"), cpiSourceStatus: document.querySelector("#cpiSourceStatus"), cpiSourceLink: document.querySelector("#cpiSourceLink"), cpiAlternatives: document.querySelector("#cpiAlternativeSources"), restoreDefaultCpi: document.querySelector("#restoreDefaultCpi"), calculationDate: document.querySelector("#transcriptCalculationDate"), tableWrap: document.querySelector("#transcriptTableWrap"),
  tableEmpty: document.querySelector("#transcriptTableEmpty"), rows: document.querySelector("#transcriptLandRows"),
  validation: document.querySelector("#transcriptValidation"), total: document.querySelector("#transcriptTotalCurrentValue"),
  settingsSection: document.querySelector("#transcriptReportSettingsSection"), settings: document.querySelector("#transcriptReportSettings"),
  previewSection: document.querySelector("#transcriptPreviewSection"), downloadExcel: document.querySelector("#transcriptDownloadExcel"), printReport: document.querySelector("#transcriptPrintReport"),
  reportWarning: document.querySelector("#transcriptReportWarning"), reportPreview: document.querySelector("#transcriptReportPreview"), a4Viewport: document.querySelector("#transcriptA4Viewport"), a4Sheet: document.querySelector("#transcriptA4Sheet"), dynamicPrintPage: document.querySelector("#transcriptDynamicPrintPage"), clearPageState: document.querySelector("#clearTranscriptPageState")
};
let settingsController;
let clearingPageState = false;
let defaultCpiLoadPromise = null;

function savePageState() {
  if (clearingPageState) return;
  const { file, cpiFile, cpiData, cpiSource, ...snapshot } = transcriptState;
  saveSessionState(TRANSCRIPT_STORAGE_KEY, snapshot);
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const hasValue = (value) => value !== null && value !== undefined && value !== "";
const hasFiniteValue = (value) => hasValue(value) && Number.isFinite(Number(value));

function updateLandCurrentValue(land) {
  const hasTransferShare = land.previousTransfers?.some((transfer) => hasFiniteValue(transfer.shareNumerator) && hasFiniteValue(transfer.shareDenominator) && Number(transfer.shareDenominator) !== 0);
  const complete = hasFiniteValue(land.area) && hasFiniteValue(land.announcedValue)
    && (hasTransferShare || (hasFiniteValue(land.shareNumerator) && hasFiniteValue(land.shareDenominator) && Number(land.shareDenominator) !== 0));
  land.currentValue = complete ? calculateLandCurrentValue(land) : null;
}

function calculateLandTaxForLand(land) {
  land.previousTransfers = calculateLandValueIncrementTaxes(land, transcriptState.calculationDate);
  return land.previousTransfers.map((transfer) => transfer.taxCalculation);
}

function applyLandTaxCalculations(render = true) {
  if (!transcriptState.tryLandTax) return;
  transcriptState.lands.forEach(calculateLandTaxForLand);
  if (render) renderRows();
}

function input(land, field, label, format = "") {
  const raw = land[field];
  const shown = format === "money" ? formatMoney(raw) : format === "area" ? formatArea(raw) : format === "land-number" ? formatLandNumber(raw) : (raw ?? "");
  return `<input data-land-id="${land.id}" data-field="${field}" data-format="${format}" aria-label="${label}" ${format === "money" || format === "area" ? 'inputmode="decimal"' : ""} value="${escapeHtml(shown)}">`;
}

function transferInput(land, field, label, format = "") {
  const raw = land.previousTransfers[0]?.[field];
  const shown = format === "money" ? formatMoney(raw) : (raw ?? "");
  return `<input data-land-id="${land.id}" data-transfer-field="${field}" data-format="${format}" aria-label="${label}" ${field !== "date" ? 'inputmode="decimal"' : ""} ${field === "priceIndex" ? 'placeholder="—"' : ""} value="${escapeHtml(shown)}">`;
}

function renderRows() {
  elements.tableWrap.hidden = transcriptState.lands.length === 0;
  elements.tableEmpty.hidden = transcriptState.lands.length > 0;
  elements.rows.innerHTML = transcriptState.lands.map((land) => `<tr data-land-id="${land.id}">
    <td class="sequence-cell"><output>${escapeHtml(formatSequence(land.rawSequence))}</output></td>
    <td class="district-cell">${input(land, "district", "區")}</td>
    <td class="section-cell">${input(land, "section", "段")}</td>
    <td class="subsection-cell">${input(land, "subsection", "小段")}</td>
    <td>${input(land, "landNumber", "地號", "land-number")}</td>
    <td>${input(land, "area", "面積", "area")}</td>
    <td>${input(land, "owner", "所有權人")}</td>
    <td class="numeric">${input(land, "announcedValue", "公告現值", "money")}</td>
    <td><div class="share-fields">${input(land, "shareNumerator", "持分分子")}<span>/</span>${input(land, "shareDenominator", "持分分母")}</div></td>
    <td class="numeric"><output class="current-value">${formatMoney(land.currentValue)}</output></td>
    <td>${transferInput(land, "date", "前次移轉日期")}</td>
    <td class="numeric">${transferInput(land, "previousValue", "前次移轉現值", "money")}</td>
    <td class="transfer-index">${transferInput(land, "priceIndex", "物價指數")}</td>
    <td class="numeric">${transferInput(land, "selfUseTax", "自用增值稅", "money")}</td>
    <td class="numeric">${transferInput(land, "generalTax", "一般增值稅", "money")}</td>
    <td><div class="table-action"><button class="text-button" data-action="remove-land" data-land-id="${land.id}" type="button">刪除</button></div></td>
  </tr>`).join("");
  elements.total.textContent = formatMoney(calculateTotalLandCurrentValue(transcriptState.lands)) || "0";
  renderValidation();
  renderTranscriptOutput();
  savePageState();
}

function outputReady() {
  return transcriptState.lands.length > 0;
}

function effectiveTranscriptOutputState() {
  if (transcriptState.tryLandTax) return transcriptState;
  return {
    ...transcriptState,
    displayOptions: { ...transcriptState.displayOptions, showSelfUseTax: false, showTaxSummary: false },
    giftTax: { ...transcriptState.giftTax, enabled: false, result: null }
  };
}

function updatePreviewScale() {
  if (elements.previewSection.hidden) return;
  const landscape = transcriptState.displayOptions.orientation === "landscape";
  const width = (landscape ? 297 : 210) * 96 / 25.4;
  const height = (landscape ? 210 : 297) * 96 / 25.4;
  const style = getComputedStyle(elements.reportPreview);
  const available = Math.max(0, elements.reportPreview.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  const scale = Math.min(1, available / width);
  elements.a4Sheet.style.transform = `scale(${scale})`;
  elements.a4Viewport.style.width = `${width * scale}px`;
  elements.a4Viewport.style.height = `${Math.max(height, elements.a4Sheet.scrollHeight) * scale}px`;
}

function renderTranscriptOutput() {
  const ready = outputReady();
  elements.settingsSection.hidden = !ready;
  elements.previewSection.hidden = !ready;
  if (!ready) return;
  transcriptState.totalLandCurrentValue = calculateTotalLandCurrentValue(transcriptState.lands);
  transcriptState.caseCurrentValue = transcriptState.totalLandCurrentValue;
  const totals = calculateTransferTaxTotals(transcriptState.lands);
  if (!transcriptState.giftTax.landValueTaxDeductionOverridden) transcriptState.giftTax.landValueTaxDeduction = totals.generalTax;
  transcriptState.giftTax.result = calculateGiftTax(transcriptState);
  settingsController?.sync();
  const report = renderA4Report(effectiveTranscriptOutputState());
  elements.a4Sheet.innerHTML = report.html;
  elements.a4Sheet.dataset.density = report.density;
  elements.a4Sheet.className = `a4-sheet orientation-${transcriptState.displayOptions.orientation} table-spacing-${transcriptState.displayOptions.tableSpacing} section-spacing-${transcriptState.displayOptions.sectionSpacing} report-font-${transcriptState.displayOptions.fontSize}`;
  document.body.classList.toggle("print-portrait", transcriptState.displayOptions.orientation === "portrait");
  document.body.classList.toggle("print-landscape", transcriptState.displayOptions.orientation === "landscape");
  elements.dynamicPrintPage.textContent = `@page { size: A4 ${transcriptState.displayOptions.orientation}; margin: 8mm; }`;
  elements.reportWarning.textContent = report.warningMessage;
  elements.reportWarning.hidden = !report.warning;
  requestAnimationFrame(updatePreviewScale);
}

function renderFile() {
  if (!transcriptState.file) { elements.fileList.innerHTML = ""; elements.reparse.disabled = true; return; }
  const message = transcriptState.status === "loading" ? "讀取中…" : transcriptState.status === "error" ? transcriptState.error : "已讀取";
  elements.fileList.innerHTML = `<div class="file-row"><span class="file-name">${escapeHtml(transcriptState.file.name)}</span><span class="file-status ${transcriptState.status === "error" ? "is-error" : ""}">${escapeHtml(message)}</span><button id="removeTranscriptFile" class="icon-button" type="button" aria-label="移除檔案">×</button></div>`;
  elements.reparse.disabled = transcriptState.status === "loading";
  document.querySelector("#removeTranscriptFile")?.addEventListener("click", clearTranscript);
}

function renderStatus() {
  elements.status.classList.toggle("is-ready", transcriptState.status === "ready");
  if (transcriptState.status === "loading") elements.status.textContent = "正在讀取謄本必要資料…";
  else if (transcriptState.status === "error") elements.status.textContent = transcriptState.error;
  else if (transcriptState.status === "ready") elements.status.textContent = transcriptState.parseMeta?.pageCount
    ? `✓ 已讀取 ${transcriptState.parseMeta.pageCount} 頁，依所有權資料產生 ${transcriptState.lands.length} 筆土地列。請確認所有權人與目前有效權利狀態。`
    : `✓ 已恢復 ${transcriptState.lands.length} 筆土地資料。原始 PDF 如需重新解析，請再次上傳。`;
  else elements.status.textContent = "尚未上傳謄本 PDF。";
}

function renderCpiFile() {
  const source = transcriptState.cpiSource;
  elements.cpiSourceLink.href = CPI_SOURCE.sourcePage;
  if (source.status === "loading") elements.cpiSourceStatus.textContent = "正在準備物價指數資料…";
  else if (source.status === "ready") elements.cpiSourceStatus.textContent = `✓ 已載入　來源：${source.sourceName}`;
  else if (source.status === "error") elements.cpiSourceStatus.textContent = transcriptState.cpiMessage || "無法載入預設物價指數資料，請手動上傳 Excel。";
  else elements.cpiSourceStatus.textContent = "尚未載入";
  elements.restoreDefaultCpi.hidden = source.type !== "manual";
  if (source.status === "error") elements.cpiAlternatives.open = true;
  if (!transcriptState.cpiFile) {
    elements.cpiFileList.innerHTML = transcriptState.cpiStatus === "error" && source.status !== "error"
      ? `<p class="file-status is-error">${escapeHtml(transcriptState.cpiMessage)}</p>` : "";
    return;
  }
  const message = transcriptState.cpiStatus === "loading" ? "讀取中…" : transcriptState.cpiMessage;
  elements.cpiFileList.innerHTML = `<div class="file-row"><span class="file-name">${escapeHtml(transcriptState.cpiFile.name)}</span><span class="file-status ${transcriptState.cpiStatus === "error" ? "is-error" : ""}">${escapeHtml(message)}</span></div>`;
}

function renderValidation() {
  if (!transcriptState.tryLandTax || !transcriptState.lands.length) { elements.validation.hidden = true; elements.validation.textContent = ""; return; }
  const messages = [];
  transcriptState.lands.forEach((land, index) => {
    const transfer = land.previousTransfers[0];
    const result = transfer?.taxCalculation ?? calculateLandTaxForLand(land);
    const missing = result?.missingLabels ?? ["前次移轉資料"];
    if (missing.length) messages.push(`第 ${index + 1} 列缺少${missing.join("、")}`);
  });
  if (!transcriptState.cpiData) messages.unshift("尚未載入物價指數資料");
  elements.validation.hidden = false;
  elements.validation.textContent = messages.length ? messages.join("；") : "✓ 土地增值稅試算資料完整，已依官方公式計算。";
}

function applyCpiLookup() {
  if (!transcriptState.cpiData) return;
  transcriptState.lands.forEach((land) => {
    const transfer = land.previousTransfers[0];
    const date = normalizeRocMonth(transfer?.date);
    if (transfer.cpiSource === "manual") return;
    transfer.priceIndex = date ? lookupPriceIndex(transcriptState.cpiData, date.rocYear, date.month) : null;
    transfer.cpiSource = "lookup";
    transfer.cpiLookupMissing = transfer.priceIndex === null;
  });
  applyLandTaxCalculations(false);
  renderRows();
}

async function handleCpiFile(file) {
  if (!file || !/\.(?:xls|xlsx)$/i.test(file.name)) {
    transcriptState.cpiStatus = "error";
    transcriptState.cpiMessage = "請上傳 Excel (.xls / .xlsx) 檔案";
    elements.cpiInput.value = ""; renderCpiFile(); renderValidation(); return;
  }
  transcriptState.cpiFile = file;
  transcriptState.cpiStatus = "loading"; transcriptState.cpiMessage = "讀取中…";
  transcriptState.cpiSource = { status: "loading", type: "manual", sourceName: "手動上傳資料", loadedAt: null };
  renderCpiFile();
  try {
    transcriptState.cpiData = await loadCpiWorkbook(file);
    const duplicateMessage = transcriptState.cpiData.duplicates.length ? `；有 ${transcriptState.cpiData.duplicates.length} 個重複年月，已採第一筆` : "";
    transcriptState.cpiStatus = "ready";
    transcriptState.cpiMessage = `✓ 已讀取工作表「${transcriptState.cpiData.sheetName}」${duplicateMessage}`;
    transcriptState.cpiSource = { status: "ready", type: "manual", sourceName: "手動上傳資料", loadedAt: Date.now() };
    renderCpiFile();
    applyCpiLookup();
  } catch (error) {
    transcriptState.cpiData = null;
    transcriptState.cpiStatus = "error";
    transcriptState.cpiMessage = error instanceof Error ? error.message : "物價指數 Excel 讀取失敗。";
    transcriptState.cpiSource = { status: "error", type: "manual", sourceName: "手動上傳資料", loadedAt: null };
    renderCpiFile(); renderValidation();
  }
}

async function loadDefaultCpiData({ force = false } = {}) {
  if (!force && transcriptState.cpiSource.status === "ready") return transcriptState.cpiData;
  if (!force && defaultCpiLoadPromise) return defaultCpiLoadPromise;
  transcriptState.cpiFile = null; transcriptState.cpiData = null; transcriptState.cpiStatus = "loading"; transcriptState.cpiMessage = "";
  transcriptState.cpiSource = { status: "loading", type: null, sourceName: "", loadedAt: null };
  elements.cpiInput.value = ""; renderCpiFile(); renderValidation();
  defaultCpiLoadPromise = loadDefaultCpiSource({ parseWorkbook: loadCpiWorkbook }).then((result) => {
    transcriptState.cpiData = result.data;
    transcriptState.cpiStatus = "ready";
    transcriptState.cpiMessage = "✓ 已載入";
    transcriptState.cpiSource = { status: "ready", type: result.type, sourceName: result.sourceName, loadedAt: Date.now() };
    renderCpiFile(); applyCpiLookup(); savePageState();
    return result.data;
  }).catch((error) => {
    transcriptState.cpiData = null; transcriptState.cpiStatus = "error";
    transcriptState.cpiMessage = error instanceof Error ? error.message : "無法載入預設物價指數資料，請手動上傳 Excel。";
    transcriptState.cpiSource = { status: "error", type: null, sourceName: "", loadedAt: null };
    renderCpiFile(); renderValidation(); savePageState();
    return null;
  }).finally(() => { defaultCpiLoadPromise = null; });
  return defaultCpiLoadPromise;
}

async function processTranscript(file) {
  if (!file || !/\.pdf$/i.test(file.name)) { transcriptState.status = "error"; transcriptState.error = "請選擇 PDF 檔案。"; renderStatus(); return; }
  transcriptState.file = file; transcriptState.status = "loading"; transcriptState.error = ""; renderFile(); renderStatus();
  try {
    const result = await parseTranscriptPdfToLands(file);
    transcriptState.lands = result.lands.map((land) => { const owner = ensureOwner(transcriptState, land.owner); land.ownerId = owner?.id ?? null; land.houseId = null; updateLandCurrentValue(land); return land; });
    transcriptState.parseMeta = result.meta; transcriptState.status = "ready";
    if (transcriptState.cpiData) applyCpiLookup();
  } catch (error) {
    transcriptState.lands = []; transcriptState.parseMeta = {}; transcriptState.status = "error";
    transcriptState.error = error instanceof Error ? error.message : "謄本 PDF 讀取失敗。";
  }
  renderFile(); renderStatus(); renderRows();
}

function clearTranscript() {
  transcriptState.file = null; transcriptState.lands = []; transcriptState.parseMeta = {}; transcriptState.status = "idle"; transcriptState.error = "";
  elements.fileInput.value = ""; renderFile(); renderStatus(); renderRows();
}

elements.fileInput.addEventListener("change", () => processTranscript(elements.fileInput.files?.[0]));
elements.reparse.addEventListener("click", () => processTranscript(transcriptState.file));
elements.enableTax.addEventListener("change", () => {
  transcriptState.tryLandTax = elements.enableTax.checked;
  elements.cpiBlock.hidden = !transcriptState.tryLandTax;
  if (transcriptState.tryLandTax) {
    applyLandTaxCalculations();
    void loadDefaultCpiData();
  }
  else { renderValidation(); renderTranscriptOutput(); savePageState(); }
});
elements.calculationDate.value = transcriptState.calculationDate;
elements.calculationDate.addEventListener("input", () => {
  transcriptState.calculationDate = elements.calculationDate.value;
  applyLandTaxCalculations();
});
elements.cpiInput.addEventListener("change", () => handleCpiFile(elements.cpiInput.files?.[0]));
elements.restoreDefaultCpi.addEventListener("click", () => loadDefaultCpiData({ force: true }));
for (const name of ["dragenter", "dragover"]) elements.uploadZone.addEventListener(name, (event) => { event.preventDefault(); elements.uploadZone.classList.add("is-dragging"); });
for (const name of ["dragleave", "drop"]) elements.uploadZone.addEventListener(name, (event) => { event.preventDefault(); elements.uploadZone.classList.remove("is-dragging"); });
elements.uploadZone.addEventListener("drop", (event) => processTranscript(event.dataTransfer?.files?.[0]));
for (const name of ["dragenter", "dragover"]) elements.cpiZone.addEventListener(name, (event) => { event.preventDefault(); elements.cpiZone.classList.add("is-dragging"); });
for (const name of ["dragleave", "drop"]) elements.cpiZone.addEventListener(name, (event) => { event.preventDefault(); elements.cpiZone.classList.remove("is-dragging"); });
elements.cpiZone.addEventListener("drop", (event) => handleCpiFile(event.dataTransfer?.files?.[0]));

elements.rows.addEventListener("input", (event) => {
  const control = event.target.closest("input[data-land-id]"); if (!control) return;
  const land = transcriptState.lands.find((item) => item.id === control.dataset.landId); if (!land) return;
  const isNumeric = ["money", "area"].includes(control.dataset.format);
  const value = isNumeric ? (control.value.trim() ? parseFormattedNumber(control.value) : null) : control.value;
  if (control.dataset.transferField) {
    land.previousTransfers[0][control.dataset.transferField] = value;
    if (control.dataset.transferField === "priceIndex") land.previousTransfers[0].cpiSource = "manual";
  }
  else land[control.dataset.field] = value;
  updateLandCurrentValue(land);
  control.closest("tr")?.querySelector(".current-value")?.replaceChildren(formatMoney(land.currentValue));
  if (transcriptState.tryLandTax && !["selfUseTax", "generalTax"].includes(control.dataset.transferField)) {
    calculateLandTaxForLand(land);
    const row = control.closest("tr");
    for (const field of ["selfUseTax", "generalTax"]) {
      const taxInput = row?.querySelector(`input[data-transfer-field="${field}"]`);
      if (taxInput) taxInput.value = formatMoney(land.previousTransfers[0][field]);
    }
  }
  elements.total.textContent = formatMoney(calculateTotalLandCurrentValue(transcriptState.lands)) || "0";
  renderValidation();
  renderTranscriptOutput();
  savePageState();
});

elements.rows.addEventListener("focusout", (event) => {
  const control = event.target.closest("input[data-land-id]"); if (!control) return;
  if (control.dataset.format === "money") control.value = control.value.trim() ? formatMoney(control.value) : "";
  if (control.dataset.format === "area") control.value = control.value.trim() ? formatArea(parseFormattedNumber(control.value)) : "";
  if (control.dataset.format === "land-number") control.value = formatLandNumber(control.value);
  if (control.dataset.transferField === "date" && transcriptState.cpiData) applyCpiLookup();
});

elements.rows.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="remove-land"]'); if (!button) return;
  transcriptState.lands = transcriptState.lands.filter((land) => land.id !== button.dataset.landId); renderRows();
});

settingsController = createReportSettings({ container: elements.settings, state: transcriptState, onChange: () => { renderTranscriptOutput(); savePageState(); } });
elements.clearPageState.addEventListener("click", () => {
  if (!window.confirm("確定清除謄本整理頁目前資料？其他功能頁不受影響。")) return;
  clearingPageState = true;
  clearSessionState(TRANSCRIPT_STORAGE_KEY);
  location.reload();
});
window.addEventListener("pagehide", savePageState);
elements.printReport.addEventListener("click", () => { document.title = `${transcriptState.caseName}_謄本稅費試算`; window.print(); });
elements.downloadExcel.addEventListener("click", async () => {
  const original = elements.downloadExcel.textContent; elements.downloadExcel.disabled = true; elements.downloadExcel.textContent = "產生中…";
  try {
    const outputState = effectiveTranscriptOutputState();
    await exportExcel(outputState, calculateTransferTaxTotals(outputState.lands));
  }
  catch (error) { window.alert(error.message || "Excel 產生失敗，請稍後再試。"); }
  finally { elements.downloadExcel.disabled = false; elements.downloadExcel.textContent = original; }
});
new ResizeObserver(updatePreviewScale).observe(elements.reportPreview);
elements.enableTax.checked = transcriptState.tryLandTax;
elements.cpiBlock.hidden = !transcriptState.tryLandTax;
elements.calculationDate.value = transcriptState.calculationDate;
renderFile();
renderStatus();
renderCpiFile();
renderRows();
if (transcriptState.tryLandTax) void loadDefaultCpiData();
