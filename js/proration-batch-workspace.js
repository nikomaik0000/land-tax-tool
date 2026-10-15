import { BATCH_FIELDS, BATCH_COMMON_FIELDS, createBatchState, evaluateBatch, getField, setField } from "./proration-batch-state.js";

export const COMMON_FIELDS = BATCH_COMMON_FIELDS;
export function commonFromSingle(single) {
  const common = { shared: { notes: structuredClone(single.shared?.notes ?? []) } };
  for (const field of COMMON_FIELDS) setField(common, field.path, structuredClone(getField(single, field.path) ?? ""));
  return common;
}

// UI state only; resolution, validation and all calculation remain in Phase 2.
export function createBatchWorkspace() {
  let batch = createBatchState({ shared: { notes: [] } });
  let evaluated = [];
  function refresh() {
    evaluated = evaluateBatch(batch);
    for (const result of evaluated) {
      if (!result.valid && result.selected) {
        batch.rows.find((row) => row.id === result.id).selected = false;
        result.selected = false; result.canOutput = false;
      }
    }
    return evaluated;
  }
  function updateField(id, path, value) {
    if (!BATCH_FIELDS.some((field) => field.path === path)) throw new Error("未知欄位。");
    const row = batch.rows.find((item) => item.id === id);
    if (!row) throw new Error("找不到戶別。");
    setField(row.values, path, value);
    // The user has now explicitly entered a value in the web form, not an Excel
    // formatted cell. Keep the original raw cell but retire its percent format.
    const source = row.source?.cells?.find((cell) => cell.path === path);
    if (source) source.numberFormat = "";
    return refresh();
  }
  function select(id, selected) {
    const row = batch.rows.find((item) => item.id === id);
    const result = evaluated.find((item) => item.id === id);
    if (!row || !result || (selected && !result.valid)) return false;
    row.selected = Boolean(selected); result.selected = Boolean(selected); result.canOutput = result.valid && result.selected;
    return true;
  }
  return {
    get batch() { return batch; }, get evaluated() { return evaluated; }, refresh, updateField, select,
    replace(imported) { batch = structuredClone(imported); return refresh(); },
    copySingle(single) { batch.common = commonFromSingle(single); return refresh(); },
    setCommon(path, value) {
      if (!COMMON_FIELDS.some((field) => field.path === path)) throw new Error("未知共用欄位。");
      setField(batch.common, path, value); return refresh();
    },
    selectAll(selected) { for (const row of evaluated) select(row.id, selected && row.valid); },
    get counts() { return { total: evaluated.length, valid: evaluated.filter((row) => row.valid).length, invalid: evaluated.filter((row) => !row.valid).length, selected: evaluated.filter((row) => row.canOutput).length }; }
  };
}
