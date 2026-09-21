import assert from "node:assert/strict";
import { applyEstimatedHouseValue, estimateHouseValue, updateHouseReverseEstimate } from "./house-tax-reverse.js";
import { createHouse } from "./relationships.js";

assert.equal(estimateHouseValue(1910, 0.012), 159167, "CASE A rounds to an integer");
assert.equal(estimateHouseValue(1910, ""), null, "CASE B requires a rate");
assert.equal(estimateHouseValue("", 0.012), null, "CASE C requires tax");

const formal = createHouse({ assessedValue: 200000 });
updateHouseReverseEstimate(formal, { annualHouseTax: 1910, reverseTaxRate: 0.012 });
assert.equal(formal.assessedValue, 200000, "CASE D estimate does not overwrite the formal value");
assert.equal(applyEstimatedHouseValue(formal), true);
assert.equal(formal.assessedValue, 159167, "CASE E apply updates the formal value");

const first = createHouse(); const second = createHouse();
updateHouseReverseEstimate(first, { annualHouseTax: 1910, reverseTaxRate: 0.012 });
updateHouseReverseEstimate(second, { annualHouseTax: 2400, reverseTaxRate: 0.01 });
assert.deepEqual([first.estimatedHouseValue, second.estimatedHouseValue], [159167, 240000], "CASE F houses are independent");

const restored = JSON.parse(JSON.stringify(first));
assert.equal(restored.annualHouseTax, 1910);
assert.equal(restored.reverseTaxRate, 0.012, "CASE G reverse inputs survive case JSON round trip");
console.log("house-tax reverse estimate: cases A-G passed");
