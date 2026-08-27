export const LAND_NUMBER_SOURCES = Object.freeze({
  newTaipei: Object.freeze({
    id: "newTaipei", city: "新北市", bundledBase: "./material/land-number/new-taipei/", manifest: "manifest.json",
    freshnessNote: "新北市資料依九個地政事務所官方完整對照表提供。"
  }),
  taipei: Object.freeze({
    id: "taipei", city: "臺北市", bundledBase: "./material/land-number/taipei/", manifest: "manifest.json",
    freshnessNote: "臺北市資料依官方開放資料最新版本提供，更新頻率為不定期。"
  })
});

export function getLandNumberSourceByCity(city) {
  return Object.values(LAND_NUMBER_SOURCES).find((source) => source.city === city) ?? null;
}
