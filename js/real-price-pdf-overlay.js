import {
  REAL_PRICE_APPENDIX_FIELDS,
  REAL_PRICE_MAIN_FIELDS,
  REAL_PRICE_TEMPLATE,
} from "./real-price-pdf-coordinates.js";

export class RealPricePdfError extends Error {
  constructor(message, code = "REAL_PRICE_PDF_ERROR") {
    super(message);
    this.name = "RealPricePdfError";
    this.code = code;
  }
}

export function buildRealPricePdfIssues(preview) {
  const propertyDescription = String(preview?.propertyDescription || "");
  return /持分\s*[：:]\s*待確認/.test(propertyDescription)
    ? ["本次買賣移轉持分待確認；請先在不動產標的欄手動修正"]
    : [];
}

export function arrangeRealPriceEntrustors(entrustors = []) {
  const rights = entrustors.filter((party) => party.title === "權利人");
  const obligors = entrustors.filter((party) => party.title === "義務人");
  const main = [rights[0], obligors[0]].filter(Boolean);
  const selected = new Set(main);
  for (const party of entrustors) {
    if (main.length >= REAL_PRICE_TEMPLATE.mainEntrustorCapacity) break;
    if (!selected.has(party)) {
      main.push(party);
      selected.add(party);
    }
  }
  return {
    main,
    appendix: entrustors.filter((party) => !selected.has(party)),
  };
}

export async function generateRealPricePdf({
  preview,
  templateBytes,
  fontBytes,
  propertyLayout = "borderless",
  pdfLib = globalThis.PDFLib,
  fontkit = globalThis.fontkit,
  cryptoApi = globalThis.crypto,
}) {
  if (!pdfLib?.PDFDocument || !fontkit) {
    throw new RealPricePdfError("PDF 元件尚未載入，請重新整理後再試", "PDF_LIBRARY_UNAVAILABLE");
  }
  await assertTemplateFingerprint(templateBytes, cryptoApi);

  const source = await pdfLib.PDFDocument.load(templateBytes, { updateMetadata: false });
  assertOfficialTemplate(source);
  const pdfDocument = await pdfLib.PDFDocument.create();
  pdfDocument.registerFontkit(fontkit);
  const font = await pdfDocument.embedFont(fontBytes, { subset: true });
  const [mainPage] = await pdfDocument.copyPages(source, [0]);
  pdfDocument.addPage(mainPage);

  const entrustors = Array.isArray(preview?.entrustors) ? preview.entrustors : [];
  const placement = arrangeRealPriceEntrustors(entrustors);
  const appendixParties = placement.appendix;
  const appendixPageCount = Math.ceil(appendixParties.length / REAL_PRICE_TEMPLATE.appendixCapacity);
  for (let pageIndex = 0; pageIndex < appendixPageCount; pageIndex += 1) {
    const [appendixPage] = await pdfDocument.copyPages(source, [1]);
    pdfDocument.addPage(appendixPage);
  }

  const ink = pdfLib.rgb(0, 0, 0);
  drawMainPage(pdfDocument.getPage(0), preview || {}, placement.main, font, ink, propertyLayout);
  for (let pageIndex = 0; pageIndex < appendixPageCount; pageIndex += 1) {
    const start = pageIndex * REAL_PRICE_TEMPLATE.appendixCapacity;
    drawAppendixPage(
      pdfDocument.getPage(pageIndex + 1),
      appendixParties.slice(start, start + REAL_PRICE_TEMPLATE.appendixCapacity),
      font,
      ink,
    );
  }

  pdfDocument.setTitle("實價登錄委託書");
  pdfDocument.setSubject("Land Tax Tool 實價登錄委託書套印");
  pdfDocument.setCreator("Land Tax Tool");
  pdfDocument.setProducer("pdf-lib");
  return pdfDocument.save({ useObjectStreams: false });
}

