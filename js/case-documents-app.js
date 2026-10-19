import {
  addBlankBuilding,
  addBlankCommonPart,
  addBlankLand,
  addBlankParty,
  createCaseDocumentState,
  formatRocDate,
  getPartyRoleSuggestions,
  getProgressGroups,
  reconcileCaseDistrict,
  reconcileImportedPartyRoles,
  reconcilePartyShareVisibility,
  renderCaseCard,
} from "./case-documents-model.js";
import {
  addImportedFile,
  hasManualSourceEdits,
  importedFileSummary,
  inspectImportConflict,
  prepareImportedFile,
  removeImportedFile,
} from "./case-documents-import.js";
import { preparePrintableCaseCard } from "./case-documents-print.js";

const state = createCaseDocumentState();
const elements = {
  fileInput: document.querySelector("#caseCsvFiles"),
  uploadZone: document.querySelector("#caseCsvUploadZone"),
  importStatus: document.querySelector("#caseImportStatus"),
  importedFiles: document.querySelector("#caseImportedFiles"),
  importedFileCount: document.querySelector("#caseImportedFileCount"),
  district: document.querySelector("#caseDistrict"),
  caseNumber: document.querySelector("#caseNumber"),
  registrationReason: document.querySelector("#registrationReason"),
  reasonDate: document.querySelector("#reasonDate"),
  caseType: document.querySelector("#caseType"),
  otherCaseType: document.querySelector("#otherCaseType"),
  otherCaseTypeField: document.querySelector("#otherCaseTypeField"),
  mortgagePartyOption: document.querySelector("#mortgagePartyOption"),
  sameDebtorObligor: document.querySelector("#sameDebtorObligor"),
  showPartyShare: document.querySelector("#showPartyShare"),
  partyRoleOptions: document.querySelector("#partyRoleOptions"),
  partyRows: document.querySelector("#partyEditorRows"),
  partyEmpty: document.querySelector("#partyEditorEmpty"),
  progressEditor: document.querySelector("#progressEditor"),
  landRows: document.querySelector("#landEditorRows"),
  landEmpty: document.querySelector("#landEditorEmpty"),
  buildingRows: document.querySelector("#buildingEditorRows"),
  buildingEmpty: document.querySelector("#buildingEditorEmpty"),
  commonRows: document.querySelector("#commonPartEditorRows"),
  commonEmpty: document.querySelector("#commonPartEditorEmpty"),
  material: document.querySelector("#buildingMaterial"),
  totalFloors: document.querySelector("#buildingTotalFloors"),
  sheet: document.querySelector("#caseCardSheet"),
  viewport: document.querySelector("#caseCardViewport"),
  printButton: document.querySelector("#printCaseCard"),
  printRoot: document.querySelector("#caseCardPrintRoot"),
};

bindCaseFields();
bindImport();
bindEditorActions();
bindPrint();
renderAllEditors();
renderImportedFiles();
renderPreview();

function bindCaseFields() {
  elements.district.addEventListener("input", () => {
    state.caseInfo.district = elements.district.value;
    state.caseInfo.districtManual = Boolean(elements.district.value.trim());
    if (!state.caseInfo.districtManual) reconcileCaseDistrict(state);
    renderPreview();
  });
  elements.caseNumber.addEventListener("input", () => {
    state.caseInfo.caseNumber = elements.caseNumber.value;
    renderPreview();
  });
  elements.registrationReason.addEventListener("input", () => {
    state.caseInfo.registrationReason = elements.registrationReason.value;
    state.caseInfo.registrationReasonManual = true;
    renderPreview();
  });
  elements.reasonDate.addEventListener("input", () => {
    state.caseInfo.reasonDate = elements.reasonDate.value;
    state.caseInfo.reasonDateManual = true;
    renderPreview();
  });
  elements.reasonDate.addEventListener("blur", () => {
    state.caseInfo.reasonDate = formatRocDate(elements.reasonDate.value);
    elements.reasonDate.value = state.caseInfo.reasonDate;
    renderPreview();
  });
  elements.otherCaseType.addEventListener("input", () => {
    state.caseInfo.otherCaseType = elements.otherCaseType.value;
  });

  elements.caseType.addEventListener("change", () => {
    state.caseInfo.caseType = elements.caseType.value;
    state.caseInfo.caseTypeManual = true;
    reconcileImportedPartyRoles(state);
    reconcilePartyShareVisibility(state);
    renderCaseTypeControls();
    renderProgressEditor();
    renderPartyEditor();
    renderPreview();
  });

  elements.material.addEventListener("input", () => {
    state.buildingMeta.material = elements.material.value;
    state.buildingMeta.materialManual = true;
    state.buildingMeta.materialNeedsConfirmation = false;
    renderPreview();
  });
  elements.totalFloors.addEventListener("input", () => {
    state.buildingMeta.totalFloors = elements.totalFloors.value;
    state.buildingMeta.totalFloorsNeedsConfirmation = false;
    renderPreview();
  });
}

