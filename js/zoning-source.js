import { normalizeCity, normalizeDistrict } from "./land-value-normalization.js";
import { applyZoningLookup, createTaipeiZoningLookup } from "./zoning-core.js";

export const TAIPEI_ZONING_BASE = "./material/zoning/taipei/";
let manifestPromise;
const districtCache = new Map();

export async function loadTaipeiZoningManifest() {
  manifestPromise ??= fetch(`${TAIPEI_ZONING_BASE}manifest.json`, { credentials: "same-origin" }).then((response) => {
    if (!response.ok) throw new Error(`臺北市使用分區資料清單載入失敗（HTTP ${response.status}）。`);
    return response.json();
  });
  return manifestPromise;
}

function districtConfig(manifest, district) {
  const name = `${normalizeDistrict(district)}區`;
  return Object.values(manifest?.districts ?? {}).find((item) => item.name === name);
}

export async function loadTaipeiZoningDistrict(district) {
  const key = normalizeDistrict(district);
  if (districtCache.has(key)) return districtCache.get(key);
  const promise = (async () => {
    const manifest = await loadTaipeiZoningManifest();
    const config = districtConfig(manifest, key);
    if (!config) throw new Error(`臺北市使用分區資料沒有「${key}區」。`);
    const response = await fetch(`${TAIPEI_ZONING_BASE}${config.file}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`臺北市${key}區使用分區資料載入失敗（HTTP ${response.status}）。`);
    return createTaipeiZoningLookup(await response.text());
  })();
  districtCache.set(key, promise);
  try { return await promise; } catch (error) { districtCache.delete(key); throw error; }
}

export async function lookupZoningRecords(records) {
  const districts = [...new Set(records.filter((record) => normalizeCity(record.city) === "臺北市").map((record) => normalizeDistrict(record.district)).filter(Boolean))];
  const indexes = new Map(await Promise.all(districts.map(async (district) => [`臺北市|${district}`, await loadTaipeiZoningDistrict(district)])));
  return applyZoningLookup(records, indexes);
}

export function clearTaipeiZoningCache() {
  manifestPromise = undefined;
  districtCache.clear();
}
