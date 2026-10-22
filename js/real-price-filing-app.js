import {
  CAR_FLOORS,
  CAR_TYPES,
  COMMON_FILING_NOTE,
  GOVERNMENT_CODE_SOURCE,
  GOVERNMENT_SECTION_SOURCE,
  SPECIAL_OPTIONS,
  buildRealPriceGovernmentJson,
  clearRealPriceFilingDraft,
  copyCaseTargetsToConditionalList,
  createCandidateBasename,
  createRealPriceFilingDraft,
  createSingleFileZip,
  getOfficeCandidates,
  loadRealPriceFilingDraft,
  normalizeRealPriceFilingDraft,
  parseGovernmentCodeCsv,
  saveRealPriceFilingDraft,
  selectSavedFilingAgent,
  syncOfficeSuggestion,
  syncRealPriceFilingFromCase,
  validateRealPriceFiling,
} from "./real-price-filing.js";

export function mountRealPriceFilingWorkspace({ caseState, getAgents, storage = globalThis.localStorage, doc = document, onChange = () => {} }) {
  const root = doc.querySelector("#realPriceGovernmentFiling");
  if (!root) return { render() {}, getDraft: () => null, replaceDraft() {}, clearCurrentDraft() {} };

  let draft = loadRealPriceFilingDraft(storage);
  let codeRows = [];
  let sectionRows = [];
  let codeLoadError = "";
  let validationErrors = [];
  let savedAt = "";
  let advancedOpen = false;
  const openDetails = new Set();

  bindModeTabs(doc);
  bindRoot();
  loadCodes();
  render();
  return {
    render,
    getDraft: () => structuredClone(draft),
    replaceDraft(value) {
      draft = normalizeRealPriceFilingDraft(value);
      validationErrors = [];
      persist();
      render();
    },
    clearCurrentDraft() {
      clearRealPriceFilingDraft(storage);
      draft = createRealPriceFilingDraft();
      validationErrors = [];
      savedAt = "";
      if (codeRows.length) syncRealPriceFilingFromCase(draft, caseState, codeRows);
      render();
    },
  };

  async function loadCodes() {
    try {
      const [codeResponse, sectionResponse] = await Promise.all([
        fetch(GOVERNMENT_CODE_SOURCE.file, { cache: "no-cache" }),
        fetch(GOVERNMENT_SECTION_SOURCE.file, { cache: "no-cache" }),
      ]);
      if (!codeResponse.ok || !sectionResponse.ok) throw new Error(`HTTP ${codeResponse.status}/${sectionResponse.status}`);
      codeRows = parseGovernmentCodeCsv(await codeResponse.text());
      sectionRows = (await sectionResponse.json()).sections || [];
      syncRealPriceFilingFromCase(draft, caseState, codeRows);
      persist();
      render();
    } catch (error) {
      codeLoadError = `官方代碼快照讀取失敗：${error.message}`;
      render();
    }
  }

  function bindRoot() {
    root.addEventListener("input", (event) => {
      const input = event.target.closest("[data-draft-path]");
      if (!input) return;
      setPath(draft, input.dataset.draftPath, input.type === "checkbox" ? input.checked : input.value);
      markManual(input);
      persist();
      onChange();
      updatePassiveViews();
    });

    root.addEventListener("change", (event) => {
      const input = event.target.closest("[data-draft-path]");
      if (!input) return;
      setPath(draft, input.dataset.draftPath, input.type === "checkbox" ? input.checked : input.value);
      markManual(input);
      applySelectionMetadata(input);
      onChange();
      if (input.dataset.rerender !== "false") render();
      else { persist(); updatePassiveViews(); }
    });

    root.addEventListener("toggle", (event) => {
      const details = event.target.closest("details[data-details-key]");
      if (!details) return;
      details.open ? openDetails.add(details.dataset.detailsKey) : openDetails.delete(details.dataset.detailsKey);
    }, true);

    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filing-action], [data-error-key]");
      if (!button) return;
      if (button.dataset.errorKey) {
        const target = root.querySelector(`[data-focus-key="${cssEscape(button.dataset.errorKey)}"]`);
        const dialog = target?.closest("dialog");
        if (dialog && !dialog.open) { advancedOpen = true; dialog.showModal(); }
        target?.focus();
        return;
      }
      const action = button.dataset.filingAction;
      if (action === "clear-draft") clearDraft();
      if (action === "add-parking") { draft.parking.items.push(blankParking()); persist(); onChange(); render(); }
      if (action === "remove-parking") { draft.parking.items.splice(Number(button.dataset.index), 1); persist(); onChange(); render(); }
      if (action === "add-party") { draft[button.dataset.partyGroup].push(blankParty()); persist(); onChange(); render(); }
      if (action === "remove-party") { draft[button.dataset.partyGroup].splice(Number(button.dataset.index), 1); persist(); onChange(); render(); }
      if (action === "copy-list") {
        copyCaseTargetsToConditionalList(draft, caseState, button.dataset.listType);
        persist(); onChange(); render();
      }
      if (action === "add-list") { draft.lists[button.dataset.listType].items.push(blankListItem()); persist(); onChange(); render(); }
      if (action === "remove-list") { draft.lists[button.dataset.listType].items.splice(Number(button.dataset.index), 1); persist(); onChange(); render(); }
      if (action === "open-advanced") { advancedOpen = true; root.querySelector("#filingAdvancedDialog")?.showModal(); }
      if (action === "close-advanced") { advancedOpen = false; root.querySelector("#filingAdvancedDialog")?.close(); }
      if (action === "download-json") downloadCandidate("json");
      if (action === "download-zip") downloadCandidate("zip");
    });
    root.addEventListener("close", (event) => {
      if (event.target.id === "filingAdvancedDialog") advancedOpen = false;
    }, true);
  }

  function render() {
    if (codeRows.length) {
      const transactionBeforeSync = JSON.stringify(draft.transaction);
      syncRealPriceFilingFromCase(draft, caseState, codeRows);
      if (transactionBeforeSync !== JSON.stringify(draft.transaction)) persist();
    }
    const agents = getAgents();
    root.innerHTML = `<section class="section filing-hero" aria-labelledby="government-filing-title">
      <div class="section-heading section-heading-inline">
        <div><p class="filing-kicker">PHASE 4B｜候選規格</p><h2 id="government-filing-title">政府實價登錄申報檔</h2><p>資料只在瀏覽器端編輯與壓縮，不會連線申報或送件。</p></div>
        <span class="candidate-badge">尚未完成政府系統匯入驗證</span>
      </div>
      <div class="filing-draft-bar"><div><strong>本機草稿</strong><span id="filingDraftStatus">${savedAt ? `已暫存於此瀏覽器（${escapeHtml(savedAt)}）` : "尚未變更"}</span></div><button class="btn btn-secondary" type="button" data-filing-action="clear-draft">清除申報草稿</button></div>
      <p class="filing-local-warning">無痕模式、瀏覽器清除網站資料或更換裝置，可能使草稿消失。草稿與案件資料卡、房屋稅籍 PDF、委託書 PDF 的設定彼此獨立。</p>
      ${codeLoadError ? `<p class="filing-code-error">${escapeHtml(codeLoadError)}</p>` : ""}
      <p class="filing-code-source">管轄代碼：${escapeHtml(GOVERNMENT_CODE_SOURCE.title)}（${escapeHtml(GOVERNMENT_CODE_SOURCE.versionDate)}）；段小段：${escapeHtml(GOVERNMENT_SECTION_SOURCE.title)}（${escapeHtml(GOVERNMENT_SECTION_SOURCE.versionDate)}）。</p>
    </section>
    ${renderLocationSection()}
    ${renderTransactionSection()}
    ${renderPartySection()}
    ${renderAgentSection(agents)}
    ${renderConditionsSection()}
    ${renderDownloadSection()}`;
    restoreOpenDetails();
    if (advancedOpen) queueMicrotask(() => root.querySelector("#filingAdvancedDialog")?.showModal());
    updatePassiveViews();
  }

  function renderLocationSection() {
    const cities = uniqueBy(codeRows, (row) => row.cityCode);
    const districts = uniqueBy(codeRows.filter((row) => row.cityCode === draft.location.cityCode), (row) => row.districtCode);
    const offices = getOfficeCandidates(draft, codeRows);
    const officeHint = offices.length === 1 ? "唯一明確管轄結果，已自動預選。" : offices.length > 1 ? "此行政區有多個候選地所，請手動確認。" : "尚無可確認的地所候選。";
    return `<section class="section filing-section" aria-labelledby="filing-location-title">
      <div class="section-heading"><span class="filing-step">01</span><h2 id="filing-location-title">案件／管轄資訊</h2><p>土地坐落可精確對上官方代碼時自動帶入；所有欄位仍可修改。</p></div>
      <div class="filing-grid three">
        <label class="field"><span>縣市</span><select class="form-select" data-draft-path="location.cityCode" data-focus-key="location"><option value="">請選擇</option>${options(cities, "cityCode", "cityName", draft.location.cityCode)}</select></label>
        <label class="field"><span>行政區</span><select class="form-select" data-draft-path="location.districtCode" data-focus-key="location"><option value="">請選擇</option>${options(districts, "districtCode", "districtName", draft.location.districtCode)}</select></label>
        <label class="field"><span>地政事務所</span><select class="form-select" data-draft-path="location.officeCode" data-focus-key="office"><option value="">請選擇</option>${options(offices, "officeCode", "officeName", draft.location.officeCode)}</select><small>${escapeHtml(officeHint)}</small></label>
      </div>
    </section>`;
  }

  function renderTransactionSection() {
    return `<section class="section filing-section" aria-labelledby="filing-transaction-title">
      <div class="section-heading"><span class="filing-step">02</span><h2 id="filing-transaction-title">私契日期與成交金額</h2><p>這裡不會使用案件的登記原因日期、公告現值或房屋現值。</p></div>
      <div class="filing-grid three">
        <label class="field"><span>申報人身分（case_kind）</span><select class="form-select" data-draft-path="applicantKind" data-focus-key="applicantKind"><option value="">請明確選擇</option><option value="13" ${selected(draft.applicantKind, "13")}>買方申報（13）</option><option value="15" ${selected(draft.applicantKind, "15")}>賣方申報（15）</option><option value="16" ${selected(draft.applicantKind, "16")}>代理人申報（16）</option></select><small>不依是否有代理人資料推斷。</small></label>
        <label class="field"><span>私契日期（民國 YYYMMDD）</span><input inputmode="numeric" maxlength="7" placeholder="例如 1151022" value="${attr(draft.transaction.contractDate)}" data-draft-path="transaction.contractDate" data-rerender="false" data-focus-key="contractDate"></label>
        <label class="field"><span>成交總價（新臺幣元）</span><input inputmode="numeric" placeholder="請填實際成交總價" value="${attr(draft.transaction.totalPrice)}" data-draft-path="transaction.totalPrice" data-rerender="false" data-focus-key="totalPrice"></label>
        <label class="field"><span>交易標的類型</span><select class="form-select" data-draft-path="transaction.propertyType" data-focus-key="propertyType"><option value="">請確認</option><option value="normal" ${selected(draft.transaction.propertyType, "normal")}>土地及／或建物一般交易</option><option value="land-only" ${selected(draft.transaction.propertyType, "land-only")}>僅土地交易</option><option value="parking-only" ${selected(draft.transaction.propertyType, "parking-only")}>僅車位交易</option></select>${draft.transaction.propertyTypeHint ? `<small class="filing-inference-warning">${escapeHtml(draft.transaction.propertyTypeHint)}</small>` : ""}</label>
      </div>
    </section>`;
  }

  function renderPartySection() {
    return `<section class="section filing-section" aria-labelledby="filing-parties-title">
      <div class="section-heading"><span class="filing-step">03</span><h2 id="filing-parties-title">買方／賣方</h2><p>依案件權利人、義務人去重後複製；此處修改不會覆寫案件原值。</p></div>
      <div class="filing-party-columns"><div><div class="filing-list-heading"><h3>買方（權利人）</h3><button class="btn btn-secondary" type="button" data-filing-action="add-party" data-party-group="buyers">＋ 新增買方</button></div>${renderPartyCards("buyers", draft.buyers)}</div><div><div class="filing-list-heading"><h3>賣方（義務人）</h3><button class="btn btn-secondary" type="button" data-filing-action="add-party" data-party-group="sellers">＋ 新增賣方</button></div>${renderPartyCards("sellers", draft.sellers)}</div></div>
    </section>`;
  }

  function renderPartyCards(group, parties) {
    if (!parties.length) return `<p class="filing-empty" data-focus-key="${group}">案件中尚無可帶入資料。</p>`;
    return parties.map((party, index) => {
      const cities = uniqueBy(codeRows, (row) => row.cityCode);
      const districts = uniqueBy(codeRows.filter((row) => row.cityCode === party.cityCode), (row) => row.districtCode);
      return `<article class="filing-person-card" data-focus-key="${group === "buyers" ? "buyer" : "seller"}-${index}"><div class="filing-list-heading"><strong>${group === "buyers" ? "買方" : "賣方"} ${index + 1}</strong>${String(party.sourceId || "").startsWith("manual-") ? `<button type="button" class="text-button" data-filing-action="remove-party" data-party-group="${group}" data-index="${index}">移除</button>` : ""}</div>
        <div class="filing-grid two">
          ${textField("姓名", `${group}.${index}.name`, party.name, { manualGroup: group, index, focus: `${group === "buyers" ? "buyer" : "seller"}-${index}` })}
          ${textField("證號／統編", `${group}.${index}.idNumber`, party.idNumber, { manualGroup: group, index })}
          ${textField("電話", `${group}.${index}.phone`, party.phone, { manualGroup: group, index })}
          ${textField("Email（選填）", `${group}.${index}.email`, party.email, { manualGroup: group, index, type: "email" })}
          <label class="field"><span>地址縣市</span><select class="form-select" data-draft-path="${group}.${index}.cityCode" data-party-group="${group}" data-party-index="${index}" data-manual-field="cityCode"><option value="">請選擇</option>${options(cities, "cityCode", "cityName", party.cityCode)}</select></label>
          <label class="field"><span>地址行政區</span><select class="form-select" data-draft-path="${group}.${index}.districtCode" data-party-group="${group}" data-party-index="${index}" data-manual-field="districtCode"><option value="">請選擇</option>${options(districts, "districtCode", "districtName", party.districtCode)}</select></label>
          <label class="field field-wide"><span>其餘地址</span><input value="${attr(party.addressRemainder)}" data-draft-path="${group}.${index}.addressRemainder" data-party-group="${group}" data-party-index="${index}" data-manual-field="addressRemainder" data-rerender="false"></label>
        </div></article>`;
    }).join("");
  }

  function renderAgentSection(agents) {
    const agentCities = uniqueBy(codeRows, (row) => row.cityCode);
    const agentDistricts = uniqueBy(codeRows.filter((row) => row.cityCode === draft.agent.cityCode), (row) => row.districtCode);
    return `<section class="section filing-section" aria-labelledby="filing-agent-title">
      <div class="section-heading"><span class="filing-step">04</span><h2 id="filing-agent-title">申報代理人</h2><p>常用代理人只作為複製來源；Email 與申報聯絡資料獨立儲存在本機草稿。</p></div>
      <label class="check-field filing-toggle"><input type="checkbox" ${draft.agent.enabled ? "checked" : ""} data-draft-path="agent.enabled" data-focus-key="agentEnabled"> 本案使用申報代理人</label>
      ${draft.agent.enabled ? `<div class="filing-grid three">
        <label class="field"><span>資料來源</span><select class="form-select" data-draft-path="agent.source"><option value="saved" ${selected(draft.agent.source, "saved")}>常用代理人</option><option value="manual" ${selected(draft.agent.source, "manual")}>手動輸入</option></select></label>
        ${draft.agent.source === "saved" ? `<label class="field"><span>常用代理人</span><select class="form-select" data-draft-path="agent.savedId"><option value="">請選擇</option>${agents.map((agent) => `<option value="${attr(agent.id)}" ${selected(draft.agent.savedId, agent.id)}>${escapeHtml(agent.name)}${agent.idNumber ? `｜${escapeHtml(agent.idNumber)}` : ""}</option>`).join("")}</select></label>` : ""}
        <label class="field"><span>委任關係</span><select class="form-select" data-draft-path="agent.entrustType"><option value="">請確認</option><option value="2" ${selected(draft.agent.entrustType, "2")}>現行候選代碼 2</option></select></label>
        ${textField("姓名", "agent.name", draft.agent.name, { focus: "agent" })}
        ${textField("證號／統編", "agent.idNumber", draft.agent.idNumber)}
        ${textField("電話", "agent.phone", draft.agent.phone)}
        ${textField("Email（選填）", "agent.email", draft.agent.email, { type: "email" })}
        <label class="field"><span>地址縣市</span><select class="form-select" data-draft-path="agent.cityCode"><option value="">請選擇</option>${options(agentCities, "cityCode", "cityName", draft.agent.cityCode)}</select></label>
        <label class="field"><span>地址行政區</span><select class="form-select" data-draft-path="agent.districtCode"><option value="">請選擇</option>${options(agentDistricts, "districtCode", "districtName", draft.agent.districtCode)}</select></label>
        <label class="field field-wide"><span>其餘地址</span><input value="${attr(draft.agent.addressRemainder)}" data-draft-path="agent.addressRemainder" data-rerender="false"></label>
      </div>` : ""}
    </section>`;
  }

  function renderConditionsSection() {
    const normal = draft.transaction.propertyType === "normal";
    const parkingRelevant = Boolean(draft.transaction.propertyType) && draft.transaction.propertyType !== "land-only";
    const hasParking = draft.transaction.propertyType === "parking-only" || draft.parking.hasParking === "yes";
    return `<section class="section filing-section" aria-labelledby="filing-conditions-title">
      <div class="section-heading"><span class="filing-step">05</span><h2 id="filing-conditions-title">建物、車位及其他交易資料</h2><p>只顯示目前條件需要的常用欄位；備註與特殊清冊收在進階區。</p></div>
      ${normal ? `<div class="filing-subsection" data-focus-key="buildingLayout"><h3>建物格局</h3><div class="filing-grid four">
        ${numberField("房", "building.rooms", draft.building.rooms)}${numberField("廳", "building.halls", draft.building.halls)}${numberField("衛", "building.bathrooms", draft.building.bathrooms)}
        <label class="check-field"><input type="checkbox" ${draft.building.noPartitions ? "checked" : ""} data-draft-path="building.noPartitions"> 無隔間</label>
        ${binarySelect("管理組織", "building.management", draft.building.management, "buildingManagement")}${binarySelect("電梯", "building.elevator", draft.building.elevator, "buildingElevator")}
      </div></div>` : ""}
      ${parkingRelevant ? `<div class="filing-subsection" data-focus-key="parking"><h3>車位資訊</h3>
        ${draft.transaction.propertyType !== "parking-only" ? `<label class="field compact-field"><span>有無車位交易</span><select class="form-select" data-draft-path="parking.hasParking"><option value="">請確認</option><option value="no" ${selected(draft.parking.hasParking, "no")}>無</option><option value="yes" ${selected(draft.parking.hasParking, "yes")}>有</option></select></label>` : `<p class="filing-derived">僅車位交易：有車位與備註⑧由此明確選項同步產生。</p>`}
        ${hasParking ? renderParkingEditor() : ""}
      </div>` : ""}
      ${renderSimpleNote()}
      ${renderAdvancedDialog()}
    </section>`;
  }

  function renderSimpleNote() {
    const mode = draft.special.noteMode || "none";
    const advancedCount = countAdvancedSettings(draft);
    return `<div class="filing-note-block" data-focus-key="note">
      <div class="filing-note-heading"><div><h3>其他說明／備註</h3><p>輸出至政府 JSON 的 <code>p1ma_note</code>。</p></div><span class="filing-note-count" id="filingNoteCount">${String(draft.special.note || "").length}／200</span></div>
      <div class="filing-note-options" role="radiogroup" aria-label="其他說明選擇">
        <label><input type="radio" name="filing-note-mode" value="none" ${checked(mode, "none")} data-draft-path="special.noteMode"> 無備註</label>
        <label><input type="radio" name="filing-note-mode" value="common" ${checked(mode, "common")} data-draft-path="special.noteMode"> 新建案管委會籌組中</label>
        <label><input type="radio" name="filing-note-mode" value="custom" ${checked(mode, "custom")} data-draft-path="special.noteMode"> 自行填寫</label>
      </div>
      ${mode === "custom" ? `<label class="field filing-note-custom"><span>自行填寫（最多 200 字）</span><textarea maxlength="200" placeholder="請輸入其他說明" data-draft-path="special.note" data-rerender="false">${escapeHtml(draft.special.note)}</textarea></label>` : ""}
      <div class="filing-advanced-entry"><div><strong>依法應勾選的特殊交易項目</strong><p><code>p1ma_note</code> 不會取代 <code>p1sp_*</code>、非不動產費用或條件式清冊。</p></div><button class="text-button filing-advanced-button" id="filingAdvancedButton" type="button" data-filing-action="open-advanced">進階申報欄位${advancedCount ? `（已設定 ${advancedCount} 項）` : ""}</button></div>
    </div>`;
  }

  function renderAdvancedDialog() {
    return `<dialog id="filingAdvancedDialog" class="filing-advanced-dialog" aria-labelledby="filing-advanced-title">
      <div class="filing-advanced-dialog-heading"><div><span>非一般案件</span><h3 id="filing-advanced-title">進階申報欄位</h3></div><button type="button" class="text-button" data-filing-action="close-advanced" aria-label="關閉進階申報欄位">關閉</button></div>
      <p class="filing-local-warning">這些欄位只有在交易事實適用時才可勾選。其他說明不能代替依法應填的特殊交易代碼。</p>
      <div class="filing-advanced-body">
        <section><h4>成交總價包含的非不動產費用（備註①）</h4>${renderFees()}</section>
        <section><h4>特殊交易情形（備註②～⑨）</h4>${renderSpecials()}</section>
        <section><h4>條件式標的清冊（備註⑩～⑫）</h4>${renderConditionalLists()}</section>
      </div>
      <div class="filing-advanced-dialog-actions"><button class="btn btn-primary" type="button" data-filing-action="close-advanced">完成</button></div>
    </dialog>`;
  }

  function renderParkingEditor() {
    return `<div class="filing-grid two">
      <label class="field"><span>車位價格情形</span><select class="form-select" data-draft-path="parking.pricingMode"><option value="">請確認</option><option value="0" ${selected(draft.parking.pricingMode, "0")}>單獨計價（0）</option><option value="1" ${selected(draft.parking.pricingMode, "1")}>未單獨計價（1）</option></select></label>
      ${draft.parking.pricingMode === "0" ? textField("車位交易總價", "parking.totalPrice", draft.parking.totalPrice) : ""}
    </div><div class="filing-list-heading"><strong>車位清冊</strong><button class="btn btn-secondary" type="button" data-filing-action="add-parking">＋ 新增車位</button></div>
    <div class="filing-item-list">${draft.parking.items.length ? draft.parking.items.map((item, index) => `<article class="filing-list-item"><div class="filing-list-heading"><strong>車位 ${index + 1}</strong><button type="button" class="text-button" data-filing-action="remove-parking" data-index="${index}">移除</button></div><div class="filing-grid three">
      <label class="field"><span>類別</span><select class="form-select" data-draft-path="parking.items.${index}.type"><option value="">請選擇</option>${tupleOptions(CAR_TYPES, item.type)}</select></label>
      ${item.type === "7" ? textField("其他類別說明", `parking.items.${index}.typeText`, item.typeText || "") : ""}
      <label class="field"><span>樓層</span><select class="form-select" data-draft-path="parking.items.${index}.floor"><option value="">請選擇</option>${tupleOptions(CAR_FLOORS, item.floor)}</select></label>
      ${draft.parking.pricingMode === "0" ? textField("車位價格", `parking.items.${index}.price`, item.price || "") : ""}
      ${textField("面積 m²（選填）", `parking.items.${index}.area`, item.area || "")}
    </div></article>`).join("") : '<p class="filing-empty">尚無車位清冊。</p>'}</div>`;
  }

  function renderFees() {
    const fees = [
      ["p1sp_code0101", "裝潢費"], ["p1sp_code0102", "傢俱設備費"], ["p1sp_code0103", "土地增值稅或其他稅費"],
      ["p1sp_code0104", "仲介費"], ["p1sp_code0105", "地政士服務費"], ["p1sp_code0106", "其他種類費用"],
    ];
    return `<div class="filing-option-list" data-focus-key="fees">${fees.map(([field, label]) => `<div class="filing-option-row"><label class="check-field"><input type="checkbox" ${draft.fees[field] ? "checked" : ""} data-draft-path="fees.${field}"> ${escapeHtml(label)}</label>${draft.fees[field] ? `<input inputmode="numeric" aria-label="${escapeHtml(label)}金額" placeholder="金額；無法拆分可留空" value="${attr(draft.fees[field.replace("code", "price")])}" data-draft-path="fees.${field.replace("code", "price")}" data-rerender="false">${field === "p1sp_code0106" ? `<input aria-label="其他費用說明" placeholder="種類說明" value="${attr(draft.fees.p1sp_desc0106)}" data-draft-path="fees.p1sp_desc0106" data-rerender="false">` : ""}` : ""}</div>`).join("")}</div>`;
  }

  function renderSpecials() {
    return `<div class="filing-checkbox-grid">${SPECIAL_OPTIONS.map(([field, label]) => `<label class="check-field"><input type="checkbox" ${draft.special[field] ? "checked" : ""} data-draft-path="special.${field}" data-rerender="false"> ${escapeHtml(label)}</label>`).join("")}</div>
      <div class="filing-subsection"><label class="check-field"><input type="checkbox" ${draft.special.p1sp_code0901 ? "checked" : ""} data-draft-path="special.p1sp_code0901"> 預售屋或土地、建物分件登記（備註⑨）</label>${draft.special.p1sp_code0901 ? textField("預售屋申報書序號（分件登記可留空）", "special.p1sp_code0901no", draft.special.p1sp_code0901no) : ""}</div>`;
  }

  function renderConditionalLists() {
    const labels = { land: "備註⑩ 個別土地與權利範圍", build: "備註⑪ 個別主建號", base: "備註⑫ 主建號對應基地權利範圍" };
    return `<p class="filing-local-warning">不會自動把案件全部標的放進清冊。只有適用時啟用，並由使用者明確複製或新增。</p>${["land", "build", "base"].map((type) => {
      const list = draft.lists[type];
      return `<section class="filing-conditional-list" data-focus-key="list-${type}"><label class="check-field"><input type="checkbox" ${list.enabled ? "checked" : ""} data-draft-path="lists.${type}.enabled"> ${labels[type]}</label>${list.enabled ? `<div class="filing-list-actions"><button class="btn btn-secondary" type="button" data-filing-action="copy-list" data-list-type="${type}">從案件明確複製</button><button class="btn btn-secondary" type="button" data-filing-action="add-list" data-list-type="${type}">＋ 新增一筆</button></div>${renderListRows(type, list.items)}` : ""}</section>`;
    }).join("")}`;
  }

  function renderListRows(type, items) {
    if (!items.length) return '<p class="filing-empty">清冊尚無資料。</p>';
    return `<div class="filing-item-list">${items.map((item, index) => `<article class="filing-list-item"><div class="filing-list-heading"><strong>第 ${index + 1} 筆</strong><button type="button" class="text-button" data-filing-action="remove-list" data-list-type="${type}" data-index="${index}">移除</button></div><div class="filing-grid three">
      ${sectionSelect(type, index, item)}<label class="field"><span>正式段小段名稱</span><input value="${attr(item.sectionName || "")}" readonly></label>${textField(type === "build" ? "建號" : "地號", `lists.${type}.items.${index}.number`, item.number || "")}
      ${type !== "build" ? `${textField("權利範圍分子", `lists.${type}.items.${index}.numerator`, item.numerator || "")}${textField("權利範圍分母", `lists.${type}.items.${index}.denominator`, item.denominator || "")}` : ""}
    </div></article>`).join("")}</div>`;
  }

  function renderDownloadSection() {
    return `<section class="section filing-section filing-download" aria-labelledby="filing-download-title">
      <div class="section-heading"><span class="filing-step">06</span><h2 id="filing-download-title">資料檢查與下載</h2><p>下載前會列出缺漏；未填資料可確認後繼續，格式或代碼錯誤仍會阻止輸出。</p></div>
      <div id="filingValidation" class="filing-validation" aria-live="polite"></div>
      <div class="filing-download-actions"><button class="btn btn-secondary" type="button" data-filing-action="download-json">下載候選 JSON</button><button class="btn btn-primary" type="button" data-filing-action="download-zip">下載候選 ZIP</button></div>
      <p class="candidate-disclaimer"><strong>候選申報檔，尚未完成政府系統匯入驗證。</strong>ZIP 根目錄只放同名 JSON；下載檔名依現行候選規則含第一位買方證號，分享前請留意個資。</p>
      <details data-details-key="json-preview" ${openAttr("json-preview")}><summary>檢視目前候選 JSON</summary><pre id="filingJsonPreview" class="filing-json-preview"></pre></details>
    </section>`;
  }

  function updatePassiveViews() {
    const status = root.querySelector("#filingDraftStatus");
    if (status) status.textContent = savedAt ? `已暫存於此瀏覽器（${savedAt}）` : "尚未變更";
    const preview = root.querySelector("#filingJsonPreview");
    if (preview) preview.textContent = JSON.stringify(buildRealPriceGovernmentJson(draft), null, 2);
    const noteCount = root.querySelector("#filingNoteCount");
    if (noteCount) noteCount.textContent = `${String(draft.special.note || "").length}／200`;
    const advancedButton = root.querySelector("#filingAdvancedButton");
    const advancedCount = countAdvancedSettings(draft);
    if (advancedButton) advancedButton.textContent = `進階申報欄位${advancedCount ? `（已設定 ${advancedCount} 項）` : ""}`;
    renderValidation();
  }

  function renderValidation() {
    const target = root.querySelector("#filingValidation");
    if (!target) return;
    if (!validationErrors.length) {
      target.className = "filing-validation is-idle";
      target.innerHTML = "<strong>尚未執行下載檢查</strong><p>可先儲存未完成草稿；下載時會提示缺漏，但不會自動補入資料。</p>";
      return;
    }
    const blockers = validationErrors.filter((issue) => issue.severity === "error");
    const warnings = validationErrors.filter((issue) => issue.severity !== "error");
    target.className = `filing-validation ${blockers.length ? "has-errors" : "has-warnings"}`;
    target.innerHTML = `<strong>${blockers.length ? `有 ${blockers.length} 項格式或代碼錯誤，暫時無法下載` : `有 ${warnings.length} 項未填或待確認資料`}</strong>${warnings.length && !blockers.length ? "<p>仍可選擇下載候選檔；系統不會用假資料補齊。</p>" : ""}<ul>${validationErrors.map((issue) => `<li class="${issue.severity === "error" ? "is-error" : "is-warning"}"><button type="button" data-error-key="${attr(issue.key)}">${escapeHtml(issue.message)}</button></li>`).join("")}</ul>`;
  }

  function persist() {
    try {
      saveRealPriceFilingDraft(storage, draft);
      savedAt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    } catch {
      savedAt = "暫存失敗";
    }
  }

  function clearDraft() {
    if (!globalThis.confirm("確定清除此瀏覽器中的政府申報草稿？案件資料與 PDF 設定不會被刪除。")) return;
    clearRealPriceFilingDraft(storage);
    draft = createRealPriceFilingDraft();
    validationErrors = [];
    savedAt = "";
    if (codeRows.length) syncRealPriceFilingFromCase(draft, caseState, codeRows);
    onChange();
    render();
  }

  function downloadCandidate(type) {
    validationErrors = validateRealPriceFiling(draft, codeRows, sectionRows);
    renderValidation();
    const blockers = validationErrors.filter((issue) => issue.severity === "error");
    if (blockers.length) {
      root.querySelector("#filingValidation")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (validationErrors.length && !(doc.defaultView || globalThis).confirm("此申報檔仍有未填資料，匯入政府系統後可能需要補正，是否繼續下載？")) return;
    try {
      const basename = createCandidateBasename(draft);
      const jsonText = JSON.stringify(buildRealPriceGovernmentJson(draft), null, 2);
      if (type === "json") downloadBlob(new Blob([jsonText], { type: "application/json;charset=utf-8" }), `${basename}.json`);
      else downloadBlob(new Blob([createSingleFileZip(`${basename}.json`, jsonText)], { type: "application/zip" }), `${basename}.zip`);
    } catch (error) {
      validationErrors = [{ key: "output", message: `候選檔案產生失敗：${error.message || "未知錯誤"}`, severity: "error" }];
      renderValidation();
      root.querySelector("#filingValidation")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function applySelectionMetadata(input) {
    const path = input.dataset.draftPath;
    if (path === "location.cityCode") {
      const row = codeRows.find((item) => item.cityCode === input.value);
      draft.location.cityName = row?.cityName || "";
      draft.location.districtCode = ""; draft.location.districtName = ""; draft.location.officeCode = ""; draft.location.officeName = "";
      draft.location.manual.cityCode = true;
    }
    if (path === "location.districtCode") {
      const row = codeRows.find((item) => item.cityCode === draft.location.cityCode && item.districtCode === input.value);
      draft.location.districtName = row?.districtName || "";
      draft.location.officeCode = ""; draft.location.officeName = ""; draft.location.manual.districtCode = true;
      syncOfficeSuggestion(draft, codeRows);
    }
    if (path === "location.officeCode") {
      const row = codeRows.find((item) => item.cityCode === draft.location.cityCode && item.districtCode === draft.location.districtCode && item.officeCode === input.value);
      draft.location.officeName = row?.officeName || "";
      draft.location.manual.officeCode = true;
    }
    if (path === "transaction.propertyType") draft.transaction.propertyTypeManual = true;
    if (path === "agent.savedId") selectSavedFilingAgent(draft, getAgents().find((agent) => agent.id === input.value), codeRows);
    if (path === "agent.cityCode") {
      const row = codeRows.find((item) => item.cityCode === input.value);
      draft.agent.cityName = row?.cityName || ""; draft.agent.districtCode = ""; draft.agent.districtName = "";
    }
    if (path === "agent.districtCode") {
      const row = codeRows.find((item) => item.cityCode === draft.agent.cityCode && item.districtCode === input.value);
      draft.agent.districtName = row?.districtName || "";
    }
    if (path === "special.noteMode") {
      if (input.value === "none") draft.special.note = "";
      if (input.value === "common") draft.special.note = COMMON_FILING_NOTE;
      if (input.value === "custom" && draft.special.note === COMMON_FILING_NOTE) draft.special.note = "";
    }
    const partyMatch = path.match(/^(buyers|sellers)\.(\d+)\.(cityCode|districtCode)$/);
    if (partyMatch) {
      const party = draft[partyMatch[1]][Number(partyMatch[2])];
      if (partyMatch[3] === "cityCode") {
        const row = codeRows.find((item) => item.cityCode === input.value);
        party.cityName = row?.cityName || ""; party.districtCode = ""; party.districtName = "";
      } else {
        const row = codeRows.find((item) => item.cityCode === party.cityCode && item.districtCode === input.value);
        party.districtName = row?.districtName || "";
      }
    }
    const sectionMatch = path.match(/^lists\.(land|build|base)\.items\.(\d+)\.sectionCode$/);
    if (sectionMatch) {
      const item = draft.lists[sectionMatch[1]].items[Number(sectionMatch[2])];
      const section = sectionRows.find((row) => row.cityCode === draft.location.cityCode && row.districtCode === draft.location.districtCode && row.officeCode === draft.location.officeCode && row.code === input.value);
      item.sectionName = section?.name || "";
      item.cityCode = draft.location.cityCode;
      item.districtCode = draft.location.districtCode;
    }
    validationErrors = [];
    persist();
  }

  function markManual(input) {
    if (input.dataset.partyGroup && input.dataset.manualField) {
      const party = draft[input.dataset.partyGroup][Number(input.dataset.partyIndex)];
      party.manual ||= {};
      party.manual[input.dataset.manualField] = true;
    }
    validationErrors = [];
  }

  function restoreOpenDetails() {
    root.querySelectorAll("details[data-details-key]").forEach((details) => { details.open = openDetails.has(details.dataset.detailsKey); });
  }

  function openAttr(key) { return openDetails.has(key) ? "open" : ""; }

  function sectionSelect(type, index, item) {
    const candidates = sectionRows.filter((row) => row.cityCode === draft.location.cityCode && row.districtCode === draft.location.districtCode && row.officeCode === draft.location.officeCode);
    return `<label class="field"><span>正式段小段代碼</span><select class="form-select" data-draft-path="lists.${type}.items.${index}.sectionCode"><option value="">請選擇</option>${candidates.map((row) => `<option value="${attr(row.code)}" ${selected(item.sectionCode, row.code)}>${escapeHtml(row.name)}（${escapeHtml(row.code)}）</option>`).join("")}</select></label>`;
  }
}

function bindModeTabs(doc) {
  const tabs = [...doc.querySelectorAll("[data-real-price-mode]")];
  const panels = [...doc.querySelectorAll("[data-real-price-mode-panel]")];
  if (!tabs.length || tabs.some((tab) => tab.dataset.bound === "true")) return;
  const activate = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.realPriceMode === name;
      tab.classList.toggle("is-active", active); tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.realPriceModePanel !== name; });
  };
  tabs.forEach((tab) => {
    tab.dataset.bound = "true";
    tab.addEventListener("click", () => activate(tab.dataset.realPriceMode));
  });
}

