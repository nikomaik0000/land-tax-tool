export const noticeDefinitions = [
  { id: "selfUseRequiresSale", text: "增值稅自用移轉原因需買賣才能適用。" },
  { id: "giftNoSelfUse", text: "移轉如以贈與辦理則增值稅不能適用自用，增值稅及契稅納稅人為受贈人，增值稅僅能以一般辦理。" },
  { id: "giftTaxDeduction", text: "贈與辦理時增值稅及契稅由受贈人繳納且能提出自有繳納資金之證明，則贈與總額可扣抵，屆時可降低受贈淨額，贈與稅可省約增值稅及契稅合計 × 10%之稅額。" }
];

export const defaultNoticeItems = Object.fromEntries(noticeDefinitions.map((notice) => [notice.id, true]));

export function getVisibleNotices(state) {
  if (!state?.displayOptions?.showNotices) return [];
  const selected = state.displayOptions.noticeItems ?? {};
  const fixed = noticeDefinitions.filter((notice) => selected[notice.id] === true).map((notice) => ({ ...notice, type: "fixed" }));
  const custom = (state.customNotices ?? [])
    .filter((notice) => notice.enabled !== false && (String(notice.title ?? "").trim() || String(notice.content ?? "").trim()))
    .map((notice) => ({ ...notice, type: "custom" }));
  return [...fixed, ...custom];
}
