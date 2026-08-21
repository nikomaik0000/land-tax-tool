import assert from "node:assert/strict";
import { CPI_SOURCE, loadDefaultCpiSource } from "./cpi-source.js";

const response = (label, ok = true) => ({ ok, status: ok ? 200 : 404, blob: async () => ({ label }) });

{
  const calls = [];
  const result = await loadDefaultCpiSource({
    fetchImpl: async (url) => { calls.push(url); return response("official"); },
    parseWorkbook: async (workbook) => ({ parsed: workbook.label })
  });
  assert.equal(result.type, "official");
  assert.equal(result.data.parsed, "official");
  assert.deepEqual(calls, [CPI_SOURCE.officialUrl]);
}

{
  const calls = [];
  const result = await loadDefaultCpiSource({
    fetchImpl: async (url) => { calls.push(url); if (url === CPI_SOURCE.officialUrl) throw new TypeError("CORS"); return response("bundled"); },
    parseWorkbook: async (workbook) => ({ parsed: workbook.label })
  });
  assert.equal(result.type, "bundled");
  assert.equal(result.data.parsed, "bundled");
  assert.deepEqual(calls, [CPI_SOURCE.officialUrl, CPI_SOURCE.bundledPath]);
}

await assert.rejects(() => loadDefaultCpiSource({
  fetchImpl: async () => { throw new Error("unavailable"); },
  parseWorkbook: async () => ({})
}), /請手動上傳 Excel/);

console.log("cpi source priority and fallback tests passed");
