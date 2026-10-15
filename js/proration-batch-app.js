import { BATCH_FIELDS, getField } from "./proration-batch-state.js";
import { isBlank, normalizeInput } from "./proration-input-normalization.js";
import { settlementText } from "./proration-calculations.js?v=20261001-1";
import { formatRocDate } from "./proration-report.js?v=20261015-1";
import { readBatchExcel, downloadBatchTemplate } from "./proration-batch-excel.js";
import { COMMON_FIELDS, createBatchWorkspace } from "./proration-batch-workspace.js";
import { buildBatchCaseFile, parseBatchCaseFile, batchCaseFilename } from "./proration-batch-case-file.js";
import { downloadCaseFile, sanitizeFilename } from "./case-file.js";
import { prepareBatchPrint } from "./proration-batch-print.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const label = (field) => field.label.replace("（選填）", "");
const issueText = (issue) => {
  const field = BATCH_FIELDS.find((item) => item.path === issue.path);
  const title = field ? label(field) : issue.path === "selected" ? "是否輸出" : "";
  return title ? `${title}：${issue.message}` : issue.message;
};
function rawText(value, field, source = {}) {
  if (isBlank(value)) return "";
  if (field.type === "date" && (value instanceof Date || typeof value === "number")) {
    try { return normalizeInput(value, "date", source).value; } catch { /* Keep invalid input visible. */ }
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function displayValue(value, field, source) {
  if (isBlank(value)) return "未填";
  try {
    const normalized = normalizeInput(value, field.type, source).value;
    return field.type === "payer" ? normalized === "buyer" ? "買方" : "賣方" : String(normalized);
  } catch { return `${rawText(value, field, source)}（格式需修正）`; }
}
function fieldMarkup(field, value, scope, source) {
  const text = rawText(value, field, source), id = `batch-${scope}-${field.path.replaceAll(".", "-")}`;
  const attr = `id="${id}" data-batch-${scope}="${field.path}"${scope === "individual" ? ` aria-describedby="${id}-hint"` : ""}`;
  let control;
  if (field.type === "payer") {
    let selected = text;
    try { selected = isBlank(value) ? "" : normalizeInput(value, "payer").value; } catch { /* Preserve invalid payer. */ }
    const options = [["", scope === "common" ? "未設定" : "使用共用設定"], ["buyer", "買方"], ["seller", "賣方"]];
    if (selected && !options.some(([key]) => key === selected)) options.push([selected, `需修正：${selected}`]);
    control = `<select ${attr} class="form-select">${options.map(([key, title]) => `<option value="${escape(key)}"${key === selected ? " selected" : ""}>${escape(title)}</option>`).join("")}</select>`;
  } else if (field.path.endsWith("taxNote") || field.path === "customer.note") {
    control = `<textarea ${attr} rows="3">${escape(text)}</textarea>`;
  } else {
    // Text dates/numbers retain invalid imported input for correction instead of
    // letting native date/number inputs silently erase it.
    control = `<input ${attr} type="text" value="${escape(text)}"${["number", "year"].includes(field.type) ? ' inputmode="decimal"' : ""}${field.type === "date" ? ' placeholder="2026-10-01 或 115/10/1"' : ""}>`;
  }
  return `<label class="field"><span>${escape(label(field))}</span>${control}<small id="${id}-hint" data-hint="${field.path}"${scope === "common" ? " hidden" : ""}></small></label>`;
}
function groupsMarkup(fields, data, scope, source) {
  const groups = [["案件資料", (field) => !field.path.includes("Tax.")], ["房屋稅", (field) => field.path.includes("houseTax.")], ["地價稅", (field) => field.path.includes("landTax.")]];
  return groups.map(([title, matches]) => `<div class="settings-group"><h3>${title}${scope === "individual" ? "・個別覆寫" : "・共用預設"}</h3><div class="form-grid">${fields.filter(matches).map((field) => fieldMarkup(field, getField(data, field.path), scope, source)).join("")}</div></div>`).join("");
}

export function setupBatchWorkspace({ root, singleRoot, getSingleState, onShowSingle }) {
  const workspace = createBatchWorkspace(), $ = (selector) => root.querySelector(selector);
  const singleButton = document.querySelector("#showSingleProration"), batchButton = document.querySelector("#showBatchProration");
  let editingId = null, busy = false;
  const printHost = document.querySelector("#batchReportHost");
  let titleBeforeBatchPrint = null;
  function clearBatchPrint() {
    printHost.classList.remove("is-measuring", "is-print-ready"); printHost.replaceChildren();
    if (titleBeforeBatchPrint !== null) { document.title = titleBeforeBatchPrint; titleBeforeBatchPrint = null; }
  }
  window.addEventListener("afterprint", clearBatchPrint);
  let savedFingerprint = JSON.stringify(workspace.batch);
  const isDirty = () => JSON.stringify(workspace.batch) !== savedFingerprint;
  const hasBatchData = () => workspace.batch.rows.length > 0 || COMMON_FIELDS.some((field) => !isBlank(getField(workspace.batch.common, field.path))) ||
    (workspace.batch.common.shared?.notes ?? []).some((note) => !isBlank(note.content));
  function renderSaveStatus(message = "") { $("#batchCaseStatus").textContent = message || (isDirty() ? "批次案件尚未儲存。" : "批次案件已儲存，或尚無修改。"); }
  function markChanged() { renderSaveStatus(); }
  function markSaved(message) { savedFingerprint = JSON.stringify(workspace.batch); renderSaveStatus(message); }
  const rowElements = new Map();
  function renderCommonSummary() {
    const common = workspace.batch.common;
    const summary = [];
    const priority = ["shared.seller", "shared.handoverDate"];
    const fields = [...priority, ...COMMON_FIELDS.map((field) => field.path).filter((path) => !priority.includes(path))];
    for (const path of fields) {
      const value = getField(common, path);
      if (isBlank(value)) continue;
      const title = path === "shared.handoverDate" ? "分算日" : label(COMMON_FIELDS.find((field) => field.path === path));
      let visible = String(value);
      if (path === "shared.handoverDate") {
        try { visible = formatRocDate(normalizeInput(value, "date").value); } catch { /* Show the entered value until corrected. */ }
      }
      summary.push(`${title}：${visible}`);
    }
    const noteCount = (common.shared?.notes ?? []).filter((note) => !isBlank(note.content)).length;
    if (noteCount) summary.push(`共用備註：${noteCount} 筆`);
    $("#batchCommonSummary").textContent = summary.length ? summary.slice(0, 2).join("｜") + (summary.length > 2 ? `｜另有 ${summary.length - 2} 項` : "") : "尚未設定共用資料";
  }
  function setCommonExpanded(expanded) {
    $("#batchCommonToggle").setAttribute("aria-expanded", String(expanded));
    $("#batchCommonBody").hidden = !expanded;
    $("#batchCommonSummary").hidden = expanded;
  }
  $("#batchCommonHeading").addEventListener("click", () => setCommonExpanded($("#batchCommonToggle").getAttribute("aria-expanded") !== "true"));
  function mode(batchMode) {
    if (!batchMode) clearBatchPrint();
    root.hidden = !batchMode; singleRoot.hidden = batchMode;
    for (const [button, active] of [[singleButton, !batchMode], [batchButton, batchMode]]) {
      button.setAttribute("aria-pressed", String(active)); button.classList.toggle("btn-primary", active); button.classList.toggle("btn-secondary", !active);
    }
    if (!batchMode) requestAnimationFrame(onShowSingle);
  }
  singleButton.addEventListener("click", () => mode(false)); batchButton.addEventListener("click", () => mode(true));
  function status(message) { $("#batchImportStatus").textContent = message; }
  function renderCommon() {
    $("#batchCommonFields").innerHTML = groupsMarkup(COMMON_FIELDS, workspace.batch.common, "common");
    renderNotes(); updateCommonHints(); renderCommonSummary();
  }
  function renderNotes() {
    $("#batchCommonNotes").innerHTML = (workspace.batch.common.shared.notes ?? []).map((note, index) => `<article class="custom-note-item"><label class="field"><span>共用其他備註 ${index + 1}</span><textarea rows="3" data-batch-note="${index}">${escape(note.content)}</textarea></label><div class="custom-note-actions"><button type="button" class="text-button" data-remove-batch-note="${index}">刪除</button></div></article>`).join("");
  }
  function updateCommonHints() {
    for (const field of COMMON_FIELDS) {
      const input = $(`[data-batch-common="${field.path}"]`), hint = input.parentElement.querySelector("small");
      const raw = getField(workspace.batch.common, field.path);
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby"); hint.hidden = true; hint.textContent = "";
      try { if (!isBlank(raw)) normalizeInput(raw, field.type); }
      catch (error) { hint.textContent = error.message; hint.hidden = false; input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", hint.id); }
    }
  }
  function resultText(row, kind) {
    if (!row.valid) return "—";
    const value = kind === "total" ? row.results.total : row.results[kind].settlement;
    return settlementText(value, row.state.customer.buyer, row.state.shared.seller);
  }
  function renderRows() {
    const focusedSelection = document.activeElement?.dataset.selectRow;
    const counts = workspace.counts;
    $("#batchSummary").textContent = `共 ${counts.total} 戶 · 正常 ${counts.valid} 戶 · 錯誤 ${counts.invalid} 戶 · 已勾選 ${counts.selected} 戶`;
    $("#batchEmpty").hidden = counts.total > 0; $("#batchTableContainer").hidden = counts.total === 0;
    $("#batchSelectValid").disabled = busy || counts.valid === 0; $("#batchDeselectAll").disabled = busy || counts.selected === 0;
    $("#batchPrintSelected").disabled = busy;
    const current = new Set(workspace.evaluated.map((row) => row.id));
    for (const [id, element] of rowElements) if (!current.has(id)) { element.remove(); rowElements.delete(id); }
    for (const row of workspace.evaluated) {
      const source = workspace.batch.rows.find((item) => item.id === row.id).source;
      const sourceText = source?.rowNumber ? `Excel 第 ${source.rowNumber} 列` : "";
      const errors = row.errors.map((error) => `<li>${escape(issueText(error))}</li>`).join("");
      const warnings = row.warnings.map((warning) => `<li>${escape(issueText(warning))}</li>`).join("");
      const contents = `<td data-label="是否輸出"><label class="check-option${row.valid ? "" : " is-disabled"}"><input type="checkbox" data-select-row="${escape(row.id)}" aria-label="勾選 ${escape(row.state.customer.label || sourceText)}"${row.canOutput ? " checked" : ""}${row.valid ? "" : " disabled"}><span class="visually-hidden">是否輸出</span></label></td>
        <td data-label="戶別">${escape(row.state.customer.label || "未填戶別")}${row.state.customer.doorplate ? `<small class="table-cell-hint">${escape(row.state.customer.doorplate)}</small>` : ""}<small class="table-cell-hint">${escape(sourceText)}</small></td><td data-label="買方">${escape(row.state.customer.buyer || "—")}</td>
        <td data-label="房屋稅找補">${escape(resultText(row, "house"))}</td><td data-label="地價稅找補">${escape(resultText(row, "land"))}</td><td data-label="最終找補">${escape(resultText(row, "total"))}</td>
        <td data-label="資料狀態"><span>${row.valid ? "✓ 正常" : "需修正"}</span>${errors ? `<ul class="batch-row-errors">${errors}</ul>` : ""}${warnings ? `<ul class="batch-row-errors">${warnings}</ul>` : ""}</td>
        <td data-label="編輯"><button type="button" class="text-button" data-edit-row="${escape(row.id)}" aria-expanded="${row.id === editingId}" aria-controls="batchEditor">編輯</button></td>`;
      let element = rowElements.get(row.id);
      if (!element) { element = document.createElement("tr"); element.dataset.batchRow = row.id; rowElements.set(row.id, element); $("#batchRows").append(element); }
      // Updating an individual never replaces unrelated rows or renders A4 DOM.
      if (element._contents !== contents) { element.innerHTML = contents; element._contents = contents; }
    }
    updateEditorHints();
    if (focusedSelection) rowElements.get(focusedSelection)?.querySelector("input")?.focus({ preventScroll: true });
  }
  function updateEditorHints() {
    if (!editingId) return;
    const row = workspace.evaluated.find((item) => item.id === editingId);
    if (!row) return;
    $("#batchEditorTitle").textContent = `編輯 ${row.state.customer.label || "未填戶別"}・個別資料`;
    $("#batchEditorStatus").textContent = row.valid ? `✓ 正常 · ${resultText(row, "total")}` : row.errors.map(issueText).join(" ");
    for (const field of BATCH_FIELDS) {
      const input = $(`[data-batch-individual="${field.path}"]`);
      if (!input) continue;
      const error = row.errors.filter((item) => item.path === field.path).map((item) => item.message).join(" ");
      const origin = row.origins[field.path];
      const commonText = field.path === "customer.note" ? "共用其他備註會另外保留。" : `共用值：${displayValue(getField(workspace.batch.common, field.path), field)}。`;
      input.parentElement.querySelector("small").textContent = `${origin === "individual" ? "目前使用個別覆寫值。" : origin === "common" ? "目前繼承共用值。" : "目前無值。"} ${commonText}${error ? ` ${error}` : ""}`;
      if (error) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    }
  }
  function openEditor(id) {
    const raw = workspace.batch.rows.find((row) => row.id === id);
    if (!raw) return;
    editingId = id; $("#batchEditor").hidden = false;
    $("#batchEditorFields").innerHTML = groupsMarkup(BATCH_FIELDS, raw.values, "individual", raw.source);
    const selectionError = workspace.evaluated.find((row) => row.id === id).errors.some((error) => error.path === "selected");
    $("#batchUnmappedFields").innerHTML = `${selectionError ? '<p class="proration-message">Excel 的「是否輸出」值無法辨識。</p><button class="btn btn-secondary" type="button" data-reset-selection>改為不勾選</button>' : ""}${(raw.source?.unmappedCells ?? []).filter((cell) => !isBlank(cell.raw)).map((cell) => `<div class="custom-note-item"><p>${escape(cell.address)} 無欄名資料：${escape(rawText(cell.raw, { type: "text" }))}</p><button type="button" class="text-button" data-remove-unmapped="${escape(cell.address)}">移除此無欄名資料</button></div>`).join("")}`;
    renderRows(); $("#batchEditorTitle").focus();
  }
  function closeEditor() {
    const previous = editingId; editingId = null; $("#batchEditor").hidden = true; renderRows();
    rowElements.get(previous)?.querySelector("[data-edit-row]")?.focus();
  }
  $("#batchCloseEditor").addEventListener("click", closeEditor);
  $("#batchCopySingle").addEventListener("click", () => {
    if (isDirty() && !window.confirm("帶入會取代批次共用設定，各戶個別值仍保留。是否繼續？")) return;
    workspace.copySingle(getSingleState()); markChanged(); renderCommon(); renderRows(); status("已帶入目前單戶可共用的設定；買方、房屋稅額及持分分子仍由各戶填寫。");
  });
  $("#batchAddNote").addEventListener("click", () => {
    workspace.batch.common.shared.notes.push({ id: crypto.randomUUID(), content: "" }); markChanged(); renderNotes(); renderCommonSummary();
    $("#batchCommonNotes article:last-child textarea")?.focus();
  });
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target.dataset.batchCommon) { workspace.setCommon(target.dataset.batchCommon, target.value); markChanged(); updateCommonHints(); renderCommonSummary(); renderRows(); }
    if (target.dataset.batchIndividual && editingId) { workspace.updateField(editingId, target.dataset.batchIndividual, target.value); markChanged(); renderRows(); }
    if (target.dataset.batchNote !== undefined) { workspace.batch.common.shared.notes[Number(target.dataset.batchNote)].content = target.value; markChanged(); workspace.refresh(); renderCommonSummary(); renderRows(); }
  });
  root.addEventListener("change", (event) => {
    if (event.target.dataset.selectRow) { workspace.select(event.target.dataset.selectRow, event.target.checked); markChanged(); renderRows(); }
  });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.editRow) openEditor(button.dataset.editRow);
    if (button.dataset.removeBatchNote !== undefined) { workspace.batch.common.shared.notes.splice(Number(button.dataset.removeBatchNote), 1); markChanged(); workspace.refresh(); renderNotes(); renderCommonSummary(); renderRows(); }
    if (button.dataset.removeUnmapped && editingId) {
      const row = workspace.batch.rows.find((item) => item.id === editingId);
      row.source.unmappedCells = row.source.unmappedCells.filter((cell) => cell.address !== button.dataset.removeUnmapped); markChanged(); workspace.refresh(); openEditor(editingId);
    }
    if (button.hasAttribute("data-reset-selection") && editingId) { workspace.select(editingId, false); workspace.refresh(); markChanged(); openEditor(editingId); }
  });
  $("#batchSelectValid").addEventListener("click", () => { workspace.selectAll(true); markChanged(); renderRows(); });
  $("#batchDeselectAll").addEventListener("click", () => { workspace.selectAll(false); markChanged(); renderRows(); });
  $("#batchPrintSelected").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const button = $("#batchPrintSelected"), originalLabel = button.textContent;
    const controls = [...root.querySelectorAll("input, select, textarea, button")];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    button.textContent = "準備報表中…";
    $("#batchPrintStatus").textContent = "正在檢查當次資料與每戶 A4 頁面容量…";
    try {
      clearBatchPrint();
      const snapshot = structuredClone(workspace.batch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { pages, invalidSelected } = prepareBatchPrint(snapshot);
      if (!pages.length && !invalidSelected.length) throw new Error("請先勾選至少一戶資料正常的戶別。");
      for (const page of pages) {
        const article = document.createElement("article");
        article.className = "a4-sheet proration-a4-sheet orientation-portrait report-font-medium table-spacing-standard section-spacing-standard batch-report-document";
        article.dataset.batchPrintId = page.id;
        article.setAttribute("aria-label", `${page.label} 分算找補報表`);
        article.innerHTML = page.html;
        printHost.append(article);
      }
      printHost.classList.add("is-measuring");
      await document.fonts.ready;
      const maxHeight = 279 * 96 / 25.4;
      const excluded = invalidSelected.map((row) => `${row.label}：${row.reason}`);
      let printable = 0;
      for (const [index, article] of [...printHost.children].entries()) {
        const title = article.querySelector(".report-header h2"), range = document.createRange(); range.selectNodeContents(title);
        let reason = "";
        if (range.getClientRects().length > 1 || title.scrollWidth > title.clientWidth + 1) reason = "標題超出 A4 單行寬度";
        else if (article.scrollWidth > article.clientWidth + 1 || [...article.querySelectorAll("table, .report-meta, .report-clause")].some((element) => element.scrollWidth > element.clientWidth + 1)) reason = "表格或文字超出 A4 頁面寬度";
        else if (article.getBoundingClientRect().height > maxHeight + 1) reason = "內容超出一張 A4 的高度，請檢查備註或過長文字";
        if (reason) { excluded.push(`${pages[index].label}：${reason}`); article.remove(); }
        else printable += 1;
      }
      const duplicateIds = new Set();
      for (const element of printHost.querySelectorAll("[id]")) {
        if (duplicateIds.has(element.id)) throw new Error(`列印內容出現重複 HTML id：${element.id}`);
        duplicateIds.add(element.id);
      }
      const details = excluded.length ? `排除 ${excluded.length} 戶：${excluded.join("；")}` : "無排除戶別";
      $("#batchPrintStatus").textContent = `可列印 ${printable} 戶；${details}。`;
      if (!printable) throw new Error(`沒有可完整列印的戶別。${details}。`);
      if (!window.confirm(`可列印 ${printable} 戶。${details}。是否繼續開啟列印視窗？`)) {
        clearBatchPrint(); $("#batchPrintStatus").textContent = `已取消批次列印。可列印 ${printable} 戶；${details}。`; return;
      }
      printHost.classList.remove("is-measuring"); printHost.classList.add("is-print-ready");
      titleBeforeBatchPrint = document.title;
      document.title = `${sanitizeFilename(snapshot.common.shared?.caseName || "地價稅房屋稅分算找補")}_批次分算`;
      $("#batchPrintStatus").textContent = `已準備 ${printable} 戶 A4 報表，請在列印視窗選擇另存 PDF。${excluded.length ? `已排除：${excluded.join("；")}。` : ""}`;
      window.print();
    } catch (error) {
      clearBatchPrint();
      $("#batchPrintStatus").textContent = `列印未完成：${error.message}`;
      window.alert(error.message);
    } finally {
      busy = false; controls.forEach((control, index) => { control.disabled = disabled[index]; });
      button.textContent = originalLabel; renderRows();
    }
  });
  async function withBusy(button, action, reportError = status) {
    if (busy) return;
    busy = true; const title = button.textContent; button.textContent = "處理中…";
    // Lock only batch inputs while reading an Excel snapshot. Single-case remains independent.
    const controls = [...root.querySelectorAll("input, select, textarea, button")];
    const disabled = controls.map((control) => control.disabled); controls.forEach((control) => { control.disabled = true; });
    try { await action(); } catch (error) { reportError(`未完成：${error.message || "請稍後重試。"}`); }
    finally { busy = false; controls.forEach((control, index) => { control.disabled = disabled[index]; }); button.textContent = title; renderRows(); }
  }
  $("#batchDownloadTemplate").addEventListener("click", (event) => withBusy(event.currentTarget, async () => { await downloadBatchTemplate(workspace.batch.common); status("已下載批次範本。共用設定快照僅供核對，不會在匯入時覆蓋設定。"); }));
  $("#batchUploadExcel").addEventListener("click", () => { $("#batchExcelFile").value = ""; $("#batchExcelFile").click(); });
  $("#batchExcelFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (workspace.batch.rows.length && !window.confirm("上傳會取代目前批次各戶資料與編輯內容，共用設定仍保留。是否繼續？")) return;
    withBusy($("#batchUploadExcel"), async () => {
      status(`正在讀取 ${file.name}…`);
      const imported = await readBatchExcel(file, { common: workspace.batch.common });
      workspace.replace(imported.batch); editingId = null; $("#batchEditor").hidden = true; markChanged();
      status(`已匯入 ${file.name}，共 ${workspace.counts.total} 戶。${workspace.counts.invalid ? `其中 ${workspace.counts.invalid} 戶需修正，可直接點選編輯。` : "全部資料正常。"}`);
      renderRows(); $("#batchPreview").scrollIntoView({ block: "start" });
    });
  });
  $("#batchSaveCase").addEventListener("click", (event) => withBusy(event.currentTarget, async () => {
    const file = buildBatchCaseFile(workspace.batch);
    downloadCaseFile(file, batchCaseFilename(workspace.batch.common.shared?.caseName));
    markSaved("已下載完整批次案件 JSON，目前資料已儲存。");
  }, renderSaveStatus));
  $("#batchImportCase").addEventListener("click", () => { $("#batchCaseFile").value = ""; $("#batchCaseFile").click(); });
  $("#batchCaseFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    withBusy($("#batchImportCase"), async () => {
      const imported = parseBatchCaseFile(await file.text());
      if (hasBatchData() && !window.confirm("導入批次案件會取代目前批次共用設定及各戶資料，是否繼續？")) return;
      workspace.replace(imported); editingId = null; $("#batchEditor").hidden = true;
      renderCommon(); renderRows(); markSaved(`已導入 ${file.name}，共 ${workspace.counts.total} 戶。${workspace.counts.invalid ? `其中 ${workspace.counts.invalid} 戶需修正。` : ""}`);
      $("#batchPreview").scrollIntoView({ block: "start" });
    }, renderSaveStatus);
  });
  window.addEventListener("beforeunload", (event) => { if (isDirty()) { event.preventDefault(); event.returnValue = ""; } });
  renderCommon(); renderRows(); renderSaveStatus();
}
