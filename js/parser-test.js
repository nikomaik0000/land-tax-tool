import { parseLandTaxPdfDetailed } from "./pdf-parser.js?v=20260819-25";
import { formatLandNumber } from "./formatters.js?v=20260819-25";

const files = document.querySelector("#files");
const results = document.querySelector("#results");
const status = document.querySelector("#status");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const money = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString("zh-TW") : "—";

files.addEventListener("change", async () => {
  results.innerHTML = "";
  status.textContent = `讀取 ${files.files.length} 份 PDF…`;
  for (const file of files.files) {
    try {
      const parsed = await parseLandTaxPdfDetailed(file);
      for (const land of parsed.lands) {
        const transfers = land.previousTransfers.length ? land.previousTransfers : [null];
        results.insertAdjacentHTML("beforeend", `<tr>
          <td>${escapeHtml(file.name)}</td><td>${escapeHtml(parsed.meta.template)}</td>
          <td>${escapeHtml(land.district)}</td><td>${escapeHtml(land.section)}</td><td>${escapeHtml(land.subsection)}</td><td>${escapeHtml(formatLandNumber(land.landNumber))}</td>
          <td class="number">${escapeHtml(land.area ?? "—")}</td><td class="number">${money(land.announcedValue)}</td>
          <td>${escapeHtml(land.shareNumerator ?? "?")} / ${escapeHtml(land.shareDenominator ?? "?")}</td>
          <td>${transfers.map((transfer) => transfer ? `${escapeHtml(transfer.date)}／${money(transfer.previousValue)}／${escapeHtml(transfer.priceIndex ?? "—")}` : "—").join("<br>")}</td>
          <td class="number">${transfers.map((transfer) => money(transfer?.selfUseTax)).join("<br>")}</td>
          <td class="number">${transfers.map((transfer) => money(transfer?.generalTax)).join("<br>")}</td>
          <td>${escapeHtml(parsed.meta.missingFields.join(", ") || "—")}</td><td>${escapeHtml(parsed.meta.confidence)}</td>
        </tr>`);
      }
    } catch (error) {
      results.insertAdjacentHTML("beforeend", `<tr><td>${escapeHtml(file.name)}</td><td colspan="13">${escapeHtml(error.message)}</td></tr>`);
    }
  }
  status.textContent = "讀取完成。";
  files.value = "";
});