function bindImport() {
  elements.fileInput.addEventListener("change", () => importFiles([...elements.fileInput.files]));
  ["dragenter", "dragover"].forEach((eventName) => elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.remove("is-dragging");
  }));
  elements.uploadZone.addEventListener("drop", (event) => importFiles([...event.dataTransfer.files]));
  elements.importedFiles.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-source-file]");
    if (!button) return;
    const file = state.importedFiles.find((item) => item.id === button.dataset.removeSourceFile);
    if (!file) return;
    if (hasManualSourceEdits(state, file.id) && !window.confirm(`「${file.name}」的匯入資料已有手動修改；移除後這些修改將一併移除。是否繼續？`)) return;
    removeImportedFile(state, file.id);
    elements.importStatus.textContent = `已移除：${file.name}`;
    refreshImportedStateViews();
  });
}

async function importFiles(files) {
  const summaries = [];
  for (const file of files) {
    try {
      const bytes = await file.arrayBuffer();
      const candidate = await prepareImportedFile(file.name, bytes);
      const conflict = inspectImportConflict(state.importedFiles, candidate);
      if (conflict.type === "duplicate-content") {
        summaries.push(`${file.name}：此檔案已匯入`);
        continue;
      }
      let replaceFileId = "";
      if (conflict.type === "same-name-update") {
        const manualWarning = hasManualSourceEdits(state, conflict.file.id) ? "\n原版本已有手動修改，替換後相關修改可能無法保留。" : "";
        const confirmed = window.confirm(`「${file.name}」已有同名但內容不同的版本。是否以新版本替換？${manualWarning}`);
        if (!confirmed) { summaries.push(`${file.name}：已取消替換`); continue; }
        replaceFileId = conflict.file.id;
      }
      addImportedFile(state, candidate, { replaceFileId });
      summaries.push(`${file.name}：${replaceFileId ? "已替換，" : ""}${importedFileSummary(candidate)}${warningSuffix(candidate.parsed.warnings)}`);
    } catch (error) {
      summaries.push(`${file.name}：解析失敗（${error.message}）`);
    }
  }

  state.notices.forEach((notice) => summaries.push(`待確認：${notice}`));
  state.notices.length = 0;
  elements.importStatus.innerHTML = summaries.length
    ? summaries.map((item) => `<span>${escapeHtml(item)}</span>`).join("")
    : "尚未選擇檔案。";
  refreshImportedStateViews();
  elements.fileInput.value = "";
}

function refreshImportedStateViews() {
  syncCaseInputs();
  renderAllEditors();
  renderImportedFiles();
  renderPreview();
}

function renderImportedFiles() {
  elements.importedFiles.innerHTML = state.importedFiles.map((file) => `<div class="case-imported-file">
    <div><strong>${escapeHtml(file.name)}</strong><span>${file.type === "land" ? "土地" : "建物"}｜${escapeHtml(importedFileSummary(file))}</span></div>
    <button class="text-button" type="button" data-remove-source-file="${escapeAttribute(file.id)}">移除</button>
  </div>`).join("");
  elements.importedFileCount.textContent = `目前共 ${state.importedFiles.length} 份唯一檔案。`;
}

