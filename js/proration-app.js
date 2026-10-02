import { setupCaseFileActions } from "./case-file.js";
import { clearSessionState, loadSessionState, saveSessionState } from "./session-state.js";
import { formatMoney, parseFormattedNumber } from "./formatters.js";
import { calculateCombinedSettlement, calculateHouseTax, calculateLandTax, settlementText } from "./proration-calculations.js?v=20261001-1";
import { renderProrationReport } from "./proration-report.js?v=20261002-1";
import { exportProrationExcel } from "./proration-excel.js?v=20261001-1";
import { normalizeProrationState } from "./proration-state.js?v=20261001-1";

const STORAGE_KEY = "landTool.prorationState";
const createId = () => globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const $ = (selector) => document.querySelector(selector);
let state = normalizeProrationState(loadSessionState(STORAGE_KEY));
let clearing = false;
let validationRequested = false;

export function serializeProrationCase() { return structuredClone(state); }
export function restoreProrationCase(snapshot) { state = normalizeProrationState(snapshot); validationRequested = false; syncInputs(); renderNotes(); refresh(); }
function save() { if (!clearing) saveSessionState(STORAGE_KEY, state); }
function results() { const house = calculateHouseTax(state.customer.houseTax); const land = calculateLandTax(state.customer.landTax); return { house, land, total: calculateCombinedSettlement(house, land) }; }
const moneyText = (value) => value === null || value === undefined ? "—" : `$${formatMoney(value)}`;
const dateText = (value) => value ? value.replaceAll("-", "/") : "—";
const periodText = (start, end, days) => days > 0 ? `${dateText(start)} ～ ${dateText(end)}` : "—";

function renderBasis(reportResults) {
  const landSection = $('[data-tax-section="landTax"]');
  landSection.querySelector('[data-result="taxableLandValue"]').textContent = moneyText(reportResults.land.taxableLandValue);
  landSection.querySelector('[data-result="taxAmount"]').textContent = moneyText(reportResults.land.taxAmount);
  landSection.querySelector('[data-result="taxableLandValue"] + small').textContent = reportResults.land.amountSource === "legacy" ? "舊版案件未包含計算依據" : "課稅地價";
}

function resultDetails(result) {
  if (!result.valid) return '<p class="settings-description">資料完整後顯示分算期間與金額。</p>';
  return `<div class="calculation-summary proration-period-summary"><div><span>天數</span><strong>${result.prorationDays} / ${result.totalTaxDays}</strong><small>找補天數 / 總課稅天數</small></div><div><span>本次找補期間</span><strong>${periodText(result.prorationStartDate, result.prorationEndDate, result.prorationDays)}</strong><small>共 ${result.prorationDays} 天</small></div><div><span>計算</span><strong>${moneyText(result.amount)} × ${result.prorationDays} / ${result.totalTaxDays}</strong><small>本次找補稅額　${moneyText(result.prorationAmount)}</small></div></div><p class="settings-description proration-paid-by">本筆稅款已由：${result.payer === "buyer" ? state.customer.buyer || "買方" : state.shared.seller || "賣方"}支付</p>`;
}

function renderResultCard(kind, result) {
  const card = $(`[data-result-card="${kind}"]`);
  card.querySelector('[data-result="taxAmount"]').textContent = result.valid ? moneyText(result.amount) : "—";
  card.querySelector('[data-result="details"]').innerHTML = resultDetails(result);
  card.querySelector('[data-result="settlement"]').textContent = result.valid ? settlementText(result.settlement, state.customer.buyer, state.shared.seller) : "—";
}

function renderValidation(reportResults) {
  document.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
  for (const [key, result] of [["houseTax", reportResults.house], ["landTax", reportResults.land]]) {
    const section = $(`[data-tax-section="${key}"]`);
    const message = section.querySelector('[data-result="error"]');
    message.textContent = result.errors.join(" ");
    message.hidden = !validationRequested || result.valid;
    if (validationRequested) for (const field of Object.keys(result.fieldErrors ?? {})) {
      const input = field === "splitDate" ? $('[data-shared-field="handoverDate"]') : section.querySelector(`[data-tax-field="${field}"]`);
      input?.setAttribute("aria-invalid", "true");
    }
  }
  const allErrors = [...new Set([...reportResults.house.errors, ...reportResults.land.errors])];
  const globalError = $("#calculationError"); globalError.textContent = allErrors.join(" "); globalError.hidden = !validationRequested || !allErrors.length;
}

function updatePreview(reportResults) { $("#a4Sheet").innerHTML = renderProrationReport(state, reportResults); requestAnimationFrame(updatePreviewScale); }
function refresh() {
  const value = results(); renderBasis(value); renderResultCard("house", value.house); renderResultCard("land", value.land);
  $('[data-final="house"]').textContent = value.house.valid ? settlementText(value.house.settlement, state.customer.buyer, state.shared.seller) : "—";
  $('[data-final="land"]').textContent = value.land.valid ? settlementText(value.land.settlement, state.customer.buyer, state.shared.seller) : "—";
  $('[data-final="total"]').textContent = value.house.valid && value.land.valid ? settlementText(value.total, state.customer.buyer, state.shared.seller) : "—";
  renderValidation(value); updatePreview(value); save(); return value;
}

