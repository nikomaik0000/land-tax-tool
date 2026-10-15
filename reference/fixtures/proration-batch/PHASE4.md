# Phase 4 驗收與測試

此文件記錄 Phase 4 當時的操作與測試；後續 JSON 與列印功能已於 Phase 5–6 加入。

入口：`proration.html` → 批次處理。

1. 填寫共用設定，或「帶入目前單戶資料」。僅帶入共用欄位及備註，不會把買方、稅額、面積與持分套用整批。
2. 下載範本，在 Excel 一列一戶填寫，再上傳。上傳失敗保留原批次；再次上傳成功會取代各戶資料。
3. 預覽總戶數、正常／錯誤戶數及勾選數。錯誤列显示 Excel 來源列號，仍可編輯。
4. 點編輯展開個別資料。輸入框僅存個別覆寫，下方顯示共用值與目前來源；清空恢復繼承。
5. 修改即時重算，不會更新单戶表單與報表。修正錯誤後需重新勾選；全選只選正常戶。

日期與數字使用文字輸入控制項，保留錯誤原文讓使用者修正，由既有正規化／驗證模組檢查。
日期可填西元或民國，稅率 1 表示 1%。Excel 公式的原始物件會顯示供辨識，需明確改填值。

桌機使用現有表格樣式，720px 以下轉逐戶排列。
batch 僅保留頁面記憶體；離開或重新整理會提示。此階段不提供批次 JSON 儲存／導入或列印。

Node regression：沿用 README 的 ExcelJS 環境設定。

```sh
PRORATION_EXCELJS_PATH=/tmp/proration-exceljs.cjs node --test js/*.test.mjs
```

瀏覽器 regression 使用已有的 Playwright、Chrome、ExcelJS 4.4.0；單戶 PDF 驗證需同環境已有 pdf-lib。沒有新增專案套件。

```sh
PRORATION_PLAYWRIGHT_PATH=/absolute/path/to/node_modules/playwright \
PRORATION_EXCELJS_PATH=/tmp/proration-exceljs.cjs \
node --test scripts/test-proration-phase4.browser.mjs
```

可選 `PRORATION_BROWSER_EXECUTABLE` 指定 Chrome 路徑；未設定則使用 Chrome channel。
腳本自己啟動並關閉 localhost server，以隔離瀏覽器測試，不使用個人 browser profile。
CDN 請求攔截為指定同版 ExcelJS 檔案，避免 regression 依賴網路。
下載範本與桌機／手機截圖存在系統暫存目錄 `proration-phase4-browser`，不覆寫既有測試資料。
