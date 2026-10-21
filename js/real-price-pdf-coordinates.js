export const REAL_PRICE_PDF_ASSETS = Object.freeze({
  template: "./reference/government-forms/實價登錄委托書-自訂標的區.pdf",
  font: "./reference/government-forms/fonts/TW-Kai-98_1.ttf",
});

export const REAL_PRICE_TEMPLATE = Object.freeze({
  sha256: "63df3be8f34d151741b9f516d19f0da375f42fbd4cc7dd85e2648f8aa273b6ca",
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  sizeTolerance: 0.75,
  mainEntrustorCapacity: 2,
  appendixCapacity: 16,
});

const personField = (x, width, cellTop, cellBottom, minLetterSpacing = -1.2) => ({
  x, width, cellTop, cellBottom, fontSize: 14.04, minLetterSpacing,
});

const addressField = (cellTop, cellBottom) => ({
  x: 124,
  width: 261,
  cellTop,
  cellBottom,
  fontSize: 14.04,
  lineHeight: 16,
  maxLines: 2,
});

export const REAL_PRICE_MAIN_FIELDS = Object.freeze({
  propertyDescription: {
    x: 73,
    y: 660,
    width: 466,
    autoMaxFontSize: 12,
    autoMinFontSize: 9,
    manualMinFontSize: 9,
    manualMaxFontSize: 13,
    fontSizeStep: 0.5,
    lineHeightOffset: 2,
    minimumY: 598.5,
    shareGap: 8,
    tableTopY: 696,
    tableMinimumY: 598.5,
    tablePaddingX: 5,
    tablePaddingY: 2.5,
    tableLineWidth: 0.55,
    tableShareMinWidth: 58,
  },
  declarationCheckbox: { x: 56.77, y: 540.91, width: 15.96, height: 15.96 },
  agent: Object.freeze({
    name: personField(124, 110, 409.2, 451.8),
    idNumber: personField(278, 107, 409.2, 451.8, -0.7),
    phone: personField(428, 107, 409.2, 451.8, -0.7),
    address: addressField(453.36, 495.84),
  }),
  entrustors: Object.freeze([
    Object.freeze({
      name: personField(124, 110, 497.4, 539.88),
      idNumber: personField(278, 107, 497.4, 539.88, -0.7),
      phone: personField(428, 107, 497.4, 539.88, -0.7),
      address: addressField(541.44, 583.92),
    }),
    Object.freeze({
      name: personField(124, 110, 585.48, 627.96),
      idNumber: personField(278, 107, 585.48, 627.96, -0.7),
      phone: personField(428, 107, 585.48, 627.96, -0.7),
      address: addressField(629.52, 672.12),
    }),
  ]),
});

export const REAL_PRICE_APPENDIX_FIELDS = Object.freeze({
  firstCellTop: 76.2,
  rowHeight: 42.96,
  rowStep: 43.8,
  name: Object.freeze({ x: 135, width: 106, fontSize: 14.04, minLetterSpacing: -1.2 }),
  idNumber: Object.freeze({ x: 283, width: 105, fontSize: 14.04, minLetterSpacing: -0.7 }),
  phone: Object.freeze({ x: 429, width: 106, fontSize: 14.04, minLetterSpacing: -0.7 }),
});
