import { createEmptyLand, createId, LAND_TAX_STORAGE_KEY, state } from "./state.js";
import { clearSessionState, saveSessionState } from "./session-state.js";
import { parseLandTaxPdfDetailed } from "./pdf-parser.js?v=20260902-1";
import { renderFiles, renderLandTable } from "./report-renderer.js?v=20260820-2";
import { formatArea, formatLandNumber, formatMoney, parseFormattedNumber } from "./formatters.js?v=20260819-25";
import { calculateCaseCurrentValue, calculateGiftTax, calculateHouseCurrentValue, calculateHouseOwnerDeedTax, calculateLandCurrentValue, calculateTotalDeedTax, calculateTotalHouseCurrentValue, calculateTotalLandCurrentValue, calculateTransferTaxTotals } from "./calculations.js";
import { renderA4Report } from "./a4-report-renderer.js?v=20260819-25";
import { exportExcel } from "./excel-export.js?v=20260819-26";
import { createReportSettings } from "./report-settings.js";
import { createHouse, ensureOwner, hasEffectiveHouseData, houseLabel, ownerName } from "./relationships.js";
import { orderLandsByDocuments, sortDocumentsByLand } from "./document-order.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  caseName: $("#caseName"), owner: $("#owner"), addOwner: $("#addOwner"), ownerList: $("#ownerList"),
  addHouse: $("#addHouse"), houseList: $("#houseList"), houseCount: $("#houseCount"),
  pdfFiles: $("#pdfFiles"), uploadZone: $("#uploadZone"),
  fileList: $("#fileList"), reparseFiles: $("#reparseFiles"), sortFilesByLand: $("#sortFilesByLand"), addLand: $("#addLand"),
  landRows: $("#landRows"), tableWrap: $("#tableWrap"), tableEmpty: $("#tableEmpty"),
  totalLandCurrentValue: $("#totalLandCurrentValue"), summaryHouseCurrentValue: $("#summaryHouseCurrentValue"),
  caseCurrentValue: $("#caseCurrentValue"), deedTax: $("#deedTax"),
  reportSettings: $("#reportSettings"), downloadExcel: $("#downloadExcel"), printReport: $("#printReport"), clearPageState: $("#clearPageState"), a4Sheet: $("#a4Sheet"),
  reportPreview: $("#reportPreview"), a4PreviewViewport: $("#a4PreviewViewport"),
  reportOverflowWarning: $("#reportOverflowWarning"), dynamicPrintPage: $("#dynamicPrintPage")
};

const numericFields = new Set(["area", "announcedValue", "shareNumerator", "shareDenominator"]);
const parseNumber = parseFormattedNumber;
const landCalculationFields = new Set(["area", "announcedValue", "shareNumerator", "shareDenominator"]);
let settingsController;
let clearingPageState = false;
let restoredManualLandPrefix = [];

function savePageState() {
  if (clearingPageState) return;
  const { files, ...snapshot } = state;
  saveSessionState(LAND_TAX_STORAGE_KEY, snapshot);
}

function renderPreview() {
  const report = renderA4Report(state);
  elements.a4Sheet.innerHTML = report.html;
  elements.a4Sheet.dataset.density = report.density;
  elements.a4Sheet.classList.toggle("orientation-portrait", state.displayOptions.orientation === "portrait");
  elements.a4Sheet.classList.toggle("orientation-landscape", state.displayOptions.orientation === "landscape");
  elements.a4Sheet.classList.remove("table-spacing-compact", "table-spacing-standard", "table-spacing-relaxed");
  elements.a4Sheet.classList.add(`table-spacing-${state.displayOptions.tableSpacing}`);
  elements.a4Sheet.classList.remove("section-spacing-compact", "section-spacing-standard", "section-spacing-relaxed");
  elements.a4Sheet.classList.add(`section-spacing-${state.displayOptions.sectionSpacing}`);
  elements.a4Sheet.classList.remove("report-font-small", "report-font-medium", "report-font-large");
  elements.a4Sheet.classList.add(`report-font-${state.displayOptions.fontSize}`);
  document.body.classList.toggle("print-portrait", state.displayOptions.orientation === "portrait");
  document.body.classList.toggle("print-landscape", state.displayOptions.orientation === "landscape");
  elements.dynamicPrintPage.textContent = `@page { size: A4 ${state.displayOptions.orientation}; margin: 8mm; }`;
  elements.reportOverflowWarning.textContent = report.warningMessage;
  elements.reportOverflowWarning.hidden = !report.warning;
  requestAnimationFrame(() => {
    updatePreviewScale();
    updateOverflowWarning(report.warning);
  });
}

