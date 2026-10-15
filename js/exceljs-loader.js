export const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
let pending;
export function loadExcelJs() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!pending) pending = new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = EXCELJS_URL;
    script.onload = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error("ExcelJS 載入失敗。"));
    script.onerror = () => { script.remove(); reject(new Error("無法載入 Excel 元件，請確認網路連線後重試。")); };
    document.head.append(script);
  }).catch((error) => { pending = undefined; throw error; });
  return pending;
}
