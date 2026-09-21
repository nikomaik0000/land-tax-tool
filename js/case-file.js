export const CASE_FILE_APP = "land-tax-tool";
export const CASE_FILE_VERSION = 1;

const PAGE_LABELS = {
  "land-tax": "土地增值稅試算",
  transcript: "謄本整理",
  "land-value-update": "公告現值更新",
  "land-number-converter": "新舊地號查詢",
  zoning: "使用分區查詢"
};

export function buildCaseFile(pageType, data, savedAt = new Date().toISOString()) {
  return { app: CASE_FILE_APP, version: CASE_FILE_VERSION, pageType, savedAt, data };
}

export function sanitizeFilename(value) {
  return String(value ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "") || "案件";
}

export function caseFilename(label, caseName = "", date = new Date()) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${sanitizeFilename([label, caseName, day].filter(Boolean).join("_"))}.json`;
}

export function migrateSavedCase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("案件檔格式錯誤，無法導入。");
  if (value.version === CASE_FILE_VERSION) return value;
  throw new Error(`不支援此案件檔版本（${String(value.version ?? "未標示")}）。`);
}

export function validateCaseFile(value, expectedPageType) {
  const migrated = migrateSavedCase(value);
  if (migrated.app !== CASE_FILE_APP) throw new Error("這不是本網站的案件檔，無法導入。");
  if (!PAGE_LABELS[migrated.pageType]) throw new Error("案件檔的頁面類型無效，無法導入。");
  if (migrated.pageType !== expectedPageType) throw new Error(`這是${PAGE_LABELS[migrated.pageType]}的案件檔，無法在${PAGE_LABELS[expectedPageType] ?? "目前"}頁導入。`);
  if (!migrated.data || typeof migrated.data !== "object" || Array.isArray(migrated.data)) throw new Error("案件檔格式錯誤，無法導入。");
  return migrated;
}

export function parseCaseFile(text, expectedPageType) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error("案件檔格式錯誤，無法導入。"); }
  return validateCaseFile(value, expectedPageType);
}

export function downloadCaseFile(caseFile, filename) {
  const blob = new Blob([JSON.stringify(caseFile, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function readCaseFile(file, expectedPageType) {
  if (!file) throw new Error("尚未選擇案件檔。");
  return parseCaseFile(await file.text(), expectedPageType);
}

export function setupCaseFileActions({ pageType, label, saveButton, importButton, serialize, restore, hasData, caseName, onError = (message) => window.alert(message) }) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".json,application/json"; input.className = "visually-hidden";
  document.body.append(input);
  saveButton?.addEventListener("click", () => {
    try { downloadCaseFile(buildCaseFile(pageType, serialize()), caseFilename(label, caseName?.())); }
    catch (error) { onError(error?.message || "案件檔無法儲存。"); }
  });
  importButton?.addEventListener("click", () => { input.value = ""; input.click(); });
  input.addEventListener("change", async () => {
    try {
      const loaded = await readCaseFile(input.files?.[0], pageType);
      if (hasData?.() && !window.confirm("導入案件會取代目前頁面資料，是否繼續？")) return;
      await restore(loaded.data);
    } catch (error) { onError(error?.message || "案件檔格式錯誤，無法導入。"); }
  });
  return input;
}