function bindEditorActions() {
  document.querySelector("#addCaseParty").addEventListener("click", () => {
    addBlankParty(state);
    reconcilePartyShareVisibility(state);
    renderPartyEditor();
    renderPreview();
  });
  document.querySelector("#addCaseLand").addEventListener("click", () => {
    addBlankLand(state);
    renderLandEditor();
    renderPreview();
  });
  document.querySelector("#addCaseBuilding").addEventListener("click", () => {
    addBlankBuilding(state);
    renderBuildingEditor();
    renderPreview();
  });
  document.querySelector("#addCommonPart").addEventListener("click", () => {
    addBlankCommonPart(state);
    renderCommonPartEditor();
    renderPreview();
  });

  bindCollectionEditor(elements.partyRows, "parties", renderPartyEditor);
  bindCollectionEditor(elements.landRows, "lands", renderLandEditor);
  bindCollectionEditor(elements.buildingRows, "buildings", renderBuildingEditor);
  bindCollectionEditor(elements.commonRows, "commonParts", renderCommonPartEditor);

  elements.showPartyShare.addEventListener("change", () => {
    state.partySettings.showShare = elements.showPartyShare.checked;
    state.partySettings.shareVisibilityMode = "manual";
    renderPreview();
  });
  elements.sameDebtorObligor.addEventListener("change", () => {
    state.partySettings.mergeDebtorAndObligor = elements.sameDebtorObligor.checked;
    if (elements.sameDebtorObligor.checked) ensureDebtorObligorPairs();
    renderPartyEditor();
    renderPreview();
  });

  elements.progressEditor.addEventListener("input", (event) => {
    const input = event.target.closest("[data-progress-key]");
    if (!input) return;
    const target = input.dataset.progressTarget === "label" ? state.progressLabels : state.progressValues;
    target[input.dataset.progressKey] = input.value;
    renderPreview();
  });
}

function bindCollectionEditor(container, collectionName, rerender) {
  container.addEventListener("input", (event) => {
    const input = event.target.closest("[data-record-id][data-field]");
    if (!input) return;
    const record = state[collectionName].find((item) => item.id === input.dataset.recordId);
    if (!record) return;
    record[input.dataset.field] = input.value;
    record.manualFields = [...new Set([...(record.manualFields || []), input.dataset.field])];
    if (collectionName === "parties" && input.dataset.field === "title") record.titleManual = true;
    if (collectionName === "parties" && input.dataset.field === "share") record.shareManual = true;
    if (collectionName === "commonParts" && input.dataset.field === "relatedMainBuildingNumber") {
      record.relatedMainBuildingNumberRaw = "";
      record.relationStatus = input.value.trim() ? "manual-confirmed" : "manual";
    }
    if (input.dataset.field === "section" || input.dataset.field === "subsection") record.locationNeedsConfirmation = false;
    if (collectionName === "parties") {
      reconcilePartyShareVisibility(state);
      elements.showPartyShare.checked = state.partySettings.showShare;
    }
    renderPreview();
  });
  container.addEventListener("focusout", (event) => {
    const input = event.target.closest('[data-field="birthDate"]');
    if (!input) return;
    const record = state[collectionName].find((item) => item.id === input.dataset.recordId);
    if (!record) return;
    record.birthDate = formatRocDate(record.birthDate);
    input.value = record.birthDate;
    renderPreview();
  });
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-id]");
    if (!button) return;
    state[collectionName] = state[collectionName].filter((item) => item.id !== button.dataset.removeId);
    if (collectionName === "parties") {
      reconcilePartyShareVisibility(state);
      elements.showPartyShare.checked = state.partySettings.showShare;
    }
    rerender();
    renderPreview();
  });
}

function renderAllEditors() {
  renderCaseTypeControls();
  renderPartyEditor();
  renderProgressEditor();
  renderLandEditor();
  renderBuildingEditor();
  renderCommonPartEditor();
  syncBuildingMetaInputs();
}

function renderCaseTypeControls() {
  elements.otherCaseTypeField.hidden = state.caseInfo.caseType !== "other";
  elements.mortgagePartyOption.hidden = state.caseInfo.caseType !== "mortgage";
}

function renderPartyEditor() {
  const roles = getPartyRoleSuggestions(state.caseInfo.caseType);
  elements.partyRoleOptions.innerHTML = roles.map((role) => `<option value="${escapeAttribute(role)}"></option>`).join("");
  elements.partyEmpty.hidden = state.parties.length > 0;
  elements.partyRows.innerHTML = state.parties.map((item) => `<tr>
    <td>${editorInput(item, "title", roles.length ? "請選擇或輸入" : "自訂稱謂", "text", "partyRoleOptions")}</td>
    <td>${editorInput(item, "name")}${partyImportWarning(item)}</td>
    <td>${editorInput(item, "birthDate", "例如 75.03.12")}</td>
    <td>${editorInput(item, "idNumber")}</td>
    <td class="wide-editor-cell">${editorInput(item, "address")}</td>
    <td>${editorInput(item, "share", "例如 土：1/2　建：1/2000")}</td>
    <td>${editorInput(item, "phoneNote")}</td>
    <td><button class="text-button" type="button" data-remove-id="${item.id}">刪除</button></td>
  </tr>`).join("");
}