function syncInputs() {
  document.querySelectorAll("[data-shared-field]").forEach((input) => { input.value = state.shared[input.dataset.sharedField] ?? ""; });
  document.querySelectorAll("[data-customer-field]").forEach((input) => { input.value = state.customer[input.dataset.customerField] ?? ""; });
  document.querySelectorAll("[data-tax-section]").forEach((section) => { const tax = state.customer[section.dataset.taxSection]; section.querySelectorAll("[data-tax-field]").forEach((input) => { const value = tax[input.dataset.taxField] ?? ""; input.value = input.matches("[data-money-field]") && value !== "" ? formatMoney(value) : value; }); });
}

function renderNotes() {
  $("#notesList").innerHTML = state.shared.notes.map((note, index) => `<article class="custom-note-item" data-note-id="${note.id}"><label class="field"><span>其他備註 ${index + 1}</span><textarea rows="3" data-note-content>${String(note.content).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char])}</textarea></label><div class="custom-note-actions"><button class="text-button" data-remove-note type="button">刪除</button></div></article>`).join("");
}

document.addEventListener("input", (event) => {
  if (event.target.dataset.sharedField) { state.shared[event.target.dataset.sharedField] = event.target.value; refresh(); return; }
  if (event.target.dataset.customerField) { state.customer[event.target.dataset.customerField] = event.target.value; refresh(); return; }
  const section = event.target.closest("[data-tax-section]"); const field = event.target.dataset.taxField;
  if (section && field) {
    const tax = state.customer[section.dataset.taxSection];
    tax[field] = event.target.matches("[data-money-field]") ? (event.target.value.trim() ? parseFormattedNumber(event.target.value) : "") : event.target.value;
    if (section.dataset.taxSection === "landTax" && ["declaredLandValue", "area", "shareNumerator", "shareDenominator"].includes(field)) tax.legacyAmount = "";
    refresh(); return;
  }
  const noteItem = event.target.closest("[data-note-id]"); if (noteItem && event.target.matches("[data-note-content]")) { const note = state.shared.notes.find((item) => item.id === noteItem.dataset.noteId); if (note) note.content = event.target.value; refresh(); }
});
document.addEventListener("focusin", (event) => { if (event.target.matches("[data-money-field]")) event.target.value = event.target.value.replaceAll(",", ""); });
document.addEventListener("focusout", (event) => { if (event.target.matches("[data-money-field]")) event.target.value = event.target.value.trim() ? formatMoney(parseFormattedNumber(event.target.value)) : ""; });
$("#calculateProration").addEventListener("click", () => { validationRequested = true; const value = refresh(); if (value.house.valid && value.land.valid) $("#calculationResults").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("#addNote").addEventListener("click", () => { state.shared.notes.push({ id: createId(), content: "" }); renderNotes(); save(); $("#notesList article:last-child textarea")?.focus(); });
$("#notesList").addEventListener("click", (event) => { if (!event.target.matches("[data-remove-note]")) return; const item = event.target.closest("[data-note-id]"); const note = state.shared.notes.find((entry) => entry.id === item.dataset.noteId); if (note?.content && !window.confirm("確定刪除此備註？")) return; state.shared.notes = state.shared.notes.filter((entry) => entry.id !== item.dataset.noteId); renderNotes(); refresh(); });

setupCaseFileActions({ pageType: "tax-proration", label: "地價稅房屋稅分算找補", saveButton: $("#saveCase"), importButton: $("#importCase"), serialize: serializeProrationCase, restore: restoreProrationCase, hasData: () => Boolean(state.customer.buyer || state.shared.seller || state.shared.handoverDate || state.customer.houseTax.amount !== "" || state.customer.landTax.declaredLandValue !== "" || state.shared.notes.length), caseName: () => state.shared.caseName });
$("#clearPageState").addEventListener("click", () => { if (!window.confirm("確定清除分算找補頁目前資料？其他功能頁不受影響。")) return; clearing = true; clearSessionState(STORAGE_KEY); location.reload(); });
$("#printReport").addEventListener("click", () => { document.title = `${(state.shared.caseName || "地價稅房屋稅分算找補").replace(/[\\/:*?"<>|]/g, "_")}_分算找補`; window.print(); });
$("#downloadExcel").addEventListener("click", async () => { const button = $("#downloadExcel"); const label = button.textContent; button.disabled = true; button.textContent = "產生中…"; try { await exportProrationExcel(state, results()); } catch (error) { window.alert(error.message || "Excel 產生失敗，請稍後再試。"); } finally { button.disabled = false; button.textContent = label; } });
function updatePreviewScale() { const sheet = $("#a4Sheet"); const preview = $("#reportPreview"); const viewport = $("#a4PreviewViewport"); const width = 210 * 96 / 25.4; const height = 297 * 96 / 25.4; const style = getComputedStyle(preview); const available = Math.max(0, preview.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)); const scale = Math.min(1, available / width); sheet.style.transform = `scale(${scale})`; viewport.style.width = `${width * scale}px`; viewport.style.height = `${Math.max(height, sheet.scrollHeight) * scale}px`; }
new ResizeObserver(updatePreviewScale).observe($("#reportPreview")); window.addEventListener("pagehide", save); syncInputs(); renderNotes(); refresh();
