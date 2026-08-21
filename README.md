# Land Tax Tool

土地增值稅試算、謄本整理與公告現值更新工具。正式網站執行時只讀取同站的 `material/` 資料，不依賴 GitHub API 或 GitHub Actions runtime。

## 官方資料自動更新

- CPI 稅務專用物價指數：每月 5 日由 `update-cpi.yml` 檢查；內容有變更才更新 `material/cpispleym.xls` 與 metadata 並 commit。
- 臺北市／新北市公告現值：每年 1 月 15 日由 `update-land-values.yml` 檢查；找到新年度且驗證成功才更新對應 CSV 與 metadata 並 commit。
- 兩個 workflow 都支援 GitHub → Actions → 選擇 workflow → Run workflow 手動執行。

若官方資料尚未發布或來源頁面暫時無法使用，既有 `material/` 檔案不會被刪除或覆蓋。也可以人工下載資料、覆蓋對應檔案後 commit。

## 部署

正式部署使用 Vercel GitHub integration。資料更新 workflow 將變更 commit 到 `main` 後，由 Vercel 自動重新部署。

本 repository 不使用 FTP deployment workflow，也不需要 FTP 帳號或密碼 Secrets。