function textField(label, path, value, options = {}) {
  const manual = options.manualGroup ? `data-party-group="${options.manualGroup}" data-party-index="${options.index}" data-manual-field="${path.split(".").at(-1)}"` : "";
  return `<label class="field"><span>${escapeHtml(label)}</span><input type="${options.type || "text"}" value="${attr(value)}" data-draft-path="${attr(path)}" data-rerender="false" ${manual} ${options.focus ? `data-focus-key="${attr(options.focus)}"` : ""}></label>`;
}

function numberField(label, path, value) {
  return `<label class="field"><span>${escapeHtml(label)}</span><input type="number" min="0" step="1" value="${attr(value)}" data-draft-path="${attr(path)}" data-rerender="false"></label>`;
}

function binarySelect(label, path, value, focus) {
  return `<label class="field"><span>${escapeHtml(label)}</span><select class="form-select" data-draft-path="${attr(path)}" data-focus-key="${attr(focus)}"><option value="">請確認</option><option value="1" ${selected(value, "1")}>有</option><option value="0" ${selected(value, "0")}>無</option></select></label>`;
}

function options(rows, valueKey, labelKey, current) {
  return rows.map((row) => `<option value="${attr(row[valueKey])}" ${selected(current, row[valueKey])}>${escapeHtml(row[labelKey])}（${escapeHtml(row[valueKey])}）</option>`).join("");
}

