import {
  addAuthorizationAgentSnapshots,
  buildHouseTaxPreviewData,
  buildRealPricePreviewData,
  createAuthorizationDocumentState,
  getHouseTaxPrincipalCandidates,
  getRealPriceLayoutRule,
  loadAgents,
  removeAgent,
  resolveDocumentAgent,
  restoreAuthorizationAgentSnapshots,
  saveAgents,
  syncAuthorizationDefaults,
  upsertAgent,
} from "./case-document-authorizations.js";
import { createHouseTaxPdfController } from "./house-tax-pdf-app.js";
import { createRealPricePdfController } from "./real-price-pdf-app.js";
import { mountRealPriceFilingWorkspace } from "./real-price-filing-app.js";

export function mountCaseAuthorizationWorkspace(caseState, doc = document, storage = globalThis.localStorage, { onCaseChange = () => {} } = {}) {
  const root = doc.querySelector("#authorizationWorkspace");
  if (!root) return { render() {}, getCaseData: () => null, restoreCaseData() {}, clearCaseData() {} };

  const documents = createAuthorizationDocumentState();
  let agents = loadAgents(storage);
  let editingAgentId = "";
  const elements = collectElements(doc);
  const houseTaxPdf = createHouseTaxPdfController({
    preview: elements.houseOfficialPreview,
    placeholder: elements.houseOfficialPlaceholder,
    status: elements.houseOfficialStatus,
    download: elements.houseDownload,
    print: elements.housePrint,
  }, doc.defaultView || globalThis);
  const realPricePdf = createRealPricePdfController({
    preview: elements.realOfficialPreview,
    placeholder: elements.realOfficialPlaceholder,
    status: elements.realOfficialStatus,
    download: elements.realDownload,
    print: elements.realPrint,
  }, doc.defaultView || globalThis);
  const realPriceFiling = mountRealPriceFilingWorkspace({
    caseState,
    getAgents: () => agents.map((item) => ({ ...item })),
    storage,
    doc,
    onChange: onCaseChange,
  });

  bindAgentManager();
  bindHouseTaxEditor();
  bindRealPriceEditor();
  render();

  return {
    render,
    documents,
    getAgents: () => agents.map((item) => ({ ...item })),
    getCaseData: () => ({ authorizationDocuments: addAuthorizationAgentSnapshots(documents, agents), realPriceFiling: realPriceFiling.getDraft() }),
    restoreCaseData(value = {}) {
      replaceObject(documents, restoreAuthorizationAgentSnapshots(value.authorizationDocuments, agents));
      realPriceFiling.replaceDraft(value.realPriceFiling);
      render();
    },
    clearCaseData() {
      replaceObject(documents, createAuthorizationDocumentState());
      realPriceFiling.clearCurrentDraft();
      render();
    },
  };

  function render() {
    const map = syncAuthorizationDefaults(caseState, documents);
    renderAgentList();
    renderAgentSelects();
    renderHouseTax(map);
    renderRealPrice(map);
    renderSharedMapping(map);
    realPriceFiling.render();
  }

  function bindAgentManager() {
    elements.agentForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = {
        id: editingAgentId,
        name: elements.agentName.value,
        idNumber: elements.agentIdNumber.value,
        phone: elements.agentPhone.value,
        email: elements.agentEmail.value,
        address: elements.agentAddress.value,
      };
      if (!input.name.trim()) {
        elements.agentName.focus();
        return;
      }
      agents = upsertAgent(agents, input);
      saveAgents(agents, storage);
      resetAgentForm();
      render();
    });
    elements.agentCancel.addEventListener("click", resetAgentForm);
    elements.agentList.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit-agent]");
      const remove = event.target.closest("[data-delete-agent]");
      if (edit) {
        const agent = agents.find((item) => item.id === edit.dataset.editAgent);
        if (!agent) return;
        editingAgentId = agent.id;
        elements.agentName.value = agent.name;
        elements.agentIdNumber.value = agent.idNumber;
        elements.agentPhone.value = agent.phone;
        elements.agentEmail.value = agent.email;
        elements.agentAddress.value = agent.address;
        elements.agentSubmit.textContent = "儲存修改";
        elements.agentCancel.hidden = false;
        elements.agentName.focus();
      }
      if (remove) {
        const agent = agents.find((item) => item.id === remove.dataset.deleteAgent);
        if (!agent || !globalThis.confirm(`刪除常用代理人「${agent.name}」？`)) return;
        agents = removeAgent(agents, agent.id);
        [documents.houseTax, documents.realPrice].forEach((item) => {
          if (item.agentId === agent.id) item.agentId = "";
        });
        saveAgents(agents, storage);
        if (editingAgentId === agent.id) resetAgentForm();
        render();
      }
    });
  }

  function bindHouseTaxEditor() {
    elements.housePrincipal.addEventListener("change", () => {
      documents.houseTax.principalPartyId = elements.housePrincipal.value;
      renderHouseTaxDetails();
    });
    elements.houseBuildings.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-house-building-id]");
      if (!checkbox) return;
      const selected = new Set(documents.houseTax.buildingIds);
      checkbox.checked ? selected.add(checkbox.dataset.houseBuildingId) : selected.delete(checkbox.dataset.houseBuildingId);
      documents.houseTax.buildingIds = [...selected];
      renderHouseTaxDetails();
    });
    elements.houseCertificate.addEventListener("change", () => {
      documents.houseTax.applicationItems = elements.houseCertificate.checked ? ["房屋稅稅籍證明"] : [];
      renderHouseTaxDetails();
    });
    bindAgentControls("house", documents.houseTax);
  }

  function bindRealPriceEditor() {
    bindAgentControls("real", documents.realPrice);
    bindText(elements.realCity, documents.realPrice, "city", () => {
      documents.realPrice.locationManual = true;
      renderRealPriceDetails();
    });
    bindText(elements.realDistrict, documents.realPrice, "district", () => {
      documents.realPrice.locationManual = true;
      renderRealPriceDetails();
    });
    bindText(elements.realProperty, documents.realPrice, "propertyDescription", () => {
      documents.realPrice.propertyDescriptionManual = true;
      renderRealPriceDetails();
    });
    elements.realPropertyFontMode.addEventListener("change", () => {
      documents.realPrice.propertyFontMode = elements.realPropertyFontMode.value;
      renderRealPriceFontControls();
      renderRealPriceDetails();
    });
    elements.realPropertyFontSize.addEventListener("change", () => {
      documents.realPrice.propertyFontSize = Number(elements.realPropertyFontSize.value);
      renderRealPriceDetails();
    });
    bindText(elements.realMatter, documents.realPrice, "matter", renderRealPriceDetails);
  }

  function bindAgentControls(prefix, state) {
    const mode = prefix === "house" ? elements.houseAgentMode : elements.realAgentMode;
    const select = prefix === "house" ? elements.houseAgent : elements.realAgent;
    const manual = prefix === "house" ? elements.houseManualAgent : elements.realManualAgent;
    mode.addEventListener("change", () => {
      state.agentMode = mode.value;
      renderAgentSelects();
      prefix === "house" ? renderHouseTaxDetails() : renderRealPriceDetails();
    });
    select.addEventListener("change", () => {
      state.agentId = select.value;
      prefix === "house" ? renderHouseTaxDetails() : renderRealPriceDetails();
    });
    manual.addEventListener("input", (event) => {
      const input = event.target.closest("[data-agent-field]");
      if (!input) return;
      state.manualAgent[input.dataset.agentField] = input.value;
      prefix === "house" ? renderHouseTaxDetails() : renderRealPriceDetails();
    });
  }

  function bindText(element, target, field, afterInput) {
    element.addEventListener("input", () => {
      target[field] = element.value;
      afterInput();
    });
  }

  function resetAgentForm() {
    editingAgentId = "";
    elements.agentForm.reset();
    elements.agentSubmit.textContent = "新增代理人";
    elements.agentCancel.hidden = true;
  }

  function renderAgentList() {
    elements.agentEmpty.hidden = agents.length > 0;
    elements.agentList.innerHTML = agents.map((agent) => `<article class="agent-card">
      <div><strong>${escapeHtml(agent.name)}</strong><span>${escapeHtml(agent.idNumber || "證號未填")}｜${escapeHtml(agent.phone || "電話未填")}</span><small>${escapeHtml(agent.address || "通訊地址未填")}${agent.email ? `｜${escapeHtml(agent.email)}` : ""}</small></div>
      <div class="agent-card-actions"><button type="button" class="text-button" data-edit-agent="${escapeAttribute(agent.id)}">編輯</button><button type="button" class="text-button" data-delete-agent="${escapeAttribute(agent.id)}">刪除</button></div>
    </article>`).join("");
  }

  function renderAgentSelects() {
    const options = `<option value="">請選擇常用代理人</option>${agents.map((agent) => `<option value="${escapeAttribute(agent.id)}">${escapeHtml(agent.name)}${agent.idNumber ? `｜${escapeHtml(agent.idNumber)}` : ""}</option>`).join("")}`;
    [
      [elements.houseAgentMode, elements.houseAgent, elements.houseManualAgent, documents.houseTax],
      [elements.realAgentMode, elements.realAgent, elements.realManualAgent, documents.realPrice],
    ].forEach(([mode, select, manual, state]) => {
      mode.value = state.agentMode;
      select.innerHTML = options;
      select.value = state.agentId;
      select.hidden = state.agentMode === "manual";
      manual.hidden = state.agentMode !== "manual";
      manual.querySelectorAll("[data-agent-field]").forEach((input) => { input.value = state.manualAgent[input.dataset.agentField]; });
    });
  }

  function renderHouseTax(map) {
    const candidates = getHouseTaxPrincipalCandidates(caseState);
    elements.housePrincipal.innerHTML = `<option value="">請選擇義務人</option>${candidates.map((party) => `<option value="${escapeAttribute(party.id)}">${escapeHtml(party.name || "姓名缺漏")}${party.idNumber ? `｜${escapeHtml(party.idNumber)}` : ""}</option>`).join("")}`;
    elements.housePrincipal.value = documents.houseTax.principalPartyId;
    elements.houseBuildings.innerHTML = map.buildings.length ? map.buildings.map((building) => `<label class="authorization-check-row"><input type="checkbox" data-house-building-id="${escapeAttribute(building.id)}" ${documents.houseTax.buildingIds.includes(building.id) ? "checked" : ""}><span><strong>${escapeHtml(building.buildingNumber || "建號缺漏")}</strong><small>${escapeHtml(building.address || "完整房屋坐落缺漏")}</small></span></label>`).join("") : '<p class="authorization-empty">案件中尚無建物資料。</p>';
    elements.houseCertificate.checked = documents.houseTax.applicationItems.includes("房屋稅稅籍證明");
    renderHouseTaxDetails();
  }

  function renderHouseTaxDetails() {
    const principal = getHouseTaxPrincipalCandidates(caseState).find((item) => item.id === documents.houseTax.principalPartyId);
    const preview = buildHouseTaxPreviewData(caseState, documents.houseTax, agents);
    elements.housePrincipalSummary.innerHTML = principal
      ? summaryRows([["姓名", principal.name], ["身分證統一編號", principal.idNumber], ["出生日期", principal.birthDate], ["地址", principal.address]])
      : '<p class="authorization-empty">只列出案件中的義務人；選定後會自動帶入姓名與證號。</p>';
    renderWarnings(elements.houseWarnings, preview.warnings);
    renderAgentSummary(elements.houseAgentSummary, resolveDocumentAgent(documents.houseTax, agents));
    renderHouseTaxPreview(elements.housePreview, preview);
    houseTaxPdf.schedule(preview);
  }

  function renderRealPrice(map) {
    const preview = buildRealPricePreviewData(caseState, documents.realPrice, agents);
    const entrustors = preview.entrustors;
    elements.realEntrustors.innerHTML = entrustors.length ? entrustors.map((party) => `<article class="entrustor-card"><span>${escapeHtml(party.title)}</span><strong>${escapeHtml(party.name || "姓名缺漏")}</strong><dl><div><dt>證號</dt><dd>${escapeHtml(party.idNumber || "缺漏")}</dd></div><div><dt>地址</dt><dd>${escapeHtml(party.address || "缺漏")}</dd></div><div><dt>電話</dt><dd>${escapeHtml(party.phone || "缺漏")}</dd></div></dl></article>`).join("") : '<p class="authorization-empty">案件中尚無適用的權利人或義務人。</p>';
    const rule = getRealPriceLayoutRule(caseState);
    elements.realLayoutRule.textContent = rule.label;
    elements.realLayoutRule.dataset.mode = rule.mode;
    elements.realCity.value = documents.realPrice.city;
    elements.realDistrict.value = documents.realPrice.district;
    elements.realProperty.value = documents.realPrice.propertyDescription;
    renderRealPriceFontControls();
    elements.realMatter.value = documents.realPrice.matter;
    renderRealPriceDetails();
  }

  function renderRealPriceFontControls() {
    const isManual = documents.realPrice.propertyFontMode === "manual";
    elements.realPropertyFontMode.value = isManual ? "manual" : "auto";
    elements.realPropertyFontSize.value = String(documents.realPrice.propertyFontSize);
    elements.realPropertyFontSize.disabled = !isManual;
    elements.realPropertyFontSizeField.classList.toggle("is-disabled", !isManual);
  }

  function renderRealPriceDetails() {
    const preview = buildRealPricePreviewData(caseState, documents.realPrice, agents);
    renderWarnings(elements.realWarnings, preview.warnings);
    renderAgentSummary(elements.realAgentSummary, preview.agent);
    renderRealPricePreview(elements.realPreview, preview);
    realPricePdf.schedule(preview);
  }

  function renderSharedMapping(map) {
    const values = [
      ["委任／委託人", "案件當事人：稱謂、姓名、生日、證號、地址、電話", `${map.parties.rights.length} 位權利人、${map.parties.obligors.length} 位義務人`],
      ["房屋坐落", "建物：完整門牌地址", map.buildings.map((item) => item.address).filter(Boolean).join("；")],
      ["土地標示", "土地：行政區、段、小段、地號", map.lands.map((item) => item.label).filter(Boolean).join("；")],
      ["建物標示", "建物：建號、完整門牌地址", map.buildings.map((item) => item.label).filter(Boolean).join("；")],
      ["登記資料", "案件：登記原因、原因日期", [map.registration.reason, map.registration.reasonDate].filter(Boolean).join("｜")],
      ["縣市／行政區", "建物完整地址與案件區域（僅唯一值自動帶入）", [map.location.city, map.location.district].filter(Boolean).join("｜")],
    ];
    elements.sharedMapping.innerHTML = values.map(([target, source, value]) => `<tr><th scope="row">${escapeHtml(target)}</th><td>${escapeHtml(source)}</td><td>${escapeHtml(value || "缺漏，需手動填寫")}</td></tr>`).join("");
  }
}

