# 專案內建資料

## 物價指數備份資料

- 檔案：`material/cpispleym.xls`
- 官方來源：行政院主計總處「各年月為基期之消費者物價總指數－稅務專用」
- 來源頁面：https://www.stat.gov.tw/cp.aspx?n=2665

官方資料更新時，下載最新的 `cpispleym.xls`，直接覆蓋 `material/cpispleym.xls` 即可。程式會沿用相同的 CPI parser，不需修改 JavaScript。

## 新北市新舊地號

- 目錄：`material/land-number/new-taipei/`
- `manifest.json`：資料版本、9 個父資料集、29 行政區檔案與 SHA-256
- `*.csv`：依行政區拆分的 normalized mapping；跨行政區 mapping 同時放入新、舊兩側所屬行政區檔

請使用 `scripts/update_land_numbers.py` 重建，不要手動拼接資料。腳本只有在 9 個官方 ZIP 全部通過驗證後才替換 production bundled data。

## 臺北市新舊地號

- 目錄：`material/land-number/taipei/`
- 來源：臺北市資料大平臺「臺北市各行政區新舊地號對照資料」完整 CSV
- `manifest.json`：官方 dataset/resource、更新日期、原始／normalized 筆數、12 行政區檔案與 SHA-256
- `*.csv`：與新北相同的八欄 normalized schema，按 12 行政區拆分

臺北與新北由同一支 updater 處理，但各自使用 staging directory 原子替換；單一城市失敗不會覆蓋另一城市既有 production data。
