import assert from "node:assert/strict";
import { calculateCaseCurrentValue, calculateHouseOwnerDeedTax, calculateTaxSummaryByOwner, calculateTotalDeedTax, calculateTotalHouseCurrentValue } from "./calculations.js";
import { migrateRelationshipState } from "./relationships.js";

const legacy = migrateRelationshipState({
  owner: "王○○",
  house: { address: "測試路 1 號", assessedValue: 500000, shareNumerator: 1, shareDenominator: 2 },
  lands: [{ owner: "王○○", area: 10, announcedValue: 1000, shareNumerator: 1, shareDenominator: 1, previousTransfers: [{ selfUseTax: 100, generalTax: 300 }] }],
  displayOptions: {}
});
assert.equal(legacy.owners.length, 1);
assert.equal(legacy.houses.length, 1);
assert.equal(legacy.lands[0].ownerId, legacy.owners[0].id);
assert.equal(legacy.houses[0].ownerId, legacy.owners[0].id);
assert.deepEqual(legacy.houses[0].ownerIds, [legacy.owners[0].id]);

const ownerA = { id: "owner-a", name: "王○○" }; const ownerB = { id: "owner-b", name: "陳○○" };
const sharedHouse = { id: "house-a", ownerId: ownerA.id, ownerIds: [ownerA.id, ownerB.id], assessedValue: 500000, shareNumerator: 1, shareDenominator: 2 };
const houseB = { id: "house-b", ownerId: ownerB.id, ownerIds: [ownerB.id], assessedValue: 300000, shareNumerator: 1, shareDenominator: 1 };
const lands = [
  { ownerId: ownerA.id, houseId: sharedHouse.id, area: 10, announcedValue: 1000, shareNumerator: 1, shareDenominator: 1, previousTransfers: [{ selfUseTax: 100, generalTax: 300 }] },
  { ownerId: ownerA.id, houseId: sharedHouse.id, area: 20, announcedValue: 1000, shareNumerator: 1, shareDenominator: 1, previousTransfers: [{ selfUseTax: 200, generalTax: 600 }] },
  { ownerId: ownerB.id, houseId: houseB.id, area: 30, announcedValue: 1000, shareNumerator: 1, shareDenominator: 1, previousTransfers: [{ selfUseTax: 300, generalTax: 900 }] }
];
const state = { owners: [ownerA, ownerB], houses: [sharedHouse, houseB], lands };
assert.equal(calculateTotalHouseCurrentValue(state.houses), 800000);
assert.equal(calculateCaseCurrentValue(lands, state.houses), 860000);
assert.equal(calculateTotalDeedTax(state.houses), 48000);
const halfShared = { id: "half", ownerIds: [ownerA.id, ownerB.id], assessedValue: 69090, shareNumerator: 1, shareDenominator: 2 };
assert.equal(calculateTotalHouseCurrentValue([halfShared]), 69090);
assert.equal(calculateHouseOwnerDeedTax(halfShared, 0), 2073);
assert.equal(calculateHouseOwnerDeedTax(halfShared, 1), 2072);
assert.equal(calculateTotalDeedTax([halfShared]), 4145);
const groups = calculateTaxSummaryByOwner(state);
assert.deepEqual(groups.map(({ ownerName, selfUseTax, generalTax, deedTax }) => ({ ownerName, selfUseTax, generalTax, deedTax })), [
  { ownerName: "王○○", selfUseTax: 300, generalTax: 900, deedTax: 15000 },
  { ownerName: "陳○○", selfUseTax: 300, generalTax: 900, deedTax: 33000 }
]);
assert.equal(calculateTaxSummaryByOwner({ owners: [ownerA, ownerB], lands: [lands[0]], houses: [{ ...sharedHouse, ownerIds: [ownerA.id] }, { id: "empty", ownerId: ownerB.id, ownerIds: [ownerB.id], address: "", assessedValue: 0 }] }).length, 1);
console.log("relationship migration and grouping tests passed");
