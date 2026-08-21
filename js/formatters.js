export function parseFormattedNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export function formatMoney(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Math.round(number).toLocaleString("zh-TW");
}

export function formatArea(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("zh-TW", { maximumFractionDigits: 10 });
}

export function formatLandNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  const officialCode = text.match(/^\d{8}$/);
  if (officialCode) {
    const main = Number.parseInt(text.slice(0, 4), 10);
    const sub = Number.parseInt(text.slice(4), 10);
    if (!Number.isFinite(main) || !Number.isFinite(sub)) return text;
    return sub === 0 ? String(main) : `${main}-${sub}`;
  }

  const match = text.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return text;

  const mainNumber = Number.parseInt(match[1], 10);
  if (!Number.isFinite(mainNumber)) return text;
  const main = String(mainNumber);
  if (match[2] === undefined) return main;

  const sub = Number.parseInt(match[2], 10);
  if (!Number.isFinite(sub) || sub === 0) return main;
  return `${main}-${sub}`;
}

export function formatSequence(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return text;
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) ? String(number) : text;
}