function drawMainPage(page, preview, entrustors, font, ink, propertyLayout) {
  const fields = REAL_PRICE_MAIN_FIELDS;
  const fontSetting = { mode: preview.propertyFontMode, size: preview.propertyFontSize };
  if (propertyLayout === "bordered-comparison") {
    drawBorderedPropertyTable(page, preview.propertyDescription, fields.propertyDescription, font, ink, fontSetting);
  } else {
    drawPropertyDescription(page, preview.propertyDescription, fields.propertyDescription, font, ink, fontSetting);
  }
  if (preview.matter === "申報登錄資訊") drawCheckbox(page, fields.declarationCheckbox, ink);
  drawPerson(page, preview.agent || {}, fields.agent, font, ink, { includeAddress: true });
  fields.entrustors.forEach((slot, index) => {
    drawPerson(page, entrustors[index] || {}, slot, font, ink, { includeAddress: true });
  });
}

function drawAppendixPage(page, parties, font, ink) {
  const fields = REAL_PRICE_APPENDIX_FIELDS;
  parties.forEach((party, index) => {
    const cellTop = fields.firstCellTop + index * fields.rowStep;
    const cellBottom = cellTop + fields.rowHeight;
    drawFixedText(page, party.name, { ...fields.name, cellTop, cellBottom }, font, ink);
    drawFixedText(page, party.idNumber, { ...fields.idNumber, cellTop, cellBottom }, font, ink);
    drawFixedText(page, party.phone, { ...fields.phone, cellTop, cellBottom }, font, ink);
  });
}

function drawPerson(page, person, fields, font, color, { includeAddress = false } = {}) {
  drawFixedText(page, person.name, fields.name, font, color);
  drawFixedText(page, person.idNumber, fields.idNumber, font, color);
  drawFixedText(page, person.phone, fields.phone, font, color);
  if (includeAddress) drawWrappedText(page, person.address, fields.address, font, color, "地址");
}

function drawPropertyDescription(page, value, field, font, color, fontSetting) {
  const rows = normalizePropertyRows(value);
  if (!rows.length) return;
  const fontSize = resolveRealPricePropertyFontSize(rows, field, font, fontSetting);
  const lineHeight = fontSize + field.lineHeightOffset;
  const shareWidth = Math.max(0, ...rows.map((row) => font.widthOfTextAtSize(row.share, fontSize)));
  const maximumTargetWidth = shareWidth
    ? field.width - field.shareGap - shareWidth
    : field.width;
  if (maximumTargetWidth <= 0) {
    throw new RealPricePdfError("不動產持分內容超出官方主表可用寬度", "PROPERTY_OVERFLOW");
  }
  const naturalTargetWidth = Math.max(0, ...rows.map((row) => font.widthOfTextAtSize(row.target, fontSize)));
  const targetWidth = Math.min(naturalTargetWidth || maximumTargetWidth, maximumTargetWidth);
  const shareX = field.x + targetWidth + field.shareGap;
  const layout = rows.map((row) => ({
    ...row,
    targetLines: wrapText(row.target, targetWidth, font, fontSize),
  }));
  const lineCount = layout.reduce((total, row) => total + Math.max(1, row.targetLines.length), 0);
  const maxLines = Math.floor((field.y - field.minimumY) / lineHeight) + 1;
  if (lineCount > maxLines) {
    throw new RealPricePdfError(
      `不動產標的以 ${formatPointSize(fontSize)}pt 排版時超出官方主表可用的 ${maxLines} 行空間；請調低字級、縮短手動標示或確認續頁方案`,
      "PROPERTY_OVERFLOW",
    );
  }
  let lineIndex = 0;
  layout.forEach((row) => {
    const targetLines = row.targetLines.length ? row.targetLines : [""];
    targetLines.forEach((line) => {
      if (line) page.drawText(line, {
        x: field.x,
        y: field.y - lineIndex * lineHeight,
        size: fontSize,
        font,
        color,
      });
      lineIndex += 1;
    });
    if (row.share) page.drawText(row.share, {
      x: shareX,
      y: field.y - (lineIndex - targetLines.length) * lineHeight,
      size: fontSize,
      font,
      color,
    });
  });
}