function partyImportWarning(item) {
  const messages = [];
  if (item.sourceRoleHint) messages.push(item.sourceRoleHint);
  if (item.identityNeedsConfirmation) messages.push("證號缺漏，未自動與同名者合併");
  if (item.identityConflict) messages.push("相同證號的姓名資料衝突，請人工確認");
  return messages.map((message) => `<small class="record-warning">${escapeHtml(message)}</small>`).join("");
}

function renderProgressEditor() {
  const groups = getProgressGroups(state.caseInfo.caseType);
  if (!groups.length) {
    elements.progressEditor.innerHTML = `<p class="empty-state">${state.caseInfo.caseType ? "此案件類型尚未設定自動進度規則。" : "請先選擇案件類型。"}</p>`;
    return;
  }
  elements.progressEditor.innerHTML = groups.map((group) => `<section class="progress-editor-group">
    <h3>${escapeHtml(group.label)}</h3>
    <div class="progress-editor-grid">${group.items.map((item) => {
      const key = `${group.id}:${item.id}`;
      const label = item.editableLabel
        ? `<input class="progress-label-input" data-progress-key="${key}" data-progress-target="label" value="${escapeAttribute(state.progressLabels[key])}" aria-label="遺產稅進度項目名稱">`
        : `<span>${escapeHtml(item.label)}</span>`;
      return `<label class="progress-editor-item">${label}<input data-progress-key="${key}" data-progress-target="value" type="text" value="${escapeAttribute(state.progressValues[key])}" placeholder="民國日期"></label>`;
    }).join("")}</div>
  </section>`).join("");
}

function renderLandEditor() {
  elements.landEmpty.hidden = state.lands.length > 0;
  elements.landRows.innerHTML = state.lands.map((item) => `<tr>
    <td>${editorInput(item, "section", item.locationNeedsConfirmation ? "待確認" : "")}</td>
    <td>${editorInput(item, "subsection", item.locationNeedsConfirmation ? "待確認" : "")}</td>
    <td>${editorInput(item, "landNumber")}</td><td>${editorInput(item, "area", "", "decimal")}</td>
    <td>${editorInput(item, "announcedCurrentValue", "", "numeric")}</td>
    <td>${shareEditor(item)}</td><td>${editorInput(item, "totalCurrentValue", "待確認", "numeric")}</td>
    <td>${editorInput(item, "previousTransferText", "待確認")}</td>
    <td><button class="text-button" type="button" data-remove-id="${item.id}">刪除</button></td>
  </tr>`).join("");
}

function renderBuildingEditor() {
  elements.buildingEmpty.hidden = state.buildings.length > 0;
  elements.buildingRows.innerHTML = state.buildings.map((item) => `<tr>
    <td>${editorInput(item, "buildingNumber")}</td><td class="wide-editor-cell">${editorInput(item, "address")}${item.detailMappingNeedsConfirmation ? '<small class="record-warning">建物／附屬列對應待確認</small>' : ""}</td>
    <td>${editorInput(item, "floor")}</td><td>${editorInput(item, "area", "", "decimal")}</td>
    <td>${shareEditor(item)}</td><td>${editorInput(item, "accessoryText", item.detailMappingNeedsConfirmation ? "待確認" : "")}</td>
    <td>${editorInput(item, "currentValue", "待確認", "numeric")}</td>
    <td>${editorInput(item, "taxNumber", "待確認")}</td>
    <td><button class="text-button" type="button" data-remove-id="${item.id}">刪除</button></td>
  </tr>`).join("");
}

