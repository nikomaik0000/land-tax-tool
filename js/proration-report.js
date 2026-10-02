import { settlementText } from "./proration-calculations.js?v=20261001-1";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const money = (value) => value === "" || value === null || value === undefined ? "—" : Math.round(Number(value) || 0).toLocaleString("zh-TW");
const decimalNumber = (value) => value === "" || value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 20 });
export function formatRocDate(value) {
  const match = /^(\d{3,4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(String(value ?? "").trim());
  if (!match) return "—";
  const rawYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(rawYear) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return "—";
  const rocYear = rawYear >= 1912 ? rawYear - 1911 : rawYear;
  return `${rocYear}/${month}/${day}`;
}
const period = (start, end, days) => days > 0 ? `${formatRocDate(start)}～${formatRocDate(end)}` : "—";
const payerName = (tax, buyer, seller) => tax.payer === "buyer" ? buyer || "買方" : seller || "賣方";
const resultName = (result, buyer, seller) => result.settlement > 0 ? `${buyer || "買方"}應補${seller || "賣方"}` : result.settlement < 0 ? `${seller || "賣方"}應補${buyer || "買方"}` : "雙方無須找補";

function sectionHeading(title, tax, buyer, seller) {
  return `<div class="proration-report-heading"><h3 class="proration-section-title">${title}</h3><span>稅款支付方：${escapeHtml(payerName(tax, buyer, seller))}</span></div>`;
}

function houseSection(tax, result, buyer, seller) {
  const note = String(tax.taxNote ?? "").trim();
  return `<section class="report-section proration-section">${sectionHeading("房屋稅分算", tax, buyer, seller)}
    <table class="report-owner-tax-table proration-report-table proration-house-table"><thead><tr><th>房屋稅額</th><th>課稅月數</th><th>期間</th><th>天數</th></tr></thead><tbody><tr><td>${money(tax.amount)}</td><td>${escapeHtml(tax.taxableMonths || "—")} 個月</td><td>${result.valid ? `${formatRocDate(result.taxStartDate)}～${formatRocDate(result.taxEndDate)}` : "—"}</td><td>${result.valid ? `${result.totalTaxDays} 天` : "—"}</td></tr></tbody>
    <thead><tr><th>本次找補期間</th><th>天數</th><th>計算</th><th>本次找補稅額</th></tr></thead><tbody><tr><td>${period(result.prorationStartDate, result.prorationEndDate, result.prorationDays)}</td><td>${result.valid ? `${result.prorationDays} / ${result.totalTaxDays}` : "—"}</td><td>${result.valid ? `${money(result.amount)} × ${result.prorationDays} / ${result.totalTaxDays}` : "—"}</td><td>${result.valid ? money(result.prorationAmount) : "—"}</td></tr></tbody>
    <tfoot><tr><th colspan="3">${result.valid ? escapeHtml(resultName(result, buyer, seller)) : escapeHtml(result.error)}</th><td>${result.valid ? money(result.prorationAmount) : "—"}</td></tr></tfoot></table>
    ${note ? `<div class="report-clause report-custom-note proration-tax-note"><p><strong>備註：</strong>${escapeHtml(note)}</p></div>` : ""}</section>`;
}

function landSection(tax, result, buyer, seller) {
  return `<section class="report-section proration-section">${sectionHeading("地價稅分算", tax, buyer, seller)}
    <table class="report-owner-tax-table proration-report-table proration-land-table"><thead><tr><th>申報地價</th><th>土地面積</th><th>土地持分</th><th>課稅地價</th><th>稅率</th></tr></thead><tbody><tr><td>${money(tax.declaredLandValue)} 元／㎡</td><td>${decimalNumber(tax.area)} ㎡</td><td>${escapeHtml(tax.shareNumerator)} / ${escapeHtml(tax.shareDenominator)}</td><td>${money(result.taxableLandValue)}</td><td>${escapeHtml(tax.rate || "—")}${tax.rate !== "" ? "%" : ""}</td></tr></tbody>
    <thead><tr><th>完整地價稅</th><th>本次找補期間</th><th>天數</th><th>計算</th><th>本次找補金額</th></tr></thead><tbody><tr><td>${money(result.taxAmount)}</td><td>${period(result.prorationStartDate, result.prorationEndDate, result.prorationDays)}</td><td>${result.valid ? `${result.prorationDays} / ${result.totalTaxDays}` : "—"}</td><td>${result.valid ? `${money(result.amount)} × ${result.prorationDays} / ${result.totalTaxDays}` : "—"}</td><td>${result.valid ? money(result.prorationAmount) : "—"}</td></tr></tbody>
    <tfoot><tr><th colspan="4">${result.valid ? escapeHtml(resultName(result, buyer, seller)) : escapeHtml(result.error)}</th><td>${result.valid ? money(result.prorationAmount) : "—"}</td></tr></tfoot></table></section>`;
}

export function renderProrationReport(state, results) {
  const shared = state.shared; const customer = state.customer;
  const notes = (shared.notes ?? []).filter((note) => String(note.content ?? "").trim());
  const title = String(shared.caseName ?? "").trim() || "地價稅房屋稅 分算找補";
  const houseText = results.house.valid ? settlementText(results.house.settlement, customer.buyer, shared.seller) : "—";
  const landText = results.land.valid ? settlementText(results.land.settlement, customer.buyer, shared.seller) : "—";
  const totalText = results.house.valid && results.land.valid ? settlementText(results.total, customer.buyer, shared.seller) : "—";
  return `<div class="report-document"><header class="report-header"><h2>${escapeHtml(title)}</h2>
    <div class="report-meta"><span>買方：${escapeHtml(customer.buyer || "—")}</span><span>賣方：${escapeHtml(shared.seller || "—")}</span><span>交屋日／分算基準日：${formatRocDate(shared.handoverDate)}</span></div></header>
    ${houseSection(customer.houseTax, results.house, customer.buyer, shared.seller)}
    ${landSection(customer.landTax, results.land, customer.buyer, shared.seller)}
    <section class="report-section proration-section proration-final-section"><h3 class="proration-section-title">最終找補</h3><table class="report-owner-tax-table proration-final-table"><tbody><tr><td class="proration-final-label">房屋稅（${escapeHtml(resultName(results.house, customer.buyer, shared.seller))}）</td><td class="proration-final-detail-amount">${money(Math.abs(results.house.settlement))}</td></tr><tr><td class="proration-final-label">地價稅（${escapeHtml(resultName(results.land, customer.buyer, shared.seller))}）</td><td class="proration-final-detail-amount">${money(Math.abs(results.land.settlement))}</td></tr><tr class="proration-final-total"><td class="proration-final-label">抵銷後　${escapeHtml(resultName({ settlement: results.total }, customer.buyer, shared.seller))}</td><td class="proration-final-amount">${money(Math.abs(results.total))}</td></tr></tbody></table></section>
    ${notes.length ? `<section class="report-notes-section report-section proration-section"><h3 class="proration-section-title">其他備註</h3>${notes.map((note, index) => `<div class="report-clause report-custom-note"><p><strong>${index + 1}.</strong> ${escapeHtml(note.content)}</p></div>`).join("")}</section>` : ""}
  </div>`;
}