function collectElements(doc) {
  const byId = (id) => doc.getElementById(id);
  return {
    agentForm: byId("agentForm"), agentName: byId("agentName"), agentIdNumber: byId("agentIdNumber"),
    agentPhone: byId("agentPhone"), agentEmail: byId("agentEmail"), agentAddress: byId("agentAddress"), agentSubmit: byId("agentSubmit"),
    agentCancel: byId("agentCancel"), agentList: byId("agentList"), agentEmpty: byId("agentEmpty"),
    housePrincipal: byId("houseTaxPrincipal"), housePrincipalSummary: byId("houseTaxPrincipalSummary"),
    houseBuildings: byId("houseTaxBuildings"), houseCertificate: byId("houseTaxCertificate"),
    houseAgentMode: byId("houseTaxAgentMode"), houseAgent: byId("houseTaxAgent"), houseManualAgent: byId("houseTaxManualAgent"),
    houseAgentSummary: byId("houseTaxAgentSummary"), houseWarnings: byId("houseTaxWarnings"), housePreview: byId("houseTaxDataPreview"),
    houseOfficialPreview: byId("houseTaxOfficialPreview"), houseOfficialPlaceholder: byId("houseTaxOfficialPlaceholder"),
    houseOfficialStatus: byId("houseTaxOfficialStatus"), houseDownload: byId("downloadHouseTaxPdf"), housePrint: byId("printHouseTaxPdf"),
    realEntrustors: byId("realPriceEntrustors"), realLayoutRule: byId("realPriceLayoutRule"),
    realAgentMode: byId("realPriceAgentMode"), realAgent: byId("realPriceAgent"), realManualAgent: byId("realPriceManualAgent"),
    realAgentSummary: byId("realPriceAgentSummary"), realCity: byId("realPriceCity"), realDistrict: byId("realPriceDistrict"),
    realProperty: byId("realPriceProperty"), realMatter: byId("realPriceMatter"),
    realPropertyFontMode: byId("realPricePropertyFontMode"), realPropertyFontSize: byId("realPricePropertyFontSize"),
    realPropertyFontSizeField: byId("realPricePropertyFontSizeField"),
    realWarnings: byId("realPriceWarnings"), realPreview: byId("realPriceDataPreview"),
    realOfficialPreview: byId("realPriceOfficialPreview"), realOfficialPlaceholder: byId("realPriceOfficialPlaceholder"),
    realOfficialStatus: byId("realPriceOfficialStatus"), realDownload: byId("downloadRealPricePdf"), realPrint: byId("printRealPricePdf"),
    sharedMapping: byId("sharedFieldMappingRows"),
  };
}

