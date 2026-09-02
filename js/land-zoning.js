export function zoningDisplayText(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))].join("、");
}

export function applyLandZoningResults(lands, results, { overwriteManual = false } = {}) {
  results.forEach((result, index) => {
    const land = lands[index];
    if (!land || (land.zoningManual && !overwriteManual)) return;
    const zonings = [...new Set((result.matches ?? []).map((match) => match.zoning).filter(Boolean))];
    land.zonings = zonings;
    land.zoning = zoningDisplayText(zonings);
    land.zoningStatus = result.status;
    if (overwriteManual) land.zoningManual = false;
  });
  return lands;
}

export function setManualLandZoning(land, value) {
  land.zoning = String(value ?? "");
  land.zonings = land.zoning.split(/[、,，\n]+/).map((item) => item.trim()).filter(Boolean);
  land.zoningStatus = "manual";
  land.zoningManual = true;
  return land;
}
