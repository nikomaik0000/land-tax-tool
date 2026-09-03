import { clauses } from "./clauses.js?v=20260818-9";
import { calculateGiftTax, calculateTaxSummaryByOwner, calculateTotalDeedTax, calculateTransferTaxTotals } from "./calculations.js";
import { formatArea, formatLandNumber, formatMoney } from "./formatters.js?v=20260819-25";
import { hasEffectiveHouseData, ownerName } from "./relationships.js";
import { formatZoningForPrint, getVisiblePrintColumns } from "./zoning-print.js";
import { normalizeDistrict } from "./land-value-normalization.js";
import { getFinalTransferTaxes } from "./land-zoning.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

export function formatShareForPrint(numerator, denominator, sharePrintLayout = "single-line") {
  const first = Number(numerator) || 0; const second = Number(denominator) || 0;
  return sharePrintLayout === "two-line"
    ? `<span class="report-share report-share-two-line"><span>${first} /</span><span>${second}</span></span>`
    : `<span class="report-share report-share-single-line">${first} / ${second}</span>`;
}

export function getReportRowCount(lands, showLandZoning = false, zoningPrintLayout = "row") {
  return (Array.isArray(lands) ? lands : []).reduce(
    (count, land) => count + Math.max(1, land.previousTransfers?.length ?? 0) + (showLandZoning && zoningPrintLayout === "row" && String(land.zoning ?? "").trim() ? 1 : 0),
    0
  );
}

export function getReportDensity(state) {
  const rowCount = getReportRowCount(state.lands, state.displayOptions.showLandZoning, state.displayOptions.zoningPrintLayout);
  const clauseCount = state.selectedClauses.length + (state.customNotes ?? []).filter((note) => note.enabled !== false && String(note.content ?? "").trim()).length;
  const score = rowCount + clauseCount * 1.5 + (state.displayOptions.showTaxSummary ? 0.5 : 0) + (state.giftTax?.enabled ? 5 : 0);
  const density = score <= 5 ? "normal" : score <= 10 ? "compact" : "dense";
  return { density, rowCount, warning: score > 14 || rowCount > 9 };
}

function basicCells(state, land, rowSpan) {
  const span = ` rowspan="${rowSpan}"`;
  const visible = { district: true, section: true, subsection: true, owner: true, ...(state.displayOptions.printLandColumns ?? {}) };
  return `${visible.district ? `<td${span}>${escapeHtml(normalizeDistrict(land.district))}</td>` : ""}
    ${visible.section ? `<td${span}>${escapeHtml(land.section)}</td>` : ""}
    ${visible.subsection ? `<td${span}>${escapeHtml(land.subsection)}</td>` : ""}
    <td${span}>${escapeHtml(formatLandNumber(land.landNumber))}</td>
    <td${span}>${formatArea(land.area)}</td>
    ${visible.owner ? `<td${span}>${escapeHtml(ownerName(state, land.ownerId, land.owner))}</td>` : ""}
    <td class="report-money"${span}>${formatMoney(land.announcedValue)}</td>`;
}

function transferCells(state, land, transfer, index, rowSpan) {
  const showSelfUseTax = state.displayOptions.showSelfUseTax;
  const zoningColumn = state.displayOptions.showLandZoning && state.displayOptions.zoningPrintLayout === "column";
  const zoning = formatZoningForPrint(land.zonings?.length ? land.zonings : land.zoning, state.displayOptions.zoningTextMode);
  const zoningCell = zoningColumn && index === 0 ? `<td class="report-zoning-column" rowspan="${rowSpan}">${escapeHtml(zoning)}</td>` : "";
  if (!transfer) {
    return `<td></td><td class="report-money"></td><td></td><td class="report-money"></td><td></td>${showSelfUseTax ? '<td class="report-money"></td>' : ""}<td class="report-money"></td>${zoningCell}`;
  }
  const taxes = getFinalTransferTaxes(land, transfer);
  return `<td class="report-share-cell">${formatShareForPrint(transfer.shareNumerator ?? land.shareNumerator, transfer.shareDenominator ?? land.shareDenominator, state.displayOptions.sharePrintLayout)}</td>
    <td class="report-money report-current-value">${formatMoney(transfer.currentValue)}</td>
    <td>${escapeHtml(transfer.date)}</td>
    <td class="report-money">${formatMoney(transfer.previousValue)}</td>
    <td>${escapeHtml(transfer.priceIndex || "")}</td>
    ${showSelfUseTax ? `<td class="report-money">${formatMoney(taxes.finalSelfUseTax)}</td>` : ""}
    <td class="report-money">${formatMoney(taxes.finalGeneralTax)}</td>
    ${zoningCell}`;
}