function drawBorderedPropertyTable(page, value, field, font, color, fontSetting) {
  const rows = normalizePropertyRows(value);
  if (!rows.length) return;
  const fontSize = resolveRealPricePropertyFontSize(rows, field, font, fontSetting, "bordered-comparison");
  const layout = buildBorderedPropertyTableLayout(rows, field, font, fontSize);
  if (layout.bottomY < field.tableMinimumY) {
    throw new RealPricePdfError(
      `不動產標的雙欄表格以 ${formatPointSize(fontSize)}pt 排版時超出政府主表可用空間；請調低字級、縮短手動標示或減少比較資料`,
      "PROPERTY_OVERFLOW",
    );
  }

  page.drawRectangle({
    x: field.x,
    y: layout.bottomY,
    width: layout.tableWidth,
    height: layout.tableHeight,
    borderColor: color,
    borderWidth: field.tableLineWidth,
  });
  page.drawLine({
    start: { x: field.x + layout.targetColumnWidth, y: layout.bottomY },
    end: { x: field.x + layout.targetColumnWidth, y: field.tableTopY },
    thickness: field.tableLineWidth,
    color,
  });

  let rowTop = field.tableTopY;
  drawCenteredCellText(page, "不動產標的", field.x, layout.targetColumnWidth, rowTop, layout.headerHeight, font, fontSize, color);
  drawCenteredCellText(page, "持分", field.x + layout.targetColumnWidth, layout.shareColumnWidth, rowTop, layout.headerHeight, font, fontSize, color);
  rowTop -= layout.headerHeight;
  drawTableHorizontalLine(page, field.x, layout.tableWidth, rowTop, field.tableLineWidth, color);

  layout.rows.forEach((row, index) => {
    const firstBaseline = rowTop - field.tablePaddingY - fontSize * 0.82;
    row.targetLines.forEach((line, lineIndex) => page.drawText(line, {
      x: field.x + field.tablePaddingX,
      y: firstBaseline - lineIndex * layout.lineHeight,
      size: fontSize,
      font,
      color,
    }));
    if (row.shareValue) page.drawText(row.shareValue, {
      x: field.x + layout.targetColumnWidth + field.tablePaddingX,
      y: firstBaseline,
      size: fontSize,
      font,
      color,
    });
    rowTop -= row.height;
    if (index < layout.rows.length - 1) {
      drawTableHorizontalLine(page, field.x, layout.tableWidth, rowTop, field.tableLineWidth, color);
    }
  });
}

export function buildBorderedPropertyTableLayout(rows, field, font, fontSize) {
  const paddingX = field.tablePaddingX;
  const paddingY = field.tablePaddingY;
  const lineHeight = fontSize + field.lineHeightOffset;
  const shareTextWidth = Math.max(
    font.widthOfTextAtSize("持分", fontSize),
    ...rows.map((row) => font.widthOfTextAtSize(row.shareValue || "", fontSize)),
  );
  const shareColumnWidth = Math.max(field.tableShareMinWidth, shareTextWidth + paddingX * 2);
  const maximumTargetColumnWidth = field.width - shareColumnWidth;
  if (maximumTargetColumnWidth <= paddingX * 2) {
    throw new RealPricePdfError("不動產持分內容超出雙欄表格可用寬度", "PROPERTY_OVERFLOW");
  }
  const targetNaturalWidth = Math.max(
    font.widthOfTextAtSize("不動產標的", fontSize),
    ...rows.map((row) => font.widthOfTextAtSize(row.target, fontSize)),
  ) + paddingX * 2;
  const targetColumnWidth = Math.min(maximumTargetColumnWidth, Math.max(160, targetNaturalWidth));
  const targetTextWidth = targetColumnWidth - paddingX * 2;
  const laidOutRows = rows.map((row) => {
    const targetLines = wrapText(row.target, targetTextWidth, font, fontSize);
    return {
      ...row,
      targetLines: targetLines.length ? targetLines : [""],
      height: fontSize + paddingY * 2 + Math.max(0, targetLines.length - 1) * lineHeight,
    };
  });
  const headerHeight = fontSize + paddingY * 2;
  const tableHeight = headerHeight + laidOutRows.reduce((sum, row) => sum + row.height, 0);
  return {
    rows: laidOutRows,
    lineHeight,
    headerHeight,
    targetColumnWidth,
    shareColumnWidth,
    tableWidth: targetColumnWidth + shareColumnWidth,
    tableHeight,
    bottomY: field.tableTopY - tableHeight,
  };
}

