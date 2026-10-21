export const HOUSE_TAX_PDF_ASSETS = Object.freeze({
  template: "./reference/government-forms/申請房屋稅籍-動態代理人.pdf",
  font: "./reference/government-forms/fonts/TW-Kai-98_1.ttf",
});

export const HOUSE_TAX_TEMPLATE = Object.freeze({
  sha256: "5ca49da623883ffd0b385c5623dc893a9581082b045e7a2f7c57fb1887ff303c",
  pageCount: 1,
  width: 595.2,
  height: 841.92,
  sizeTolerance: 0.75,
});

// Keep the official wording and vectors unchanged while moving the complete
// lower block down to create a larger writing area below the certificate row.
export const HOUSE_TAX_PDF_LAYOUT = Object.freeze({
  splitY: 560,
  lowerShiftY: 42,
});

// PDF coordinates use a bottom-left origin. Each field stays inside an existing
// blank area on the official source page; signature and authority areas are not
// used for generated text.
export const HOUSE_TAX_PDF_FIELDS = Object.freeze({
  certificateCheckbox: { x: 102.8, y: 573.2, width: 12.2, height: 12.2 },
  buildingAddress: {
    x: 117.65,
    y: 560,
    width: 413.35,
    maxLines: 4,
    maxFontSize: 12,
    maxMultiLineFontSize: 12,
    minFontSize: 10.5,
    lineHeight: 14,
  },
  authorizationAgentName: { x: 158, y: 390.12, width: 88, fontSize: 16.08, minLetterSpacing: -1.75 },
  authorizationPhrase: { x: 158, y: 390.12, width: 373, fontSize: 16.08, defaultX: 248.98 },
  principalName: { x: 123, y: 249, width: 102, fontSize: 16.08, minLetterSpacing: -1.5 },
  principalIdNumber: { x: 331, y: 249, width: 100, fontSize: 16.08, minLetterSpacing: -0.8 },
  agentName: { x: 123, y: 198.1, width: 102, fontSize: 16.08, minLetterSpacing: -1.5 },
  agentIdNumber: { x: 331, y: 198.1, width: 100, fontSize: 16.08, minLetterSpacing: -0.8 },
  agentPhone: { x: 139, y: 159.9, width: 286, fontSize: 16.08, minLetterSpacing: -0.5 },
});
