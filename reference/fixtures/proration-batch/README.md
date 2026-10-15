# 分算批次回歸資料

這些是新建的合成 regression fixtures，未修改其他既有測試資料。

- `template.xlsx`：舊版 23 欄空白範本，用於匯入相容測試。新版 24 欄範本由測試直接產生。
- `golden.xlsx` + `common.json`：鄭啟明／立源，房屋稅 11,029、地價稅 3,698、抵銷 -7,331（立源補鄭啟明）。
- `mixed.xlsx`：空白列、正常、文字數字錯誤、含快取結果的公式、持分分母零、無效日期、Excel 百分比格式及不勾選列。
- `dates-1900.xlsx`、`dates-1904.xlsx`：相同 2026-10-01 的 serial 與真正日期儲存格。

使用網站現有 ExcelJS 4.4.0，無需新增專案套件。將官方同版 browser bundle 下載至暫存位置後執行：

```sh
curl -fL https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js -o /tmp/proration-exceljs.cjs
PRORATION_EXCELJS_PATH=/tmp/proration-exceljs.cjs node --test js/*.test.mjs
```

重建本目錄中舊版 23 欄 XLSX 及 common.json（不會修改其他 fixtures）。先設 `PRORATION_FIXTURE_OUTPUT_DIR` 可寫入其他目錄，以免覆蓋已核對的樣本：

```sh
PRORATION_EXCELJS_PATH=/tmp/proration-exceljs.cjs \
PRORATION_FIXTURE_OUTPUT_DIR=/tmp/proration-batch-fixtures \
node scripts/build-proration-fixtures.mjs
```

`proration-batch-excel.js` 接受注入 ExcelJS，瀏覽器未注入時才呼叫共用 CDN loader。
`readBatchExcel(bufferOrFile, { common, ExcelJS })` 回傳 raw `batch` 與 `evaluated`。
共用設定快照不自動匯入；由呼叫者提供目前 common。

資料原則：raw `row.values` 保留錯誤輸入；`evaluateBatch` 每次 resolve 後呼叫原單戶計算器，結果不回寫。
`row.source.cells` 保留位址、原值與數字格式。Excel 百分比格式需更正為一般數字，1 代表 1%。
後續 UI 明確確認並改寫稅率時，也應移除該欄舊的 `numberFormat`，以解除格式錯誤，即使新數字與舊值相同。
日期以 UTC 年月日處理；支援業務年度 1912–9999，舊日期及 Excel 虛構 1900/2/29 均拒絕。