function replaceObject(target, source) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, structuredClone(source));
}

function renderHouseTaxPreview(element, preview) {
  element.innerHTML = `<div class="document-data-preview-header"><div><span>資料內容預覽</span><strong>房屋稅籍查詢委任書</strong></div><small>非政府書表版面，不供列印</small></div>
    <section class="document-preview-section"><h4>委任人</h4>${preview.principal
      ? previewParty(preview.principal)
      : previewMissing("尚未選擇義務人")}</section>
    <section class="document-preview-section"><h4>代理人</h4>${preview.agent.name
      ? previewParty(preview.agent, { addressLabel: "通訊地址" })
      : previewMissing("尚未選擇或輸入代理人")}</section>
    <section class="document-preview-section"><h4>申請內容</h4>${previewRows([
      ["勾選項目", preview.applicationItems.join("、")],
      ["申請建物", preview.buildings.map((item) => item.label).join("\n")],
    ])}</section>
    ${previewWarningBlock(preview.warnings)}`;
}

function renderRealPricePreview(element, preview) {
  element.innerHTML = `<div class="document-data-preview-header"><div><span>資料內容預覽</span><strong>實價登錄委託書</strong></div><small>非政府書表版面，不供列印</small></div>
    <section class="document-preview-section"><h4>全體委託人</h4><div class="document-preview-party-list">${preview.entrustors.length
      ? preview.entrustors.map((party) => previewParty(party)).join("")
      : previewMissing("尚無適用的權利人或義務人")}</div></section>
    <section class="document-preview-section"><h4>受託人</h4>${preview.agent.name
      ? previewParty(preview.agent, { addressLabel: "通訊地址" })
      : previewMissing("尚未選擇或輸入受託人")}</section>
    <section class="document-preview-section"><h4>委託內容</h4>${previewRows([
      ["版面規則", preview.layoutRule.label],
      ["縣市／行政區", [preview.city, preview.district].filter(Boolean).join(" ")],
      ["不動產標的", preview.propertyDescription],
      ["標的字級", preview.propertyFontMode === "manual" ? `手動 ${preview.propertyFontSize}pt` : "自動調整（12～9pt）"],
      ["勾選／委託事項", preview.matter || "全部不勾"],
    ])}</section>
    ${previewWarningBlock(preview.warnings)}`;
}