function updateOverflowWarning(dataWarning = false) {
  const isLandscape = state.displayOptions.orientation === "landscape";
  const nominalHeight = (isLandscape ? 210 : 297) * 96 / 25.4;
  const sheetStyle = getComputedStyle(elements.a4Sheet);
  const verticalPadding = parseFloat(sheetStyle.paddingTop) + parseFloat(sheetStyle.paddingBottom);
  const reportHeight = elements.a4Sheet.querySelector(".report-document")?.scrollHeight || 0;
  elements.reportOverflowWarning.hidden = !(dataWarning || reportHeight > nominalHeight - verticalPadding + 1);
}

function recalculateSummary() {
  state.totalLandCurrentValue = calculateTotalLandCurrentValue(state.lands);
  state.houses.forEach((house) => { house.currentValue = calculateHouseCurrentValue(house); const count = Math.max(1, house.ownerIds?.length ?? 0); house.deedTax = Array.from({ length: count }, (_, index) => calculateHouseOwnerDeedTax(house, index)).reduce((sum, tax) => sum + tax, 0); });
  state.house = state.houses[0] ?? state.house;
  const totalHouseValue = calculateTotalHouseCurrentValue(state.houses);
  const totalDeedTax = calculateTotalDeedTax(state.houses);
  state.caseCurrentValue = calculateCaseCurrentValue(state.lands, state.houses);
  const transferTotals = calculateTransferTaxTotals(state.lands);
  if (!state.giftTax.landValueTaxDeductionOverridden) state.giftTax.landValueTaxDeduction = transferTotals.generalTax;
  if (!state.giftTax.deedTaxDeductionOverridden) state.giftTax.deedTaxDeduction = totalDeedTax;
  state.giftTax.result = calculateGiftTax(state);
  elements.totalLandCurrentValue.textContent = formatMoney(state.totalLandCurrentValue);
  elements.summaryHouseCurrentValue.textContent = formatMoney(totalHouseValue);
  elements.caseCurrentValue.textContent = formatMoney(state.caseCurrentValue);
  elements.deedTax.textContent = formatMoney(totalDeedTax);
  elements.deedTax.closest("div").hidden = !hasEffectiveHouseData(state);
  syncGiftTaxFields();
  renderPreview();
  savePageState();
}

function syncGiftTaxFields() {
  settingsController?.sync();
}

function ownerOptions(selectedId) {
  return `<option value="">未指定</option>${state.owners.map((owner) => `<option value="${owner.id}"${owner.id === selectedId ? " selected" : ""}>${owner.name || "（未命名）"}</option>`).join("")}`;
}

function renderOwners() {
  elements.ownerList.innerHTML = state.owners.map((owner) => `<span class="owner-chip">${owner.name || "（未命名）"}<button data-remove-owner="${owner.id}" type="button" aria-label="刪除 ${owner.name}">×</button></span>`).join("");
}

