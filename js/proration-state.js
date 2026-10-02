const DAY_MS = 86400000;
const days = (start, end) => start && end ? Math.floor((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / DAY_MS) + 1 : "";
export const createHouseTax = () => ({ amount: "", taxableMonths: "", taxStartDate: "", prorationStartDate: "", prorationEndDate: "", payer: "seller", taxNote: "" });
export const createLandTax = () => ({ declaredLandValue: "", area: "", shareNumerator: 1, shareDenominator: 1, rate: "", taxYear: "", prorationStartDate: "", prorationEndDate: "", payer: "seller", legacyAmount: "" });
export const createProrationState = () => ({ schemaVersion: 5, shared: { caseName: "地價稅房屋稅 分算找補", seller: "", handoverDate: "", notes: [] }, customer: { id: "single", label: "", buyer: "", houseTax: createHouseTax(), landTax: createLandTax(), note: "" } });
const createId = () => globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const normalizeNotes = (notes) => Array.isArray(notes) ? notes.map((note) => ({ id: note.id || createId(), content: String(note.content ?? "") })) : [];
export function normalizeProrationState(value = {}) {
  value = value && typeof value === "object" ? value : {}; const defaults = createProrationState();
  if (value.schemaVersion === 5 && value.shared && value.customer) return { schemaVersion: 5, shared: { ...defaults.shared, ...value.shared, notes: normalizeNotes(value.shared.notes) }, customer: { ...defaults.customer, ...value.customer, houseTax: { ...createHouseTax(), ...(value.customer.houseTax ?? {}) }, landTax: { ...createLandTax(), ...(value.customer.landTax ?? {}) } } };
  const shared = value.shared ?? value; const customer = value.customer ?? value; const house = customer.houseTax ?? value.houseTax ?? {}; const land = customer.landTax ?? value.landTax ?? {}; const handoverDate = shared.handoverDate || house.splitDate || land.splitDate || "";
  const migrate = (tax, isHouse) => { const payer = tax.payer === "buyer" ? "buyer" : "seller"; const base = { prorationStartDate: tax.prorationStartDate || "", prorationEndDate: tax.prorationEndDate || "", payer };
    if (isHouse) { const estimate = tax.houseValue !== "" && tax.rate !== "" && tax.taxableMonths !== "" ? Math.round(Number(tax.houseValue) * Number(tax.rate) / 100 * Number(tax.taxableMonths) / 12) : ""; return { ...createHouseTax(), ...base, amount: tax.amount ?? (tax.approvedAmount !== "" && tax.approvedAmount !== undefined ? tax.approvedAmount : estimate), taxableMonths: tax.taxableMonths || "", taxStartDate: tax.taxStartDate || tax.startDate || "", taxNote: tax.taxNote || "" }; }
    return { ...createLandTax(), ...tax, ...base, taxYear: tax.taxYear || String(tax.prorationStartDate || tax.startDate || "").slice(0, 4), legacyAmount: tax.legacyAmount ?? tax.amount ?? "" };
  };
  return { schemaVersion: 5, shared: { ...defaults.shared, caseName: shared.caseName ?? defaults.shared.caseName, seller: shared.seller ?? "", handoverDate, notes: normalizeNotes(shared.notes) }, customer: { ...defaults.customer, id: customer.id ?? "single", label: customer.label ?? "", buyer: customer.buyer ?? "", note: customer.note ?? "", houseTax: migrate(house, true), landTax: migrate(land, false) } };
}