function previewParty(party, { addressLabel = "地址" } = {}) {
  return `<article class="document-preview-party"><div><span>${escapeHtml(party.title || "")}</span><strong>${previewValue(party.name)}</strong></div>${previewRows([
    ["身分證統一編號", party.idNumber],
    ...(Object.hasOwn(party, "birthDate") ? [["出生日期", party.birthDate]] : []),
    [addressLabel, party.address],
    ...(Object.hasOwn(party, "phone") ? [["電話", party.phone]] : []),
  ])}</article>`;
}

function previewRows(rows) {
  return `<dl class="document-preview-values">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd class="${value ? "" : "is-missing"}">${previewMultiline(value)}</dd></div>`).join("")}</dl>`;
}

function previewWarningBlock(warnings) {
  return warnings.length
    ? `<section class="document-preview-missing"><h4>缺漏提示</h4><ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
    : '<section class="document-preview-missing is-complete"><h4>缺漏提示</h4><p>目前設定沒有已知缺漏。</p></section>';
}

function previewMissing(message) {
  return `<p class="document-preview-empty">${escapeHtml(message)}</p>`;
}

function previewValue(value) {
  return escapeHtml(value || "未填寫");
}

function previewMultiline(value) {
  if (!value) return "未填寫";
  return String(value).split("\n").map(escapeHtml).join("<br>");
}

function renderWarnings(element, warnings) {
  element.innerHTML = warnings.length
    ? `<strong>缺漏資料提醒</strong><ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<strong>欄位檢查完成</strong><p>目前設定沒有已知缺漏。</p>";
  element.classList.toggle("is-complete", warnings.length === 0);
}

function renderAgentSummary(element, agent) {
  element.innerHTML = agent.name
    ? summaryRows([["姓名", agent.name], ["證號", agent.idNumber], ["電話", agent.phone], ["通訊地址", agent.address]])
    : '<p class="authorization-empty">尚未選擇或輸入代理人。</p>';
}

function summaryRows(rows) {
  return `<dl class="authorization-summary-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "缺漏")}</dd></div>`).join("")}</dl>`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
