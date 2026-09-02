import { calculateGiftTax } from "./calculations.js";
import { clauses } from "./clauses.js";
import { formatMoney, parseFormattedNumber } from "./formatters.js";

let settingsInstance = 0;

export function createDefaultReportConfiguration() {
  return {
    settingsExpanded: false,
    displayOptions: {
      orientation: "landscape",
      tableSpacing: "relaxed",
      sectionSpacing: "relaxed",
      fontSize: "medium",
      showLandZoning: false,
      zoningPrintLayout: "row",
      zoningTextMode: "full",
      printLandColumns: { district: true, section: true, subsection: true, owner: true },
      showSelfUseTax: true,
      showTaxSummary: true,
      taxSummaryItems: { selfUseTax: true, generalTax: true, deedTax: true, giftTax: false }
    },
    selectedClauses: ["selfUse", "houseLandTax", "post2016"],
    customNotes: [],
    giftTax: {
      enabled: false,
      giftDate: new Date().toLocaleDateString("en-CA"),
      previousGiftAmount: 0,
      otherCurrentGiftAmount: 0,
      landValueTaxDeduction: 0,
      deedTaxDeduction: 0,
      otherDeduction: 0,
      previousPaidTaxCredit: 0,
      excludedGiftAmount: 0,
      landValueTaxDeductionOverridden: false,
      deedTaxDeductionOverridden: false,
      result: null
    }
  };
}

