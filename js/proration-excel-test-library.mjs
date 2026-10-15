// Tests use the same ExcelJS version as production. No repository dependency is installed.
import { pathToFileURL } from "node:url";
export async function testExcelJs() {
  if (!process.env.PRORATION_EXCELJS_PATH) throw new Error("Set PRORATION_EXCELJS_PATH to ExcelJS 4.4.0 (see reference/fixtures/proration-batch/README.md).");
  return (await import(pathToFileURL(process.env.PRORATION_EXCELJS_PATH).href)).default;
}