function drawCenteredCellText(page, text, x, width, topY, height, font, fontSize, color) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  page.drawText(text, {
    x: x + Math.max(0, (width - textWidth) / 2),
    y: topY - (height - fontSize) / 2 - fontSize * 0.82,
    size: fontSize,
    font,
    color,
  });
}

function drawTableHorizontalLine(page, x, width, y, thickness, color) {
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color });
}

export function resolveRealPricePropertyFontSize(rows, field, font, setting = {}, layout = "borderless") {
  if (setting?.mode === "manual") {
    const requested = Number(setting.size);
    const fallback = field.autoMaxFontSize;
    const rounded = Number.isFinite(requested) ? Math.round(requested / field.fontSizeStep) * field.fontSizeStep : fallback;
    return Math.min(field.manualMaxFontSize, Math.max(field.manualMinFontSize, rounded));
  }
  for (let size = field.autoMaxFontSize; size >= field.autoMinFontSize; size -= field.fontSizeStep) {
    if (layout === "bordered-comparison") {
      const shareWidth = Math.max(
        field.tableShareMinWidth,
        font.widthOfTextAtSize("持分", size) + field.tablePaddingX * 2,
        ...rows.map((row) => font.widthOfTextAtSize(row.shareValue || "", size) + field.tablePaddingX * 2),
      );
      const targetWidth = field.width - shareWidth - field.tablePaddingX * 2;
      if (targetWidth > 0 && rows.every((row) => font.widthOfTextAtSize(row.target, size) <= targetWidth)) return size;
      continue;
    }
    const shareWidth = Math.max(0, ...rows.map((row) => font.widthOfTextAtSize(row.share, size)));
    const targetWidth = field.width - (shareWidth ? field.shareGap + shareWidth : 0);
    if (targetWidth > 0 && rows.every((row) => font.widthOfTextAtSize(row.target, size) <= targetWidth)) return size;
  }
  return field.autoMinFontSize;
}

function formatPointSize(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function normalizePropertyRows(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const stripped = line.replace(/^不動產(?:坐落|標的)\s*[：:]\s*/, "");
    if (!stripped) return [];
    const match = stripped.match(/^(.*?)[\s　]*持分\s*[：:]\s*(.+)$/);
    return match
      ? [{ target: match[1].trim(), share: `持分：${match[2].trim()}`, shareValue: match[2].trim() }]
      : [{ target: stripped, share: "", shareValue: "" }];
  });
}

function drawWrappedText(page, value, field, font, color, label) {
  const text = String(value || "").trim();
  if (!text) return;
  const lines = wrapText(text, field.width, font, field.fontSize);
  if (lines.length > field.maxLines) {
    throw new RealPricePdfError(`${label}超出政府表格可套印範圍`, "TEXT_OVERFLOW");
  }
  const baselineY = resolveBaselineY(page, field, lines.length);
  lines.forEach((line, index) => page.drawText(line, {
    x: field.x,
    y: baselineY - index * field.lineHeight,
    size: field.fontSize,
    font,
    color,
  }));
}

