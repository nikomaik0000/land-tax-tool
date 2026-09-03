import { readVatExcel } from "./vat-excel-import.js";

const response = await fetch("../reference/fixtures/vat-excel-taipei-436.xlsx");
if (!response.ok) throw new Error(`fixture HTTP ${response.status}`);
const blob = await response.blob();
const result = await readVatExcel(new File([blob], "vat-excel-taipei-436.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
const transfers = result.lands[0]?.previousTransfers?.map(({ previousValue, shareNumerator, shareDenominator, priceIndex }) => ({ previousValue, shareNumerator, shareDenominator, priceIndex }));
const expected = [
  { previousValue: 120000, shareNumerator: 112, shareDenominator: 14400, priceIndex: 159.7 },
  { previousValue: 432000, shareNumerator: 112, shareDenominator: 72000, priceIndex: 103.2 }
];
if (result.lands.length !== 1 || result.transferCount !== 2 || JSON.stringify(transfers) !== JSON.stringify(expected)) throw new Error(`unexpected import: ${JSON.stringify(result)}`);
document.querySelector("#result").textContent = JSON.stringify({ lands: result.lands.length, transfers, owners: result.owners.map((owner) => owner.name), headerRow: result.headerRow }, null, 2);
document.body.dataset.status = "passed";