function renderHouses() {
  elements.houseCount.textContent = state.houses.length;
  elements.houseList.innerHTML = state.houses.map((house, index) => `<details class="house-item" data-house-id="${house.id}"${index === 0 ? " open" : ""}>
    <summary>${houseLabel(house, index)}</summary><div class="house-fields">
      <label class="field house-address-field"><span>房屋座落</span><input data-house-field="address" value="${String(house.address ?? "").replaceAll('"', '&quot;')}" placeholder="例如：台北市大同區延平北路…"></label>
      <label class="field"><span>房屋評定現值</span><input data-house-field="assessedValue" data-format="money" inputmode="numeric" value="${formatMoney(house.assessedValue)}"></label>
      <div class="field"><span>房屋持分</span><div class="house-share-control"><input data-house-field="shareNumerator" inputmode="numeric" value="${house.shareNumerator}"><span>/</span><input data-house-field="shareDenominator" inputmode="numeric" value="${house.shareDenominator}"></div></div>
      <fieldset class="field house-owner-field"><legend>所有權人（每人持分相同）</legend><div class="house-owner-options">${state.owners.map((owner) => `<label class="check-option"><input data-house-owner-id="${owner.id}" type="checkbox"${house.ownerIds?.includes(owner.id) ? " checked" : ""}><span>${owner.name || "（未命名）"}</span></label>`).join("") || '<span class="relationship-warning">請先新增所有權人</span>'}</div></fieldset>
      <div class="house-actions"><p class="relationship-warning" data-house-warning></p><button class="text-button" data-remove-house="${house.id}" type="button">刪除房屋</button></div>
    </div></details>`).join("");
  renderRelationshipWarnings();
}

function renderRelationshipWarnings() {
  for (const house of state.houses) {
    const mismatch = state.lands.some((land) => land.houseId === house.id && land.ownerId && !house.ownerIds?.includes(land.ownerId));
    const denominator = Number(house.shareDenominator); const totalShare = denominator ? (Number(house.shareNumerator) / denominator) * (house.ownerIds?.length ?? 0) : 0;
    const warning = elements.houseList.querySelector(`[data-house-id="${house.id}"] [data-house-warning]`);
    if (warning) warning.textContent = [mismatch ? "此土地所有權人不在所選房屋所有權人中，請確認。" : "", totalShare > 1 ? "房屋所有權人持分合計超過 1，請確認。" : ""].filter(Boolean).join(" ");
  }
}

function recalculateLand(land, row = null) {
  land.currentValue = calculateLandCurrentValue(land);
  const output = row?.querySelector("[data-current-value]");
  if (output) output.textContent = formatMoney(land.currentValue);
  recalculateSummary();
}

function refresh() {
  renderOwners();
  renderHouses();
  renderFiles(elements.fileList);
  renderLandTable(elements.landRows, elements.tableWrap, elements.tableEmpty);
  elements.reparseFiles.disabled = state.files.length === 0;
  elements.sortFilesByLand.disabled = state.files.length < 2;
  recalculateSummary();
}

function applyCurrentDocumentOrder(mode = state.documentOrderMode) {
  if (mode === "auto") state.files = sortDocumentsByLand(state.files, state.lands);
  state.lands = orderLandsByDocuments(state.lands, state.files);
  state.documentOrderMode = mode;
}

function addFiles(files) {
  const pdfs = [...files].filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  if (state.documentOrderMode === "manual" && state.files.length === 0 && state.lands.length) restoredManualLandPrefix = state.lands.map((land) => land.id);
  for (const file of pdfs) state.files.push({ id: createId(), file, status: "queued", message: "等待讀取" });
  refresh();
  parseAll("queued");
}

