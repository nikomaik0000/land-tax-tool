import {
  HOUSE_TAX_PDF_FIELDS,
  HOUSE_TAX_TEMPLATE,
} from "./house-tax-pdf-coordinates.js";

export class HouseTaxPdfError extends Error {
  constructor(message, code = "HOUSE_TAX_PDF_ERROR") {
    super(message);
    this.name = "HouseTaxPdfError";
    this.code = code;
  }
}

export function buildHouseTaxPdfIssues(preview) {
  const issues = [];
  if (!preview?.principal) issues.push("請選擇一位義務人作為委任人");
  if (preview?.principal && !preview.principal.name) issues.push("委任人姓名缺漏");
  if (preview?.principal && !preview.principal.idNumber) issues.push("委任人身分證統一編號缺漏");
  if (!preview?.buildings?.length) issues.push("請選擇至少一筆申請建物");
  preview?.buildings?.forEach((building) => {
    if (!building.address) issues.push(`建物 ${building.buildingNumber || building.id} 的完整房屋坐落缺漏`);
  });
  return [...new Set(issues)];
}

export async function generateHouseTaxPdf({
  preview,
  templateBytes,
  fontBytes,
  pdfLib = globalThis.PDFLib,
  fontkit = globalThis.fontkit,
  cryptoApi = globalThis.crypto,
}) {
  const issues = buildHouseTaxPdfIssues(preview);
  if (issues.length) throw new HouseTaxPdfError(issues.join("；"), "INCOMPLETE_DATA");
  if (!pdfLib?.PDFDocument || !fontkit) {
    throw new HouseTaxPdfError("PDF 元件尚未載入，請重新整理後再試", "PDF_LIBRARY_UNAVAILABLE");
  }
  await assertTemplateFingerprint(templateBytes, cryptoApi);

  const pdfDocument = await pdfLib.PDFDocument.load(templateBytes, { updateMetadata: false });
  assertOfficialTemplate(pdfDocument);
  pdfDocument.registerFontkit(fontkit);
  const font = await pdfDocument.embedFont(fontBytes, { subset: true });
  const page = pdfDocument.getPage(0);
  const ink = pdfLib.rgb(0, 0, 0);
  const fields = HOUSE_TAX_PDF_FIELDS;

  if (preview.applicationItems.includes("房屋稅稅籍證明")) drawCheckbox(page, fields.certificateCheckbox, ink);
  drawBuildingAddresses(page, preview.buildings, fields.buildingAddress, font, ink);
  const authorizationAgent = drawFitText(page, preview.agent.name, fields.authorizationAgentName, font, ink);
  drawAuthorizationPhrase(page, authorizationAgent, fields.authorizationPhrase, font, ink);
  drawFitText(page, preview.principal.name, fields.principalName, font, ink);
  drawFitText(page, preview.principal.idNumber, fields.principalIdNumber, font, ink);
  drawFitText(page, preview.agent.name, fields.agentName, font, ink);
  drawFitText(page, preview.agent.idNumber, fields.agentIdNumber, font, ink);
  drawFitText(page, preview.agent.phone, fields.agentPhone, font, ink);

  pdfDocument.setTitle("房屋稅籍查詢委任書");
  pdfDocument.setSubject("Land Tax Tool 房屋稅籍查詢委任書套印");
  pdfDocument.setCreator("Land Tax Tool");
  pdfDocument.setProducer("pdf-lib");
  return pdfDocument.save({ useObjectStreams: false });
}

async function assertTemplateFingerprint(templateBytes, cryptoApi) {
  if (!cryptoApi?.subtle) {
    throw new HouseTaxPdfError("瀏覽器不支援政府範本指紋驗證，已停止套印", "CRYPTO_UNAVAILABLE");
  }
  const view = templateBytes instanceof Uint8Array ? templateBytes : new Uint8Array(templateBytes);
  const input = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  const digest = await cryptoApi.subtle.digest("SHA-256", input);
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== HOUSE_TAX_TEMPLATE.sha256) {
    throw new HouseTaxPdfError("房屋稅籍政府範本版本已變更，已停止套印並要求重新校準座標", "TEMPLATE_MISMATCH");
  }
}