function renderCommonPartEditor() {
  elements.commonEmpty.hidden = state.commonParts.length > 0;
  elements.commonRows.innerHTML = state.commonParts.map((item) => `<tr>
    <td>${editorInput(item, "buildingNumber")}</td><td>${editorInput(item, "area", "", "decimal")}</td>
    <td>${shareEditor(item)}</td><td>${editorInput(item, "relatedMainBuildingNumber", item.relationStatus === "manual" ? "待確認" : "")}</td>
    <td><button class="text-button" type="button" data-remove-id="${item.id}">刪除</button></td>
  </tr>`).join("");
}

function editorInput(item, field, placeholder = "", inputMode = "text", list = "") {
  return `<input data-record-id="${item.id}" data-field="${field}" type="text" inputmode="${inputMode}" value="${escapeAttribute(item[field])}" placeholder="${escapeAttribute(placeholder)}"${list ? ` list="${list}"` : ""}>`;
}

function shareEditor(item) {
  return `<div class="compact-share-editor">${editorInput(item, "shareNumerator", "分子", "numeric")}<span>/</span>${editorInput(item, "shareDenominator", "分母", "numeric")}</div>`;
}

function ensureDebtorObligorPairs() {
  const snapshot = [...state.parties];
  snapshot.forEach((party) => {
    if (party.title !== "債務人" && party.title !== "義務人") return;
    const targetTitle = party.title === "債務人" ? "義務人" : "債務人";
    const hasPair = state.parties.some((candidate) => candidate.title === targetTitle && editablePartyIdentity(candidate) === editablePartyIdentity(party));
    if (!hasPair) addBlankParty(state, {
      title: targetTitle,
      titleManual: true,
      name: party.name,
      birthDate: party.birthDate,
      idNumber: party.idNumber,
      address: party.address,
      share: party.share,
      shareManual: party.shareManual,
      phoneNote: party.phoneNote,
      imported: false,
      sourceRoleHint: "由同一人選項建立；資料模型仍分別保存",
      importFingerprint: "",
      original: null,
      originalSources: [],
      interests: party.interests.map((item) => ({ ...item })),
    });
  });
}

function editablePartyIdentity(item) {
  return [item.name, item.birthDate, item.idNumber, item.address, item.share, item.phoneNote].join("|");
}

function syncCaseInputs() {
  elements.district.value = state.caseInfo.district;
  elements.caseNumber.value = state.caseInfo.caseNumber;
  elements.registrationReason.value = state.caseInfo.registrationReason;
  elements.reasonDate.value = state.caseInfo.reasonDate;
  elements.caseType.value = state.caseInfo.caseType;
  elements.otherCaseType.value = state.caseInfo.otherCaseType;
  elements.showPartyShare.checked = state.partySettings.showShare;
  elements.sameDebtorObligor.checked = state.partySettings.mergeDebtorAndObligor;
  renderCaseTypeControls();
}

function syncBuildingMetaInputs() {
  elements.material.value = state.buildingMeta.material;
  elements.totalFloors.value = state.buildingMeta.totalFloors;
}

function renderPreview() {
  elements.sheet.innerHTML = renderCaseCard(state);
  requestAnimationFrame(scalePreview);
}

function bindPrint() {
  const prepare = () => preparePrintableCaseCard(elements.printRoot, renderCaseCard(state));
  elements.printButton.addEventListener("click", () => {
    prepare();
    document.title = `${(state.caseInfo.caseNumber || "案件資料卡").replace(/[\\/:*?"<>|]/g, "_")}_案件資料卡`;
    requestAnimationFrame(() => window.print());
  });
  window.addEventListener("beforeprint", prepare);
  window.addEventListener("afterprint", () => { elements.printRoot.replaceChildren(); });
}

function scalePreview() {
  elements.sheet.style.transform = "none";
  const preview = elements.viewport.parentElement;
  const availableWidth = Math.max(280, preview.clientWidth - 64);
  const naturalWidth = elements.sheet.offsetWidth;
  const scale = Math.min(1, availableWidth / naturalWidth);
  elements.sheet.style.transform = `scale(${scale})`;
  elements.viewport.style.width = `${naturalWidth * scale}px`;
  elements.viewport.style.height = `${elements.sheet.scrollHeight * scale}px`;
}

if ("ResizeObserver" in window) {
  new ResizeObserver(scalePreview).observe(elements.viewport.parentElement);
} else {
  window.addEventListener("resize", scalePreview);
}

function warningSuffix(warnings) {
  return warnings.length ? `（${warnings.length} 項需確認）` : "";
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