function droppedFiles(dataTransfer) {
  const itemFiles = [...(dataTransfer?.items || [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
  return itemFiles.length ? itemFiles : [...(dataTransfer?.files || [])];
}

async function parseEntry(entry) {
  entry.status = "reading"; entry.message = "讀取中…"; renderFiles(elements.fileList);
  state.lands = state.lands.filter((land) => land.sourceFileId !== entry.id);
  try {
    const parsedResult = await parseLandTaxPdfDetailed(entry.file);
    const lands = parsedResult.lands;
    for (const parsed of lands) {
      const parsedOwner = ensureOwner(state, parsed.owner || state.owner);
      const land = createEmptyLand({ ...parsed, owner: parsedOwner?.name || "", ownerId: parsedOwner?.id || state.owners[0]?.id || null, sourceFileId: entry.id });
      land.currentValue = calculateLandCurrentValue(land);
      state.lands.push(land);
    }
    entry.status = "success";
    entry.message = parsedResult.meta.missingFields.length
      ? `✓ 已讀取 ${lands.length} 筆，部分欄位需確認`
      : `✓ 已讀取 ${lands.length} 筆`;
  } catch (error) {
    entry.status = "error"; entry.message = error.message || "此 PDF 無法自動辨識，請手動輸入資料。";
  }
  refresh();
}

async function parseAll(filterStatus = null) {
  for (const entry of state.files) if (!filterStatus || entry.status === filterStatus) await parseEntry(entry);
  applyCurrentDocumentOrder();
  if (restoredManualLandPrefix.length) {
    const prefixIds = new Set(restoredManualLandPrefix);
    state.lands = [...restoredManualLandPrefix.map((id) => state.lands.find((land) => land.id === id)).filter(Boolean), ...state.lands.filter((land) => !prefixIds.has(land.id))];
    restoredManualLandPrefix = [];
  }
  refresh();
}

elements.pdfFiles.addEventListener("change", (event) => { addFiles(event.target.files); event.target.value = ""; });
let uploadDragDepth = 0;

elements.uploadZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  uploadDragDepth += 1;
  elements.uploadZone.classList.add("is-dragging");
});
elements.uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  elements.uploadZone.classList.add("is-dragging");
});
elements.uploadZone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  uploadDragDepth = Math.max(0, uploadDragDepth - 1);
  if (uploadDragDepth === 0) elements.uploadZone.classList.remove("is-dragging");
});
elements.uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadDragDepth = 0;
  elements.uploadZone.classList.remove("is-dragging");
  addFiles(droppedFiles(event.dataTransfer));
});

for (const eventName of ["dragover", "drop"]) {
  document.addEventListener(eventName, (event) => {
    if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault();
  });
}
elements.reparseFiles.addEventListener("click", () => parseAll());
elements.sortFilesByLand.addEventListener("click", () => { applyCurrentDocumentOrder("auto"); refresh(); });
elements.addLand.addEventListener("click", () => { state.lands.push(createEmptyLand()); refresh(); });

function commitFileOrder(fileIds) {
  const byId = new Map(state.files.map((entry) => [entry.id, entry]));
  state.files = fileIds.map((id) => byId.get(id)).filter(Boolean);
  applyCurrentDocumentOrder("manual");
  refresh();
}