function drawFixedText(page, value, field, font, color) {
  const text = String(value || "").trim();
  if (!text) return;
  const characters = Array.from(text);
  const naturalWidth = font.widthOfTextAtSize(text, field.fontSize);
  const letterSpacing = naturalWidth > field.width && characters.length > 1
    ? (field.width - naturalWidth) / (characters.length - 1)
    : 0;
  if (naturalWidth > field.width && characters.length < 2) {
    throw new RealPricePdfError(`「${text}」超出政府表格可套印範圍`, "TEXT_OVERFLOW");
  }
  if (letterSpacing < (field.minLetterSpacing ?? 0)) {
    throw new RealPricePdfError(`「${text}」超出政府表格可套印範圍`, "TEXT_OVERFLOW");
  }
  const y = resolveBaselineY(page, field);
  if (!letterSpacing) {
    page.drawText(text, { x: field.x, y, size: field.fontSize, font, color });
    return;
  }
  let x = field.x;
  characters.forEach((character) => {
    page.drawText(character, { x, y, size: field.fontSize, font, color });
    x += font.widthOfTextAtSize(character, field.fontSize) + letterSpacing;
  });
}

function drawCheckbox(page, field, color) {
  page.drawLine({
    start: { x: field.x + 2.6, y: field.y + 7.5 },
    end: { x: field.x + 6.3, y: field.y + 3.4 },
    thickness: 1.5,
    color,
  });
  page.drawLine({
    start: { x: field.x + 6.3, y: field.y + 3.4 },
    end: { x: field.x + field.width - 2.2, y: field.y + field.height - 2.1 },
    thickness: 1.5,
    color,
  });
}

function wrapText(text, width, font, size) {
  const lines = [];
  let current = "";
  for (const character of Array.from(text)) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  keepParentheticalSuffixWithAddress(lines, width, font, size);
  return lines;
}

function keepParentheticalSuffixWithAddress(lines, width, font, size) {
  if (lines.length < 2 || !/^[（(]及公設[）)]$/.test(lines.at(-1))) return;
  const suffix = lines.at(-1);
  const previous = Array.from(lines.at(-2));
  let continuation = suffix;
  while (previous.length > 1 && font.widthOfTextAtSize(continuation, size) < width * 0.55) {
    const candidate = `${previous.at(-1)}${continuation}`;
    if (font.widthOfTextAtSize(candidate, size) > width) break;
    continuation = candidate;
    previous.pop();
  }
  lines[lines.length - 2] = previous.join("");
  lines[lines.length - 1] = continuation;
}

function resolveBaselineY(page, field, lineCount = 1) {
  if (Number.isFinite(field.y)) return field.y;
  const lineHeight = field.lineHeight || field.fontSize;
  const blockHeight = field.fontSize + Math.max(0, lineCount - 1) * lineHeight;
  const cellHeight = field.cellBottom - field.cellTop;
  const lowerMargin = Math.max(0, (cellHeight - blockHeight) / 2);
  return page.getHeight()
    - field.cellBottom
    + lowerMargin
    + field.fontSize * 0.2
    + Math.max(0, lineCount - 1) * lineHeight;
}

async function assertTemplateFingerprint(templateBytes, cryptoApi) {
  if (!cryptoApi?.subtle) {
    throw new RealPricePdfError("瀏覽器不支援政府範本指紋驗證，已停止套印", "CRYPTO_UNAVAILABLE");
  }
  const view = templateBytes instanceof Uint8Array ? templateBytes : new Uint8Array(templateBytes);
  const input = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  const digest = await cryptoApi.subtle.digest("SHA-256", input);
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== REAL_PRICE_TEMPLATE.sha256) {
    throw new RealPricePdfError("實價登錄政府範本版本已變更，已停止套印並要求重新校準座標", "TEMPLATE_MISMATCH");
  }
}

function assertOfficialTemplate(pdfDocument) {
  if (pdfDocument.getPageCount() !== REAL_PRICE_TEMPLATE.pageCount) {
    throw new RealPricePdfError("實價登錄政府範本頁數已變更，已停止套印", "TEMPLATE_MISMATCH");
  }
  const tolerance = REAL_PRICE_TEMPLATE.sizeTolerance;
  pdfDocument.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    if (Math.abs(width - REAL_PRICE_TEMPLATE.width) > tolerance || Math.abs(height - REAL_PRICE_TEMPLATE.height) > tolerance) {
      throw new RealPricePdfError("實價登錄政府範本尺寸不是預期的 A4，已停止套印", "TEMPLATE_MISMATCH");
    }
  });
}
