// Input adapters only. All tax arithmetic belongs to proration-calculations.js.
export const isBlank = (value) => value == null || (typeof value === "string" && value.trim() === "");
const ok = (value, warnings = []) => ({ value, warnings });
const fail = (message) => { throw new Error(message); };

export function normalizeNumber(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail("數字超出可安全處理範圍。");
    return value;
  }
  if (typeof value !== "string") fail("請輸入數字。");
  const text = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) fail("數字格式不正確。");
  return normalizeNumber(Number(text.replaceAll(",", "")));
}

export function normalizeYear(value) {
  if (typeof value !== "number" && typeof value !== "string") fail("年度格式不正確。");
  const text = String(value).trim();
  if (!/^\d{1,4}$/.test(text)) fail("年度格式不正確。");
  const year = Number(text);
  if (year >= 1912 && year <= 9999) return year;
  if (year >= 1 && (text.length <= 3 || /^0\d{3}$/.test(text))) return year + 1911;
  fail("請使用西元年度或民國年度。");
}

function calendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1912 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail("日期不存在或超出支援範圍（1912–9999）。");
  return date.toISOString().slice(0, 10);
}

export function normalizeDate(value, { date1904 = false } = {}) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail("日期格式不正確。");
    return ok(calendarDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()), value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds() || value.getUTCMilliseconds() ? ["日期含時間，僅使用 UTC 日期部分。"] : []);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 3000000) fail("Excel 日期序號無效。");
    const day = Math.floor(value);
    if (!date1904 && day === 60) fail("Excel 1900/2/29 並非真實日期。");
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const date = new Date(epoch + (day - (!date1904 && day > 60 ? 1 : 0)) * 86400000);
    return ok(calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()), value !== day ? ["日期含時間，僅使用日期部分。"] : []);
  }
  if (typeof value !== "string") fail("日期格式不正確。");
  const match = /^(\d{1,4})([/-])(\d{1,2})\2(\d{1,2})$/.exec(value.trim());
  if (!match) fail("請使用 YYYY-MM-DD、西元或民國年/月/日。");
  return ok(calendarDate(normalizeYear(match[1]), Number(match[3]), Number(match[4])));
}

export function normalizeInput(value, type, context = {}) {
  if (isBlank(value)) return ok("");
  if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) fail("不接受 Excel 公式或快取值，請貼上為值。");
  // Formula, error, rich-text and other workbook objects must never coerce to numbers.
  if (type === "date") return normalizeDate(value, context);
  if (type === "number") return ok(normalizeNumber(value));
  if (type === "year") return ok(normalizeYear(value));
  if (type === "payer") {
    const mapped = new Map([["buyer", "buyer"], ["seller", "seller"], ["買方", "buyer"], ["賣方", "seller"]]).get(typeof value === "string" ? value.trim() : value);
    if (!mapped) fail("支付方僅可填買方或賣方。");
    return ok(mapped);
  }
  if (type === "boolean") {
    const mapped = new Map([[true, true], [false, false], [1, true], [0, false], ["是", true], ["否", false], ["true", true], ["false", false], ["1", true], ["0", false]]);
    const key = typeof value === "string" ? value.trim() : value;
    if (!mapped.has(key)) fail("是否輸出請填是或否。");
    return ok(mapped.get(key));
  }
  if (typeof value !== "string") fail("請輸入文字。");
  return ok(value.trim());
}
