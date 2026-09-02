# Land Tax Tool

土地增值稅試算、謄本整理、公告現值更新、新舊地號與土地使用分區批次查詢工具。正式網站執行時只讀取同站的 `material/` 資料，不依賴 GitHub API 或 GitHub Actions runtime。

## 官方資料自動更新

- CPI 稅務專用物價指數：每月 5 日由 `update-cpi.yml` 檢查；內容有變更才更新 `material/cpispleym.xls` 與 metadata 並 commit。
- 臺北市／新北市公告現值：每年 1 月 15 日由 `update-land-values.yml` 檢查；找到新年度且驗證成功才更新對應 CSV 與 metadata 並 commit。
- 新北市／臺北市新舊地號：每年 2 月 15 日由 `update-land-number-data.yml` 檢查；新北驗證 9 個地政事務所完整 ZIP，臺北驗證完整 12 區 CSV，兩市各自原子更新且內容有變化才 commit。
- 臺北市土地使用分區：每年 1、7 月 15 日由 `update-zoning.yml` 檢查完整 CSV，驗證後按 12 行政區原子更新。新北市在取得可靠、可批次使用的地籍 geometry 前不建立推測 lookup。
- 所有資料 workflow 都支援 GitHub → Actions → 選擇 workflow → Run workflow 手動執行。

若官方資料尚未發布或來源頁面暫時無法使用，既有 `material/` 檔案不會被刪除或覆蓋。也可以人工下載資料、覆蓋對應檔案後 commit。

## 部署

正式部署使用 Vercel GitHub integration。資料更新 workflow 將變更 commit 到 `main` 後，由 Vercel 自動重新部署。

本 repository 不使用 FTP deployment workflow，也不需要 FTP 帳號或密碼 Secrets。