function assertOfficialTemplate(pdfDocument) {
  if (pdfDocument.getPageCount() !== HOUSE_TAX_TEMPLATE.pageCount) {
    throw new HouseTaxPdfError("房屋稅籍政府範本頁數已變更，已停止套印", "TEMPLATE_MISMATCH");
  }
  const { width, height } = pdfDocument.getPage(0).getSize();
  const tolerance = HOUSE_TAX_TEMPLATE.sizeTolerance;
  if (Math.abs(width - HOUSE_TAX_TEMPLATE.width) > tolerance || Math.abs(height - HOUSE_TAX_TEMPLATE.height) > tolerance) {
    throw new HouseTaxPdfError("房屋稅籍政府範本尺寸不是預期的 A4，已停止套印", "TEMPLATE_MISMATCH");
  }
}

function drawCheckbox(page, field, color) {
  page.drawLine({
    start: { x: field.x + 2.2, y: field.y + 6.1 },
    end: { x: field.x + 5.1, y: field.y + 2.8 },
    thickness: 1.35,
    color,
  });
  page.drawLine({
    start: { x: field.x + 5.1, y: field.y + 2.8 },
    end: { x: field.x + field.width - 1.8, y: field.y + field.height - 1.6 },
    thickness: 1.35,
    color,
  });
}

function drawFitText(page, value, field, font, color, { align = "left" } = {}) {
  const text = String(value || "").trim();
  if (!text) return null;
  const size = field.fontSize || fittingFontSize(text, field.width, font, field.maxFontSize, field.minFontSize);
  if (!size) throw new HouseTaxPdfError(`「${text}」超出政府表格可套印範圍`, "TEXT_OVERFLOW");
  const characters = Array.from(text);
  const naturalWidth = font.widthOfTextAtSize(text, size);
  const letterSpacing = naturalWidth > field.width && characters.length > 1
    ? (field.width - naturalWidth) / (characters.length - 1)
    : 0;
  if (letterSpacing < (field.minLetterSpacing ?? 0)) {
    throw new HouseTaxPdfError(`「${text}」超出政府表格可套印範圍`, "TEXT_OVERFLOW");
  }
  const renderedWidth = naturalWidth + letterSpacing * Math.max(0, characters.length - 1);
  const x = align === "right" ? field.x + field.width - renderedWidth : field.x;
  if (!letterSpacing) {
    page.drawText(text, { x, y: field.y, size, font, color });
    return { x, width: renderedWidth, size };
  }
  let cursorX = x;
  characters.forEach((character) => {
    page.drawText(character, { x: cursorX, y: field.y, size, font, color });
    cursorX += font.widthOfTextAtSize(character, size) + letterSpacing;
  });
  return { x, width: renderedWidth, size };
}

function drawAuthorizationPhrase(page, agentLayout, field, font, color) {
  const phrase = "代為處理，特立此委任書為憑。";
  const normalSpace = font.widthOfTextAtSize(" ", field.fontSize);
  const x = agentLayout
    ? agentLayout.x + agentLayout.width + normalSpace
    : field.defaultX;
  const width = field.x + field.width - x;
  drawFitText(page, phrase, { ...field, x, width }, font, color);
}

function drawBuildingAddresses(page, buildings, field, font, color) {
  for (let size = field.maxFontSize; size >= field.minFontSize; size -= 0.2) {
    const prefix = "房屋坐落：";
    const addressX = field.x + font.widthOfTextAtSize(prefix, size);
    const addressWidth = field.x + field.width - addressX;
    const lines = buildings.flatMap((building) => (
      wrapText(String(building.address || "").trim(), addressWidth, font, size)
    ));
    if (lines.length > field.maxLines) continue;
    page.drawText(prefix, {
      x: field.x,
      y: field.y,
      size,
      font,
      color,
    });
    lines.forEach((line, index) => page.drawText(line, {
      x: addressX,
      y: field.y - index * field.lineHeight,
      size,
      font,
      color,
    }));
    return;
  }
  throw new HouseTaxPdfError("選定房屋坐落超出放大後的四行空間；請減少本次申請建物或確認續頁方案", "ADDRESS_OVERFLOW");
}

function fittingFontSize(text, width, font, maximum, minimum) {
  for (let size = maximum; size >= minimum; size -= 0.2) {
    if (font.widthOfTextAtSize(text, size) <= width) return size;
  }
  return null;
}

function wrapText(text, width, font, size) {
  const lines = [];
  let current = "";
  for (const character of text) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      const separatorIndex = current.lastIndexOf("；");
      if (separatorIndex > 0) {
        lines.push(current.slice(0, separatorIndex + 1));
        current = `${current.slice(separatorIndex + 1)}${character}`;
      } else {
        lines.push(current);
        current = character;
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
