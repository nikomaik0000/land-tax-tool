export const LAND_VALUE_DATA = Object.freeze({
  year: 115,
  taipei: Object.freeze({ path: "./material/taipei_value.csv", encoding: "big5" }),
  newTaipei: Object.freeze({ path: "./material/newtaipei_value.csv", encoding: "utf-8" })
});

export const LAND_VALUE_SOURCES = Object.freeze({
  taipei: Object.freeze({
    id: "taipei",
    city: "臺北市",
    year: LAND_VALUE_DATA.year,
    bundledPath: LAND_VALUE_DATA.taipei.path,
    bundledEncoding: LAND_VALUE_DATA.taipei.encoding,
    agency: "臺北市政府地政局",
    datasetPageUrl: "https://data.taipei/dataset/detail?id=7ac6eac3-a998-43ff-a289-6a4e3203c2c3",
    preferredEncoding: "big5",
    fields: Object.freeze({
      city: ["縣市別", "縣市", "city", "country"],
      district: ["行政區", "區", "district"],
      segment: ["段小段", "段名", "segment"],
      landNumber: ["地號", "lid", "landno"],
      area: ["面積", "土地面積", "area"],
      officialValue: ["公告土地現值（新臺幣元每平方公尺）", "公告土地現值", "公告現值", "official_value_busiprval"],
      officialPrice: ["公告地價（新臺幣元每平方公尺）", "公告地價", "official_price_busiprval"]
    })
  }),
  newTaipei: Object.freeze({
    id: "newTaipei",
    city: "新北市",
    year: LAND_VALUE_DATA.year,
    bundledPath: LAND_VALUE_DATA.newTaipei.path,
    bundledEncoding: LAND_VALUE_DATA.newTaipei.encoding,
    agency: "新北市政府地政局",
    datasetPageUrl: "https://data.ntpc.gov.tw/datasets/f0dba44b-5eb5-4f40-953e-6908e335ffc9",
    preferredEncoding: "utf-8",
    fields: Object.freeze({
      city: ["country", "縣市別", "縣市", "city"],
      district: ["district", "行政區", "區"],
      segment: ["segment", "段小段", "段名"],
      landNumber: ["lid", "地號", "landno"],
      area: ["area", "面積", "土地面積"],
      officialValue: ["official_value_busiprval", "公告土地現值", "公告現值"],
      officialPrice: ["official_price_busiprval", "公告地價"]
    })
  })
});

export function getLandValueSource(sourceId) {
  return LAND_VALUE_SOURCES[sourceId] ?? null;
}
