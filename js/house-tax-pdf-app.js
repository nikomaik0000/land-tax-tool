import { HOUSE_TAX_PDF_ASSETS } from "./house-tax-pdf-coordinates.js";
import { buildHouseTaxPdfIssues, generateHouseTaxPdf } from "./house-tax-pdf-overlay.js?v=20261027-3";
import { houseTaxPdfFilename } from "./case-document-filenames.js?v=20261027-3";

export function createHouseTaxPdfController(elements, win = globalThis) {
  let timer = 0;
  let generation = 0;
  let currentUrl = "";
  let currentFilename = houseTaxPdfFilename();
  const assetsPromise = Promise.all([
    fetchBytes(HOUSE_TAX_PDF_ASSETS.template, win),
    fetchBytes(HOUSE_TAX_PDF_ASSETS.font, win),
  ]);

  elements.download.addEventListener("click", () => {
    if (!currentUrl) return;
    const link = elements.preview.ownerDocument.createElement("a");
    link.href = currentUrl;
    link.download = currentFilename;
    link.click();
  });
  elements.print.addEventListener("click", () => {
    if (!currentUrl) return;
    const printWindow = win.open(currentUrl, "_blank");
    if (!printWindow) {
      setStatus("瀏覽器阻擋了列印視窗，請允許此網站開啟彈出式視窗。", "error");
      return;
    }
    printWindow.addEventListener("load", () => printWindow.print(), { once: true });
  });

  return { schedule, dispose };

  function schedule(preview) {
    generation += 1;
    const request = generation;
    win.clearTimeout(timer);
    const issues = buildHouseTaxPdfIssues(preview);
    if (issues.length) {
      clearPreview();
      setStatus(issues.join("；"), "waiting");
      return;
    }
    setStatus("正在更新正式政府原表預覽…", "loading");
    timer = win.setTimeout(async () => {
      try {
        const [templateBytes, fontBytes] = await assetsPromise;
        const bytes = await generateHouseTaxPdf({ preview, templateBytes, fontBytes });
        if (request !== generation) return;
        replacePreview(bytes, preview);
      } catch (error) {
        if (request !== generation) return;
        clearPreview();
        setStatus(error?.message || "正式 PDF 產生失敗，請重新整理後再試。", "error");
      }
    }, 180);
  }

  function replacePreview(bytes, preview) {
    const nextUrl = win.URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    if (currentUrl) win.URL.revokeObjectURL(currentUrl);
    currentUrl = nextUrl;
    currentFilename = houseTaxPdfFilename(preview);
    elements.preview.src = currentUrl;
    elements.preview.hidden = false;
    elements.placeholder.hidden = true;
    elements.download.disabled = false;
    elements.print.disabled = false;
    const warningCount = preview.warnings?.length || 0;
    setStatus(`正式預覽已更新；下載與列印會使用同一份 PDF。${warningCount ? ` 尚有 ${warningCount} 項資料提醒，不影響輸出。` : ""}`, "ready");
  }

  function clearPreview() {
    if (currentUrl) win.URL.revokeObjectURL(currentUrl);
    currentUrl = "";
    elements.preview.removeAttribute("src");
    elements.preview.hidden = true;
    elements.placeholder.hidden = false;
    elements.download.disabled = true;
    elements.print.disabled = true;
  }

  function setStatus(message, state) {
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  }

  function dispose() {
    generation += 1;
    win.clearTimeout(timer);
    clearPreview();
  }
}

async function fetchBytes(url, win) {
  const response = await win.fetch(url);
  if (!response.ok) throw new Error(`無法載入本機 PDF 資產：${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