let fileDrag = null;
elements.fileList.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".file-drag-handle");
  const row = handle?.closest("[data-file-id]");
  if (!handle || !row || state.files.length < 2) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  fileDrag = { pointerId: event.pointerId, row };
  row.classList.add("is-dragging");
  elements.fileList.classList.add("is-sorting");
});
elements.fileList.addEventListener("pointermove", (event) => {
  if (!fileDrag || event.pointerId !== fileDrag.pointerId) return;
  event.preventDefault();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-file-id]");
  elements.fileList.querySelectorAll(".is-drop-target").forEach((row) => row.classList.remove("is-drop-target"));
  if (!target || target === fileDrag.row || target.parentElement !== elements.fileList) return;
  target.classList.add("is-drop-target");
  const box = target.getBoundingClientRect();
  elements.fileList.insertBefore(fileDrag.row, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
});
function finishFileDrag(event, commit = true) {
  if (!fileDrag || event.pointerId !== fileDrag.pointerId) return;
  const ids = [...elements.fileList.querySelectorAll("[data-file-id]")].map((row) => row.dataset.fileId);
  fileDrag.row.classList.remove("is-dragging");
  elements.fileList.classList.remove("is-sorting");
  elements.fileList.querySelectorAll(".is-drop-target").forEach((row) => row.classList.remove("is-drop-target"));
  fileDrag = null;
  if (commit) commitFileOrder(ids); else renderFiles(elements.fileList);
}
elements.fileList.addEventListener("pointerup", (event) => finishFileDrag(event));
elements.fileList.addEventListener("pointercancel", (event) => finishFileDrag(event, false));
elements.fileList.addEventListener("keydown", (event) => {
  if (!event.target.matches(".file-drag-handle") || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const row = event.target.closest("[data-file-id]"); const sibling = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  elements.fileList.insertBefore(row, event.key === "ArrowUp" ? sibling : sibling.nextSibling);
  commitFileOrder([...elements.fileList.querySelectorAll("[data-file-id]")].map((item) => item.dataset.fileId));
  elements.fileList.querySelector(`[data-file-id="${row.dataset.fileId}"] .file-drag-handle`)?.focus();
});

elements.fileList.addEventListener("click", (event) => {
  if (!event.target.matches('[data-action="remove-file"]')) return;
  const id = event.target.closest("[data-file-id]").dataset.fileId;
  state.files = state.files.filter((entry) => entry.id !== id);
  state.lands = state.lands.filter((land) => land.sourceFileId !== id);
  refresh();
});

elements.landRows.addEventListener("input", (event) => {
  const row = event.target.closest("[data-land-id]");
  const land = state.lands.find((item) => item.id === row?.dataset.landId);
  if (!land) return;
  if (event.target.dataset.field) {
    const field = event.target.dataset.field;
    land[field] = numericFields.has(field) ? parseNumber(event.target.value) : (field === "houseId" ? event.target.value || null : event.target.value);
    if (field === "ownerId") land.owner = ownerName(state, land.ownerId);
    if (landCalculationFields.has(field)) recalculateLand(land, row);
    else { renderRelationshipWarnings(); recalculateSummary(); }
  }
  if (event.target.dataset.transfer) {
    const index = Number(event.target.dataset.transferIndex);
    const field = event.target.dataset.transfer;
    land.previousTransfers[index][field] = field === "date" ? event.target.value : parseNumber(event.target.value);
    renderPreview();
  }
  savePageState();
});

elements.landRows.addEventListener("focusin", (event) => {
  if (event.target.dataset.format) event.target.value = event.target.value.replaceAll(",", "");
});

elements.landRows.addEventListener("focusout", (event) => {
  if (event.target.dataset.format === "money") event.target.value = formatMoney(parseNumber(event.target.value));
  if (event.target.dataset.format === "area") event.target.value = formatArea(parseNumber(event.target.value));
  if (event.target.dataset.format === "land-number") event.target.value = formatLandNumber(event.target.value);
});

elements.landRows.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  const row = event.target.closest("[data-land-id]");
  const land = state.lands.find((item) => item.id === row?.dataset.landId);
  if (!land) return;
  if (action === "remove-land") state.lands = state.lands.filter((item) => item.id !== land.id);
  refresh();
});