function tupleOptions(rows, current) {
  return rows.map(([value, label]) => `<option value="${attr(value)}" ${selected(current, value)}>${escapeHtml(label)}（${escapeHtml(value)}）</option>`).join("");
}

function selected(actual, expected) { return String(actual) === String(expected) ? "selected" : ""; }
function checked(actual, expected) { return String(actual) === String(expected) ? "checked" : ""; }
function countAdvancedSettings(draft) {
  const feeCount = ["p1sp_code0101", "p1sp_code0102", "p1sp_code0103", "p1sp_code0104", "p1sp_code0105", "p1sp_code0106"].filter((field) => draft.fees[field]).length;
  const specialCount = SPECIAL_OPTIONS.filter(([field]) => draft.special[field]).length + (draft.special.p1sp_code0901 ? 1 : 0);
  const listCount = ["land", "build", "base"].filter((type) => draft.lists[type].enabled).length;
  return feeCount + specialCount + listCount;
}
function blankParking() { return { type: "", typeText: "", floor: "", price: "", area: "" }; }
function blankParty() { return { sourceId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: "", idNumber: "", phone: "", email: "", cityCode: "", cityName: "", districtCode: "", districtName: "", addressRemainder: "", manual: {} }; }
function blankListItem() { return { sectionCode: "", sectionName: "", number: "", numerator: "", denominator: "", cityCode: "", districtCode: "" }; }

function setPath(target, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const parent = parts.reduce((node, part) => node[part], target);
  parent[last] = value;
}

function uniqueBy(items, selector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = selector(item);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function attr(value) { return escapeHtml(value); }