function singleLandRows(state, land) {
    const transfers = land.previousTransfers.length ? land.previousTransfers : [null];
    const rows = transfers.map((transfer, index) => `<tr>
      ${index === 0 ? basicCells(state, land, transfers.length) : ""}
      ${transferCells(state, land, transfer, index, transfers.length)}
    </tr>`).join("");
    const zoning = state.displayOptions.showLandZoning ? formatZoningForPrint(land.zonings?.length ? land.zonings : land.zoning, state.displayOptions.zoningTextMode) : "";
    const columnCount = getVisiblePrintColumns(state.displayOptions).length;
    return rows + (zoning && state.displayOptions.zoningPrintLayout !== "column" ? `<tr class="report-zoning-row"><td colspan="${columnCount}">使用分區：${escapeHtml(zoning)}</td></tr>` : "");
}

function houseRow(state, house) {
  const columns = getVisiblePrintColumns(state.displayOptions);
  const shareIndex = columns.findIndex((column) => column.key === "share");
  const currentIndex = columns.findIndex((column) => column.key === "current");
  const trailing = columns.length - currentIndex - 1;
  return `<tr class="report-house-row">
    <td colspan="${shareIndex}" class="report-house-address">房屋座落：${escapeHtml(house.address || "—")}</td>
    <td class="report-house-share">${formatShareForPrint(house.shareNumerator, house.shareDenominator, state.displayOptions.sharePrintLayout)}</td>
    <td class="report-money report-current-value">${formatMoney(house.currentValue)}</td>
    ${trailing ? `<td colspan="${trailing}"></td>` : ""}
  </tr>`;
}

function mainTableRows(state, totals) {
  const renderedHouses = new Set(); let html = "";
  state.lands.forEach((land, index) => {
    html += singleLandRows(state, land);
    const houseId = land.houseId;
    const laterUse = houseId && state.lands.slice(index + 1).some((item) => item.houseId === houseId);
    const house = state.houses?.find((item) => item.id === houseId);
    if (house && !laterUse && !renderedHouses.has(house.id)) { html += houseRow(state, house); renderedHouses.add(house.id); }
  });
  for (const house of state.houses ?? []) if (!renderedHouses.has(house.id) && (String(house.address || "").trim() || Number(house.assessedValue) > 0)) html += houseRow(state, house);
  const columns = getVisiblePrintColumns(state.displayOptions);
  const currentIndex = columns.findIndex((column) => column.key === "current");
  const selfUseIndex = columns.findIndex((column) => column.key === "selfUseTax");
  const taxStart = selfUseIndex >= 0 ? selfUseIndex : columns.findIndex((column) => column.key === "generalTax");
  const trailing = columns.length - columns.findIndex((column) => column.key === "generalTax") - 1;
  return `${html}<tr class="report-total-row">
    <td colspan="${currentIndex}">合計</td>
    <td class="report-money">${formatMoney(state.caseCurrentValue)}</td>
    ${taxStart - currentIndex - 1 ? `<td colspan="${taxStart - currentIndex - 1}"></td>` : ""}
    ${state.displayOptions.showSelfUseTax ? `<td class="report-money">${formatMoney(totals.selfUseTax)}</td>` : ""}
    <td class="report-money">${formatMoney(totals.generalTax)}</td>
    ${trailing ? `<td colspan="${trailing}"></td>` : ""}
  </tr>`;
}

function taxSummaryItems(state, totals, giftResult) {
  if (!state.displayOptions.showTaxSummary) return [];
  const selected = state.displayOptions.taxSummaryItems;
  return [
    ...(state.displayOptions.showSelfUseTax && selected.selfUseTax ? [{ label: "自用增值稅", value: totals.selfUseTax }] : []),
    ...(selected.generalTax ? [{ label: "一般增值稅", value: totals.generalTax }] : []),
    ...(selected.deedTax && hasEffectiveHouseData(state) ? [{ label: "契稅", value: calculateTotalDeedTax(state.houses) }] : []),
    ...(state.giftTax?.enabled && selected.giftTax && giftResult ? [{ label: "贈與稅", value: giftResult.finalGiftTax }] : [])
  ];
}

