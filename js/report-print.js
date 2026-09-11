const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

export function formatReportDate(date = new Date()) {
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function renderReportShell({ title, metadata = [], columns, rows, wide = false }) {
  const meta = metadata.filter((item) => item?.value !== undefined && item?.value !== null && item.value !== "");
  return `<div class="report-document batch-report-document">
    <header class="report-header"><h2>${escapeHtml(title)}</h2>${meta.length ? `<div class="report-meta">${meta.map((item) => `<span>${escapeHtml(item.label)}：${escapeHtml(item.value)}</span>`).join("")}</div>` : ""}</header>
    <table class="report-table${wide ? " report-table--wide" : ""}">
      <thead><tr>${columns.map((column) => `<th${column.className ? ` class="${escapeHtml(column.className)}"` : ""}>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td${column.className ? ` class="${escapeHtml(column.className)}"` : ""}>${escapeHtml(typeof column.value === "function" ? column.value(row) : row[column.key])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  </div>`;
}

export function createReportPrinter({ host, pageStyle, getOrientation, getReport, getRowCount, emptyMessage = "目前沒有可列印的查詢結果。", onEmpty = window.alert }) {
  function sync() {
    const hasRows = getRowCount() > 0;
    host.innerHTML = hasRows ? renderReportShell(getReport()) : "";
    const orientation = getOrientation();
    host.className = `batch-report-host orientation-${orientation}${hasRows ? " is-print-ready" : ""}`;
    pageStyle.textContent = `@page { size: A4 ${orientation}; margin: 8mm; }`;
    return hasRows;
  }
  function print() {
    if (!sync()) { onEmpty(emptyMessage); return false; }
    window.print(); return true;
  }
  return { print, sync };
}
