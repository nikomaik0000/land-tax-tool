export const CPI_SOURCE = Object.freeze({
  officialUrl: "https://ws.dgbas.gov.tw/001/Upload/463/relfile/10315/2677/cpispleym.xls",
  bundledPath: "./material/cpispleym.xls",
  sourcePage: "https://www.stat.gov.tw/cp.aspx?n=2665",
  timeoutMs: 4000
});

async function fetchWorkbook(url, { fetchImpl, signal } = {}) {
  const response = await fetchImpl(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`CPI source returned HTTP ${response.status}`);
  return response.blob();
}

async function fetchOfficialWorkbook(source, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source.timeoutMs);
  try { return await fetchWorkbook(source.officialUrl, { fetchImpl, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

export async function loadDefaultCpiSource({
  parseWorkbook,
  fetchImpl = globalThis.fetch.bind(globalThis),
  source = CPI_SOURCE
}) {
  if (typeof parseWorkbook !== "function") throw new TypeError("parseWorkbook is required");
  try {
    const workbook = await fetchOfficialWorkbook(source, fetchImpl);
    return { data: await parseWorkbook(workbook), type: "official", sourceName: "官方最新資料" };
  } catch (officialError) {
    try {
      const workbook = await fetchWorkbook(source.bundledPath, { fetchImpl });
      return { data: await parseWorkbook(workbook), type: "bundled", sourceName: "專案備份資料", officialError };
    } catch (bundledError) {
      const error = new Error("無法載入預設物價指數資料，請手動上傳 Excel。");
      error.officialError = officialError;
      error.bundledError = bundledError;
      throw error;
    }
  }
}
