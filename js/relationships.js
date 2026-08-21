const makeId = (prefix) => globalThis.crypto?.randomUUID ? `${prefix}-${globalThis.crypto.randomUUID()}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cleanName = (value) => String(value ?? "").trim();

export function createOwner(name = "") {
  return { id: makeId("owner"), name: cleanName(name) };
}

export function createHouse(overrides = {}) {
  return {
    id: makeId("house"), address: "", assessedValue: 0, shareNumerator: 1,
    shareDenominator: 1, ownerId: null, ownerIds: [], currentValue: 0, deedTax: 0, ...overrides
  };
}

export function ownerName(state, ownerId, fallback = "") {
  return state?.owners?.find((owner) => owner.id === ownerId)?.name ?? fallback ?? "";
}

export function ensureOwner(state, name) {
  const normalized = cleanName(name);
  if (!normalized) return null;
  let owner = state.owners.find((item) => cleanName(item.name) === normalized);
  if (!owner) { owner = createOwner(normalized); state.owners.push(owner); }
  return owner;
}

export function migrateRelationshipState(state) {
  state.owners = Array.isArray(state.owners) ? state.owners.filter(Boolean).map((owner) => ({ id: owner.id || makeId("owner"), name: cleanName(owner.name) })) : [];
  const legacyDefaultOwner = cleanName(state.owner ?? state.defaultOwner);
  const defaultOwner = ensureOwner(state, legacyDefaultOwner);

  const legacyHouse = state.house;
  state.houses = Array.isArray(state.houses) ? state.houses.filter(Boolean).map((house) => createHouse({ ...house, ownerIds: Array.isArray(house.ownerIds) ? [...new Set(house.ownerIds)] : house.ownerId ? [house.ownerId] : [] })) : [];
  if (!state.houses.length && legacyHouse && (cleanName(legacyHouse.address) || Number(legacyHouse.assessedValue) > 0)) {
    const legacyOwnerId = legacyHouse.ownerId || defaultOwner?.id || null;
    state.houses.push(createHouse({ ...legacyHouse, ownerId: legacyOwnerId, ownerIds: legacyOwnerId ? [legacyOwnerId] : [] }));
  }

  for (const land of state.lands ?? []) {
    const legacyLandOwner = ensureOwner(state, land.owner);
    land.ownerId = state.owners.some((owner) => owner.id === land.ownerId) ? land.ownerId : legacyLandOwner?.id || defaultOwner?.id || null;
    land.owner = ownerName(state, land.ownerId, land.owner);
    land.houseId = state.houses.some((house) => house.id === land.houseId) ? land.houseId : null;
  }
  for (const house of state.houses) {
    house.ownerIds = [...new Set((house.ownerIds ?? []).filter((id) => state.owners.some((owner) => owner.id === id)))];
    if (!house.ownerIds.length && defaultOwner) house.ownerIds = [defaultOwner.id];
    house.ownerId = house.ownerIds[0] ?? null;
  }
  state.owner = legacyDefaultOwner;
  state.house = state.houses[0] ?? createHouse();
  if (typeof state.displayOptions?.showCaseTotal !== "boolean") state.displayOptions.showCaseTotal = false;
  return state;
}

export function relatedHouses(state) {
  const ids = new Set((state?.lands ?? []).map((land) => land.houseId).filter(Boolean));
  return (state?.houses ?? []).filter((house) => ids.has(house.id));
}

export function houseLabel(house, index) {
  const address = cleanName(house?.address);
  return `房屋 ${index + 1}${address ? `：${address}` : ""}`;
}