function checked(value) { return value ? " checked" : ""; }
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const createNoteId = () => globalThis.crypto?.randomUUID ? `note-${globalThis.crypto.randomUUID()}` : `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createReportSettings({ container, state, onChange = () => {}, onRequeryZoning = () => {} }) {
  const id = `report-settings-${++settingsInstance}`;
  const radio = (name, value, label) => `<label class="radio-option"><input type="radio" name="${id}-${name}" data-option="${name}" value="${value}"${checked(state.displayOptions[name] === value)}><span>${label}</span></label>`;
  container.innerHTML = `<div class="settings-accordion">
    <button class="settings-accordion-header" type="button" aria-expanded="${state.settingsExpanded}" aria-controls="${id}-content">
      <span class="settings-accordion-arrow" aria-hidden="true">›</span><span>試算表設定</span>
    </button>
    <div id="${id}-content" class="settings-accordion-content"${state.settingsExpanded ? "" : " hidden"}>
      <p class="settings-description">選擇要呈現在客戶版試算表中的欄位與說明。</p>
      <div class="settings-list">
        <div class="settings-group"><h3>列印方向</h3><div class="option-row">${radio("orientation", "portrait", "直式 Portrait")}${radio("orientation", "landscape", "橫式 Landscape")}</div></div>
        <div class="settings-group"><h3>主表欄位</h3>
          <label class="check-option"><input data-toggle="showSelfUseTax" type="checkbox"${checked(state.displayOptions.showSelfUseTax)}><span>顯示自用增值稅</span></label>
          <label class="check-option"><input data-toggle="showLandZoning" type="checkbox"${checked(state.displayOptions.showLandZoning)}><span>帶入土地使用分區</span></label>
          <div class="nested-options" data-zoning-options${state.displayOptions.showLandZoning ? "" : " hidden"}>
            <div class="layout-setting-row"><span>列印位置</span><div class="option-row compact-option-row">${radio("zoningPrintLayout", "row", "獨立一列")}${radio("zoningPrintLayout", "column", "右側欄位")}</div></div>
            <div class="layout-setting-row"><span>文字內容</span><div class="option-row compact-option-row">${radio("zoningTextMode", "full", "完整內容")}${radio("zoningTextMode", "short", "僅分區名稱")}</div></div>
            <p class="settings-description">目前自動查詢支援臺北市，資料來源為臺北市政府都市發展局。</p>
            <button class="btn btn-secondary" data-requery-zoning type="button">重新查詢使用分區</button>
          </div>
        </div>
        <div class="settings-group"><h3>土地欄位</h3>
          ${[["district","區"],["section","段"],["subsection","小段"],["owner","所有權人"]].map(([key,label]) => `<label class="check-option"><input data-print-land-column="${key}" type="checkbox"${checked(state.displayOptions.printLandColumns[key])}><span>${label}</span></label>`).join("")}
        </div>
        <div class="settings-group"><h3>贈與稅試算</h3>
          <label class="check-option"><input data-toggle="giftTax" type="checkbox"${checked(state.giftTax.enabled)}><span>啟用贈與稅試算</span></label>
          <div class="gift-tax-fields" data-gift-fields${state.giftTax.enabled ? "" : " hidden"}>
            ${[["previousGiftAmount","本年度以前各次贈與總額"],["otherCurrentGiftAmount","其他本次贈與金額"],["landValueTaxDeduction","土地增值稅扣除額"],["deedTaxDeduction","契稅扣除額"],["otherDeduction","其他贈與負擔／扣除額"],["previousPaidTaxCredit","本年度以前各次已納贈與稅及可扣抵稅額"]].map(([field,label]) => `<label class="field"><span>${label}</span><input data-gift-money="${field}" inputmode="numeric" type="text" value="${formatMoney(state.giftTax[field])}"></label>`).join("")}
            <div class="gift-tax-result"><span>應納贈與稅</span><strong data-gift-result>0</strong></div>
          </div>
        </div>
        <div class="settings-group"><h3>稅額摘要</h3>
          <label class="check-option"><input data-toggle="showTaxSummary" type="checkbox"${checked(state.displayOptions.showTaxSummary)}><span>顯示稅額摘要</span></label>
          <div class="nested-options" data-summary-options${state.displayOptions.showTaxSummary ? "" : " hidden"}>
            ${[["selfUseTax","自用增值稅"],["generalTax","一般增值稅"],["deedTax","契稅"],["giftTax","贈與稅"]].map(([value,label]) => `<label class="check-option"><input data-summary-item value="${value}" type="checkbox"${checked(state.displayOptions.taxSummaryItems[value])}><span>${label}</span></label>`).join("")}
          </div>
          <label class="check-option"><input data-toggle="showCaseTotal" type="checkbox"${checked(state.displayOptions.showCaseTotal)}><span>顯示案件總計（多人時）</span></label>
        </div>
        <div class="settings-group"><h3>備註條款</h3><div class="clause-options">${clauses.map((clause) => `<label class="check-option"><input data-clause value="${clause.id}" type="checkbox"${checked(state.selectedClauses.includes(clause.id))}><span>${clause.label}</span></label>`).join("")}</div><div class="custom-notes-divider"></div><div class="custom-notes-heading"><span>自訂備註</span><button class="btn btn-secondary" data-add-custom-note type="button">＋ 新增備註</button></div><div class="custom-notes-list" data-custom-notes-list></div></div>
        <div class="settings-group"><h3>排版設定</h3>
          <div class="layout-setting-row"><span>表格行距</span><div class="option-row compact-option-row">${radio("tableSpacing", "compact", "緊湊")}${radio("tableSpacing", "standard", "標準")}${radio("tableSpacing", "relaxed", "寬鬆")}</div></div>
          <div class="layout-setting-row"><span>段落間距</span><div class="option-row compact-option-row">${radio("sectionSpacing", "compact", "緊湊")}${radio("sectionSpacing", "standard", "標準")}${radio("sectionSpacing", "relaxed", "寬鬆")}</div></div>
          <div class="layout-setting-row"><span>字體大小</span><div class="option-row compact-option-row">${radio("fontSize", "small", "小")}${radio("fontSize", "medium", "中")}${radio("fontSize", "large", "大")}</div></div>
        </div>
      </div>
    </div>
  </div>`;

  const header = container.querySelector(".settings-accordion-header");
  const content = container.querySelector(".settings-accordion-content");
  const notesList = container.querySelector("[data-custom-notes-list]");
  const autoGrow = (textarea) => { textarea.style.height = "auto"; textarea.style.height = `${Math.min(180, Math.max(88, textarea.scrollHeight))}px`; };
  const renderCustomNotes = () => {
    notesList.innerHTML = (state.customNotes ?? []).map((note) => `<article class="custom-note-item" data-custom-note-id="${note.id}">
      <label class="check-option"><input data-custom-note-enabled type="checkbox"${checked(note.enabled !== false)}><span>顯示</span></label>
      <label class="field"><span>標題（選填）</span><input data-custom-note-title type="text" value="${escapeHtml(note.title)}"></label>
      <label class="field"><span>內容</span><textarea data-custom-note-content rows="3">${escapeHtml(note.content)}</textarea></label>
      <div class="custom-note-actions"><button class="text-button" data-remove-custom-note type="button">刪除</button></div>
    </article>`).join("");
    notesList.querySelectorAll("textarea").forEach(autoGrow);
  };
  renderCustomNotes();
  const sync = () => {
    header.setAttribute("aria-expanded", String(state.settingsExpanded));
    content.hidden = !state.settingsExpanded;
    container.querySelector("[data-gift-fields]").hidden = !state.giftTax.enabled;
    container.querySelector("[data-summary-options]").hidden = !state.displayOptions.showTaxSummary;
    container.querySelector("[data-zoning-options]").hidden = !state.displayOptions.showLandZoning;
    const selfSummary = container.querySelector('[data-summary-item][value="selfUseTax"]');
    selfSummary.disabled = !state.displayOptions.showSelfUseTax;
    if (!state.displayOptions.showSelfUseTax) selfSummary.checked = false;
    const giftSummary = container.querySelector('[data-summary-item][value="giftTax"]');
    giftSummary.disabled = !state.giftTax.enabled;
    if (!state.giftTax.enabled) giftSummary.checked = false;
    container.querySelector("[data-gift-result]").textContent = formatMoney(state.giftTax.result?.finalGiftTax ?? 0);
    for (const input of container.querySelectorAll("[data-gift-money]")) if (document.activeElement !== input) input.value = formatMoney(state.giftTax[input.dataset.giftMoney]);
  };
  const changed = () => { state.giftTax.result = calculateGiftTax(state); sync(); onChange(); };

  header.addEventListener("click", () => { state.settingsExpanded = !state.settingsExpanded; sync(); });
  container.addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.option && input.checked) state.displayOptions[input.dataset.option] = input.value;
    if (input.dataset.toggle === "showSelfUseTax") {
      state.displayOptions.showSelfUseTax = input.checked;
      if (!input.checked) state.displayOptions.taxSummaryItems.selfUseTax = false;
    }
    if (input.dataset.toggle === "showTaxSummary") state.displayOptions.showTaxSummary = input.checked;
    if (input.dataset.toggle === "showLandZoning") state.displayOptions.showLandZoning = input.checked;
    if (input.dataset.toggle === "showCaseTotal") state.displayOptions.showCaseTotal = input.checked;
    if (input.dataset.toggle === "giftTax") {
      state.giftTax.enabled = input.checked;
      if (!input.checked) state.displayOptions.taxSummaryItems.giftTax = false;
    }
    if (input.dataset.summaryItem) state.displayOptions.taxSummaryItems[input.value] = input.checked;
    if (input.dataset.printLandColumn) state.displayOptions.printLandColumns[input.dataset.printLandColumn] = input.checked;
    if (input.dataset.clause !== undefined) state.selectedClauses = [...container.querySelectorAll("[data-clause]:checked")].map((item) => item.value);
    if (input.dataset.customNoteEnabled !== undefined) {
      const note = state.customNotes.find((item) => item.id === input.closest("[data-custom-note-id]").dataset.customNoteId);
      if (note) note.enabled = input.checked;
    }
    changed();
  });
  container.addEventListener("click", (event) => {
    if (event.target.matches("[data-requery-zoning]")) { onRequeryZoning(); return; }
    if (event.target.matches("[data-add-custom-note]")) {
      state.customNotes ??= []; state.customNotes.push({ id: createNoteId(), enabled: true, title: "", content: "" }); renderCustomNotes(); onChange(); return;
    }
    if (event.target.matches("[data-remove-custom-note]")) {
      const item = event.target.closest("[data-custom-note-id]"); const note = state.customNotes.find((entry) => entry.id === item.dataset.customNoteId);
      if ((note?.title || note?.content) && !window.confirm("確定刪除此備註？")) return;
      state.customNotes = state.customNotes.filter((entry) => entry.id !== item.dataset.customNoteId); renderCustomNotes(); onChange();
    }
  });
  container.addEventListener("focusin", (event) => { if (event.target.dataset.giftMoney) event.target.value = String(state.giftTax[event.target.dataset.giftMoney] || ""); });
  container.addEventListener("input", (event) => {
    const noteItem = event.target.closest("[data-custom-note-id]");
    if (noteItem && (event.target.matches("[data-custom-note-title]") || event.target.matches("[data-custom-note-content]"))) {
      const note = state.customNotes.find((item) => item.id === noteItem.dataset.customNoteId);
      if (note) note[event.target.matches("[data-custom-note-title]") ? "title" : "content"] = event.target.value;
      if (event.target.matches("textarea")) autoGrow(event.target); onChange(); return;
    }
    const field = event.target.dataset.giftMoney; if (!field) return;
    state.giftTax[field] = parseFormattedNumber(event.target.value);
    if (field === "landValueTaxDeduction") state.giftTax.landValueTaxDeductionOverridden = true;
    if (field === "deedTaxDeduction") state.giftTax.deedTaxDeductionOverridden = true;
    state.giftTax.result = calculateGiftTax(state); container.querySelector("[data-gift-result]").textContent = formatMoney(state.giftTax.result.finalGiftTax); onChange();
  });
  container.addEventListener("focusout", (event) => { const field = event.target.dataset.giftMoney; if (field) event.target.value = formatMoney(state.giftTax[field]); });
  state.giftTax.result = calculateGiftTax(state); sync();
  return { sync };
}
