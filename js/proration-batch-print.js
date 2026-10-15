import { evaluateBatch } from "./proration-batch-state.js";
import { renderProrationReport } from "./proration-report.js?v=20261015-1";

// Re-evaluate at print time so the output always follows the current common
// settings, raw overrides, validation and existing single-case calculators.
export function prepareBatchPrint(batch) {
  const evaluated = evaluateBatch(batch);
  const invalidSelected = evaluated.filter((row) => row.selected && !row.valid).map((row) => ({
    id: row.id,
    label: row.state.customer.label || row.state.customer.doorplate || "未填戶別",
    reason: row.errors.map((error) => error.message).join("；") || "資料驗證未通過"
  }));
  const pages = evaluated.filter((row) => row.valid && row.canOutput).map((row) => ({
    id: row.id,
    label: row.state.customer.label || row.state.customer.doorplate || "未填戶別",
    html: renderProrationReport(row.state, row.results, { batch: true })
  }));
  return { pages, invalidSelected };
}

export function buildBatchPrintPages(batch) { return prepareBatchPrint(batch).pages; }
