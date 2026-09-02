const FORMAL_QUALIFIER = /^(?:特|[A-ZＡ-Ｚ]區|[一二三四五六七八九十]+|住|商)$/;

export function getShortZoningLabel(zoning) {
  const source = String(zoning ?? "").trim();
  const firstBracket = source.search(/[（(]/);
  if (firstBracket < 0) return source;

  let result = source.slice(0, firstBracket).trim();
  let rest = source.slice(firstBracket);
  while (rest) {
    const match = rest.match(/^([（(])([^（）()]*)[）)]/);
    if (!match || !FORMAL_QUALIFIER.test(match[2].trim())) break;
    result += match[0];
    rest = rest.slice(match[0].length);
  }
  return result;
}

export function formatZoningForPrint(zonings, mode = "full") {
  const values = Array.isArray(zonings) ? zonings : [zonings];
  const formatted = values
    .map((value) => mode === "short" ? getShortZoningLabel(value) : String(value ?? "").trim())
    .filter(Boolean);
  return [...new Set(formatted)].join("、");
}

export function getVisiblePrintColumns(displayOptions = {}) {
  const visibility = { district: true, section: true, subsection: true, owner: true, ...(displayOptions.printLandColumns ?? {}) };
  const columns = [
    visibility.district && { key: "district", className: "r-district", label: "區" },
    visibility.section && { key: "section", className: "r-section", label: "段" },
    visibility.subsection && { key: "subsection", className: "r-subsection", label: "小段" },
    { key: "number", className: "r-number", label: "地號" },
    { key: "area", className: "r-area", label: "面積" },
    visibility.owner && { key: "owner", className: "r-owner", label: "所有<br>權人" },
    { key: "announced", className: "r-announced", label: "公告<br>現值" },
    { key: "share", className: "r-share", label: "持分" },
    { key: "current", className: "r-current", label: "總現值" },
    { key: "date", className: "r-date", label: "前次<br>移轉日期" },
    { key: "previous", className: "r-previous", label: "前次<br>移轉現值" },
    { key: "index", className: "r-index", label: "物價<br>指數" },
    displayOptions.showSelfUseTax && { key: "selfUseTax", className: "r-tax", label: "自用<br>增值稅" },
    { key: "generalTax", className: "r-tax", label: "一般<br>增值稅" },
    displayOptions.showLandZoning && displayOptions.zoningPrintLayout === "column" && { key: "zoning", className: "r-zoning", label: "使用分區" }
  ];
  return columns.filter(Boolean);
}
