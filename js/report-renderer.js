import { state } from "./state.js";
import { formatArea, formatLandNumber, formatMoney } from "./formatters.js?v=20260819-25";
import { ownerName } from "./relationships.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function input(field, value, label, numeric = false, format = "") {
  const displayedValue = format === "money" ? formatMoney(value) : format === "area" ? formatArea(value) : format === "land-number" ? formatLandNumber(value) : value;
  return `<input data-field="${field}" ${format ? `data-format="${format}"` : ""} aria-label="${label}" ${numeric ? 'inputmode="decimal"' : ""} value="${escapeHtml(displayedValue)}">`;
}

function transferInput(field, transfer, index, label, format = "") {
  const value = format === "money" ? formatMoney(transfer[field] || "") : transfer[field] || "";
  return `<input data-transfer="${field}" data-transfer-index="${index}" ${format ? `data-format="${format}"` : ""} aria-label="${label}" ${field !== "date" ? 'inputmode="decimal"' : ""} value="${escapeHtml(value)}">`;
}

function relationshipSelect(field, value, options, label) {
  return `<select data-field="${field}" aria-label="${label}">${options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === (value ?? "") ? " selected" : ""} title="${escapeHtml(option.title ?? option.label)}">${escapeHtml(option.label)}</option>`).join("")}</select>`;
}
const compactHouseLabel = (house, index) => { const address = String(house.address ?? "").trim(); const short = address.length > 16 ? `${address.slice(0, 16)}…` : address; return `房屋 ${index + 1}${short ? `：${short}` : ""}`; };

function basicLandCells(land, rowSpan) {
  const span = ` rowspan="${rowSpan}"`;
  return `<td class="land-basic-cell district-cell"${span}>${input("district", land.district, "區")}</td>
    <td class="land-basic-cell section-cell"${span}>${input("section", land.section, "段")}</td>
    <td class="land-basic-cell subsection-cell"${span}>${input("subsection", land.subsection, "小段")}</td>
    <td class="land-basic-cell"${span}>${input("landNumber", land.landNumber, "地號", false, "land-number")}</td>
    <td class="land-basic-cell"${span}>${input("area", land.area || "", "面積", true, "area")}</td>
    <td class="land-basic-cell"${span}>${relationshipSelect("ownerId", land.ownerId, state.owners.map((owner) => ({ value: owner.id, label: owner.name || "（未命名）" })), "所有權人")}</td>
    <td class="land-basic-cell"${span}>${relationshipSelect("houseId", land.houseId, [{ value: "", label: "無房屋" }, ...state.houses.map((house, index) => ({ value: house.id, label: compactHouseLabel(house, index), title: house.address }))], "對應房屋")}</td>
    <td class="land-basic-cell numeric"${span}>${input("announcedValue", land.announcedValue || "", "公告現值", true, "money")}</td>
    <td class="land-basic-cell"${span}><div class="share-fields">${input("shareNumerator", land.shareNumerator, "持分分子", true)}<span>/</span>${input("shareDenominator", land.shareDenominator, "持分分母", true)}</div></td>
    <td class="land-basic-cell numeric"${span}><output class="current-value" data-current-value>${formatMoney(land.currentValue)}</output></td>`;
}

function transferCells(transfer, index) {
  if (!transfer) return `<td></td><td class="numeric"></td><td></td><td class="numeric"></td><td class="numeric"></td>`;
  return `<td>${transferInput("date", transfer, index, "前次移轉日期")}</td>
    <td class="numeric">${transferInput("previousValue", transfer, index, "前次移轉現值", "money")}</td>
    <td class="transfer-index">${transferInput("priceIndex", transfer, index, "物價指數")}</td>
    <td class="numeric">${transferInput("selfUseTax", transfer, index, "自用增值稅", "money")}</td>
    <td class="numeric">${transferInput("generalTax", transfer, index, "一般增值稅", "money")}</td>`;
}

export function renderFiles(container) {
  container.innerHTML = state.files.map((entry) => `<div class="file-row" data-file-id="${entry.id}">
    <span class="file-name">${escapeHtml(entry.file.name)}</span>
    <span class="file-status ${entry.status === "error" ? "is-error" : ""}">${escapeHtml(entry.message)}</span>
    <button class="icon-button" data-action="remove-file" type="button" aria-label="移除 ${escapeHtml(entry.file.name)}">×</button>
  </div>`).join("");
}

export function renderLandTable(body, wrap, empty) {
  for (const land of state.lands) land.owner = ownerName(state, land.ownerId, land.owner);
  wrap.hidden = state.lands.length === 0;
  empty.hidden = state.lands.length > 0;
  body.innerHTML = state.lands.flatMap((land) => {
    const rows = land.previousTransfers.length ? land.previousTransfers : [null];
    return rows.map((transfer, index) => `<tr data-land-id="${land.id}" data-transfer-row="${index}">
      ${index === 0 ? basicLandCells(land, rows.length) : ""}
      ${transferCells(transfer, index)}
      ${index === 0 ? `<td class="land-basic-cell" rowspan="${rows.length}"><div class="table-action"><button class="text-button" data-action="remove-land" type="button">刪除</button></div></td>` : ""}
    </tr>`);
  }).join("");
}