elements.caseName.addEventListener("input", () => { state.caseName = elements.caseName.value; renderPreview(); savePageState(); });
function addOwnerFromInput() {
  const owner = ensureOwner(state, elements.owner.value); if (!owner) return;
  state.owner = owner.name; elements.owner.value = ""; refresh();
}
elements.addOwner.addEventListener("click", addOwnerFromInput);
elements.owner.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addOwnerFromInput(); } });
elements.ownerList.addEventListener("click", (event) => {
  const id = event.target.dataset.removeOwner; if (!id) return;
  if (state.lands.some((land) => land.ownerId === id) || state.houses.some((house) => house.ownerIds?.includes(id))) { window.alert("仍有土地或房屋使用此所有權人，請先重新指定。"); return; }
  state.owners = state.owners.filter((owner) => owner.id !== id); refresh();
});
elements.addHouse.addEventListener("click", () => { const ownerId = state.owners[0]?.id ?? null; state.houses.push(createHouse({ ownerId, ownerIds: ownerId ? [ownerId] : [] })); refresh(); });
elements.houseList.addEventListener("input", (event) => {
  const container = event.target.closest("[data-house-id]"); const house = state.houses.find((item) => item.id === container?.dataset.houseId); if (!house) return;
  if (event.target.dataset.houseOwnerId) {
    house.ownerIds = [...container.querySelectorAll("[data-house-owner-id]:checked")].map((input) => input.dataset.houseOwnerId);
    house.ownerId = house.ownerIds[0] ?? null; recalculateSummary(); renderRelationshipWarnings(); return;
  }
  const field = event.target.dataset.houseField; if (!field) return;
  house[field] = ["assessedValue", "shareNumerator", "shareDenominator"].includes(field) ? parseNumber(event.target.value) : (field === "ownerId" ? event.target.value || null : event.target.value);
  recalculateSummary(); renderRelationshipWarnings();
});
elements.houseList.addEventListener("focusout", (event) => { if (event.target.dataset.format === "money") event.target.value = formatMoney(parseNumber(event.target.value)); });
elements.houseList.addEventListener("click", (event) => {
  const id = event.target.dataset.removeHouse; if (!id) return;
  const affected = state.lands.some((land) => land.houseId === id);
  state.houses = state.houses.filter((house) => house.id !== id);
  state.lands.forEach((land) => { if (land.houseId === id) land.houseId = null; });
  refresh(); if (affected) window.alert("原對應土地已改為無房屋。");
});

settingsController = createReportSettings({ container: elements.reportSettings, state, onChange: () => { renderPreview(); savePageState(); } });

elements.clearPageState.addEventListener("click", () => {
  if (!window.confirm("確定清除土地增值稅試算頁目前資料？其他功能頁不受影響。")) return;
  clearingPageState = true;
  clearSessionState(LAND_TAX_STORAGE_KEY);
  location.reload();
});
window.addEventListener("pagehide", savePageState);

elements.printReport.addEventListener("click", () => {
  document.title = `${(state.caseName || "土地及房屋") .replace(/[\\/:*?"<>|]/g, "_")}_稅費試算`;
  window.print();
});

elements.downloadExcel.addEventListener("click", async () => {
  const originalText = elements.downloadExcel.textContent;
  elements.downloadExcel.disabled = true;
  elements.downloadExcel.textContent = "產生中…";
  try {
    await exportExcel(state, calculateTransferTaxTotals(state.lands));
  } catch (error) {
    window.alert(error.message || "Excel 產生失敗，請稍後再試。");
  } finally {
    elements.downloadExcel.disabled = false;
    elements.downloadExcel.textContent = originalText;
  }
});

function updatePreviewScale() {
  const isLandscape = state.displayOptions.orientation === "landscape";
  const a4Width = (isLandscape ? 297 : 210) * 96 / 25.4;
  const a4Height = (isLandscape ? 210 : 297) * 96 / 25.4;
  const previewStyle = getComputedStyle(elements.reportPreview);
  const horizontalPadding = parseFloat(previewStyle.paddingLeft) + parseFloat(previewStyle.paddingRight);
  const availableWidth = Math.max(0, elements.reportPreview.clientWidth - horizontalPadding);
  const scale = Math.min(1, availableWidth / a4Width);
  const renderedHeight = Math.max(a4Height, elements.a4Sheet.scrollHeight);
  elements.a4Sheet.style.transform = `scale(${scale})`;
  elements.a4PreviewViewport.style.width = `${a4Width * scale}px`;
  elements.a4PreviewViewport.style.height = `${renderedHeight * scale}px`;
}

new ResizeObserver(updatePreviewScale).observe(elements.reportPreview);

elements.caseName.value = state.caseName;
refresh();
updatePreviewScale();