function taxSummaryMarkup(state, totals, giftResult) {
  const groups = calculateTaxSummaryByOwner(state);
  const selected = state.displayOptions.taxSummaryItems;
  if (groups.length <= 1) {
    const items = taxSummaryItems(state, totals, giftResult);
    return items.length ? `<div class="report-tax-summary report-tax-count-${items.length}">${items.map((item) => `<div><span>${item.label}</span><strong>${formatMoney(item.value)}</strong></div>`).join("")}</div>` : "";
  }
  const columns = [
    ...(state.displayOptions.showSelfUseTax && selected.selfUseTax ? [{ key: "selfUseTax", label: "自用增值稅", total: totals.selfUseTax }] : []),
    ...(selected.generalTax ? [{ key: "generalTax", label: "一般增值稅", total: totals.generalTax }] : []),
    ...(selected.deedTax && hasEffectiveHouseData(state) ? [{ key: "deedTax", label: "契稅", total: calculateTotalDeedTax(state.houses) }] : [])
  ];
  const table = columns.length ? `<table class="report-owner-tax-table"><thead><tr><th>所有權人</th>${columns.map((column) => `<th>${column.label}</th>`).join("")}</tr></thead><tbody>${groups.map((group) => `<tr><th scope="row">${escapeHtml(group.ownerName || "未命名所有權人")}</th>${columns.map((column) => `<td class="report-money">${formatMoney(group[column.key])}</td>`).join("")}</tr>`).join("")}</tbody>${state.displayOptions.showCaseTotal ? `<tfoot><tr><th scope="row">合計</th>${columns.map((column) => `<td class="report-money">${formatMoney(column.total)}</td>`).join("")}</tr></tfoot>` : ""}</table>` : "";
  const giftOnly = state.giftTax?.enabled && selected.giftTax && giftResult ? `<p class="report-case-gift-tax"><span>案件贈與稅</span><strong>${formatMoney(giftResult.finalGiftTax)}</strong></p>` : "";
  return table + giftOnly;
}

function giftTaxFormula(result) {
  const rate = `${Math.round(result.bracketRate * 100)}%`;
  if (result.bracketLabel === "第一級") {
    return `<span>適用稅率：${rate}</span><span class="gift-formula-separator">｜</span><span>${formatMoney(result.taxableGift)} × ${rate} ＝ ${formatMoney(result.calculatedAnnualTax)} 元</span>`;
  }
  return `<span>適用稅率：${rate}</span><span class="gift-formula-separator">｜</span><span>${formatMoney(result.bracketBaseTax)} ＋（${formatMoney(result.taxableGift)} − ${formatMoney(result.bracketExcessOver)}）× ${rate} ＝ ${formatMoney(result.calculatedAnnualTax)} 元</span>`;
}

function giftTaxTable(items, result) {
  const columnCount = items.length;
  const amountSpan = 1;
  const labelSpan = Math.max(1, Math.ceil((columnCount - amountSpan) / 3));
  const formulaSpan = Math.max(1, columnCount - labelSpan - amountSpan);
  return `<div class="gift-tax-table-scroll"><table class="gift-tax-table">
    <thead><tr>${items.map((item) => `<th scope="col">${item.label}</th>`).join("")}</tr></thead>
    <tbody><tr>${items.map((item) => `<td class="report-money">${formatMoney(item.value)}</td>`).join("")}</tr></tbody>
    <tfoot><tr>
      <td class="gift-tax-formula-cell" colspan="${formulaSpan}">${giftTaxFormula(result)}</td>
      <th class="gift-tax-final-label" colspan="${labelSpan}" scope="row">應納贈與稅</th>
      <td class="gift-tax-final-amount" colspan="${amountSpan}">${formatMoney(result.finalGiftTax)} 元</td>
    </tr></tfoot>
  </table></div>`;
}

function giftTaxItems(result, hasLand) {
  return [
    ...(hasLand ? [{ label: "土地總<br>現值", value: result.landCurrentValue }] : []),
    ...(result.houseCurrentValue > 0 ? [{ label: "房屋持分<br>現值", value: result.houseCurrentValue }] : []),
    ...(result.otherCurrentGiftAmount > 0 ? [{ label: "其他本次<br>贈與", value: result.otherCurrentGiftAmount }] : []),
    { label: "本次贈與<br>總額", value: result.currentGiftAmount },
    ...(result.previousGiftAmount > 0 ? [{ label: "以前各次<br>贈與", value: result.previousGiftAmount }] : []),
    { label: "本年度<br>贈與總額", value: result.annualGiftAmount },
    ...(result.excludedGiftAmount > 0 ? [{ label: "不計入<br>贈與總額", value: result.excludedGiftAmount }] : []),
    { label: "免稅額", value: result.exemption },
    ...(result.landValueTaxDeduction > 0 ? [{ label: "土增稅<br>扣除額", value: result.landValueTaxDeduction }] : []),
    ...(result.deedTaxDeduction > 0 ? [{ label: "契稅<br>扣除額", value: result.deedTaxDeduction }] : []),
    ...(result.otherDeduction > 0 ? [{ label: "其他<br>扣除額", value: result.otherDeduction }] : []),
    { label: "課稅贈與<br>淨額", value: result.taxableGift },
    ...(result.previousPaidTaxCredit > 0 ? [
      { label: "全年應納<br>贈與稅", value: result.calculatedAnnualTax },
      { label: "以前已納稅額<br>／可扣抵稅額", value: result.previousPaidTaxCredit }
    ] : [])
  ];
}

