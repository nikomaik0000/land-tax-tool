export const PRINT_TEXT_SIZES = Object.freeze(["small", "medium", "large"]);

export function normalizePrintTextSize(value, fallback = "medium") {
  return PRINT_TEXT_SIZES.includes(value) ? value : PRINT_TEXT_SIZES.includes(fallback) ? fallback : "medium";
}

export function loadPrintTextSize(key, fallback = "medium", storage = globalThis.localStorage) {
  try {
    return normalizePrintTextSize(storage?.getItem(key), fallback);
  } catch {
    return normalizePrintTextSize(fallback);
  }
}

export function savePrintTextSize(key, value, storage = globalThis.localStorage) {
  const normalized = normalizePrintTextSize(value);
  try { storage?.setItem(key, normalized); } catch { /* A blocked storage backend must not break printing. */ }
  return normalized;
}

export function applyPrintTextSizeClass(element, value, prefix = "report-font") {
  const normalized = normalizePrintTextSize(value);
  element?.classList.remove(...PRINT_TEXT_SIZES.map((size) => `${prefix}-${size}`));
  element?.classList.add(`${prefix}-${normalized}`);
  return normalized;
}