function giftTaxDetail(result, hasLand) {
  const items = giftTaxItems(result, hasLand);
  return `<section class="report-section report-gift-tax-section">
    <h3>贈與稅試算</h3>
    ${giftTaxTable(items, result)}
  </section>`;
}

function selectedClauseMarkup(selectedIds) {
  return clauses.filter((clause) => selectedIds.includes(clause.id)).map((clause) => {
    if (clause.id === "selfUse") {
      return `<div class="report-clause report-clause-list">
        <p class="report-clause-title">◆ ${escapeHtml(clause.title)}</p>
        <div class="report-note-detail"><ol class="report-note-list">${clause.content.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></div>
      </div>`;
    }
    return `<div class="report-clause"><p>◆ ${escapeHtml(clause.content.join(""))}</p></div>`;
  }).join("");
}

function customNotesMarkup(notes = []) {
  return notes.filter((note) => note.enabled !== false && String(note.content ?? "").trim()).map((note) => {
    const title = String(note.title ?? "").trim(); const content = String(note.content ?? "").trim();
    if (!title) return `<div class="report-clause report-custom-note"><p>◆ ${escapeHtml(content)}</p></div>`;
    return `<div class="report-clause report-custom-note">
      <p class="report-clause-title">◆ ${escapeHtml(title)}：</p>
      <div class="report-note-detail">${escapeHtml(content)}</div>
    </div>`;
  }).join("");
}

export function renderA4Report(state) {
  const { density, rowCount, warning } = getReportDensity(state);
  const totals = calculateTransferTaxTotals(state.lands);
  const showSelfUseTax = state.displayOptions.showSelfUseTax;
  const giftResult = state.giftTax?.enabled ? (state.giftTax.result ?? calculateGiftTax(state)) : null;
  const giftColumnCount = giftResult ? giftTaxItems(giftResult, state.lands.length > 0).length : 0;
  const portraitGiftWarning = state.displayOptions.orientation === "portrait" && giftColumnCount > 8;
  const taxSummary = state.displayOptions.showTaxSummary ? taxSummaryMarkup(state, totals, giftResult) : "";
  const noteMarkup = selectedClauseMarkup(state.selectedClauses) + customNotesMarkup(state.customNotes);
  const columns = getVisiblePrintColumns(state.displayOptions);

  const html = `<div class="report-document density-${density}">
    <header class="report-header">
      <h2>${escapeHtml(state.caseName || "土地增值稅試算")}</h2>
    </header>

    <table class="a4-land-table share-layout-${state.displayOptions.sharePrintLayout === "two-line" ? "two-line" : "single-line"} ${showSelfUseTax ? "show-self-use" : "hide-self-use"}">
      <colgroup>
        ${columns.map((column) => `<col class="${column.className}">`).join("")}
      </colgroup>
      <thead><tr>
        ${columns.map((column) => `<th>${column.label}</th>`).join("")}
      </tr></thead>
      <tbody>${mainTableRows(state, totals)}</tbody>
    </table>

    ${giftResult ? giftTaxDetail(giftResult, state.lands.length > 0) : ""}

    ${taxSummary ? `<section class="report-section report-tax-section">
      <h3>稅額摘要</h3>
      ${taxSummary}
    </section>` : ""}

    ${noteMarkup ? `<section class="report-section report-notes-section"><h3>備註</h3>${noteMarkup}</section>` : ""}
  </div>`;

  return {
    html,
    density,
    rowCount,
    warning: warning || portraitGiftWarning,
    warningMessage: portraitGiftWarning
      ? "目前欄位較多，建議改用橫式列印。"
      : "目前資料量較多，可能無法完整容納於單張 A4。"
  };
}
