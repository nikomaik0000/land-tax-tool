# Print Style Guide

本文件定義「土地／房屋稅費試算表產生器」客戶版 A4 報表的列印視覺規範。

這份報表會實際使用黑白印表機列印。

因此：

「列印清楚」優先於螢幕上的柔和感。

請不要使用太淺的灰色。

---

# 1. Print Colors

A4 報表主要只允許以下四個顏色：

```css
:root {
  --print-black: #000000;
  --print-dark: #333333;
  --print-line: #999999;
  --print-white: #ffffff;
}
```

主要色：

```text
#000000
```

次要文字：

```text
#333333
```

細線：

```text
#999999
```

背景：

```text
#FFFFFF
```

---

# 2. Important Rule

不要使用太淡的灰。

禁止使用：

```text
#DDDDDD
#E5E5E5
#EEEEEE
#F0F0F0
```

作為重要：

* 表格框線
* 分隔線
* 文字

原因：

部分黑白印表機可能無法清楚印出。

---

# 3. Background

整張 A4：

```css
background: #ffffff;
```

不要使用：

* 大面積灰底
* 漸層
* 圖案
* 浮水印
* 彩色元素

---

# 4. Main Text

以下全部使用：

```css
color: #000000;
```

包括：

* 報表標題
* 區塊標題
* 表頭
* 合計
* 重要數字
* 自用增值稅合計
* 一般增值稅合計
* 契稅
* 總現值
* 贈與稅結果

---

# 5. Secondary Text

一般內容、說明、地址、條款可使用：

```css
color: #333333;
```

不要使用比 `#333333` 更淺的文字。

---

# 6. Borders

一般表格細線：

```css
border: 1px solid #999999;
```

主要框線：

```css
border: 1.5px solid #000000;
```

重要合計線：

```css
border-top: 2px solid #000000;
```

---

# 7. A4 Size

使用：

```css
@page {
  size: A4 portrait;
  margin: 8mm;
}
```

報表：

```css
.a4-sheet {
  width: 210mm;
  min-height: 297mm;
  background: #ffffff;
}
```

實際內容需考慮列印 margin。

---

# 8. Print Font

使用：

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "PingFang TC",
  "Noto Sans TC",
  "Microsoft JhengHei",
  sans-serif;
```

不要使用太細的字重。

正文至少：

```css
font-weight: 400;
```

重要資訊：

```css
font-weight: 600;
```

避免 `font-weight: 300`。

因為黑白列印可能太細。

---

# 9. Report Title

A4 最上方中央：

```text
土地及房屋稅費試算表
```

建議：

```css
font-size: 21px;
font-weight: 600;
letter-spacing: 0.08em;
color: #000000;
```

不要過大。

---

# 10. Case Information

標題下方可顯示：

* 案件名稱
* 製表日期

例如：

```text
案件：王○○－延平北路
製表日期：2026/08/17
```

使用：

```css
font-size: 9px;
color: #333333;
```

保持簡單。

---

# 11. Main Land Table

土地主表是整張報表最重要的區域。

必須保留：

1. 區
2. 段
3. 小段
4. 地號
5. 面積
6. 所有權人
7. 公告現值
8. 持分
9. 總現值
10. 前次移轉日期
11. 前次移轉現值
12. 物價指數
13. 自用增值稅
14. 一般增值稅
15. 契稅

表格：

```css
.report-table {
  width: 100%;
  border-collapse: collapse;
  border: 1.5px solid #000000;
}
```

---

# 12. Table Header

表頭優先使用：

白底＋黑字。

```css
.report-table th {
  background: #ffffff;
  color: #000000;
  font-weight: 600;
  border: 1px solid #999999;
}
```

不要依賴淺灰背景區分表頭。

用：

* 粗體
* 黑線
* 對齊

即可。

---

# 13. Table Cells

```css
.report-table td {
  background: #ffffff;
  color: #333333;
  border: 1px solid #999999;
}
```

建議 padding：

```css
padding: 4px 5px;
```

A4 空間有限，不要 padding 太大。

---

# 14. Table Alignment

文字：

靠左或置中。

數字：

靠右。

例如：

* 面積 → 右
* 公告現值 → 右
* 總現值 → 右
* 稅額 → 右
* 地址 → 左

表頭可以置中。

---

# 15. Table Header Wrapping

欄位很多時允許表頭換行。

例如：

```text
前次
移轉日期
```

```text
前次
移轉現值
```

```text
自用
增值稅
```

```text
一般
增值稅
```

不要因為欄位多而刪除必要資訊。

---

# 16. Multiple Previous Transfers

如果同一土地有多筆前次移轉：

第一列顯示主要土地資料。

第二筆之後可以使用次列。

次列仍然：

```css
color: #333333;
border-color: #999999;
```

不要用很淺的線。

---

# 17. Total Row

總計列：

```css
.total-row td {
  color: #000000;
  font-weight: 600;
  border-top: 2px solid #000000;
}
```

合計必須明顯。

---

# 18. House Information Section

土地主表下面放：

```text
房屋資料
```

使用黑色區塊標題。

例如：

```css
.report-section-title {
  color: #000000;
  font-weight: 600;
  border-bottom: 1.5px solid #000000;
}
```

內容：

```text
房屋座落
房屋總價
房屋評定現值
土地總現值
總現值
契稅
```

不要放成一堆卡片。

使用簡潔左右排列。

---

# 19. House Address

地址可能很長。

地址應該有足夠寬度，必要時換行。

不要硬壓縮字體。

例如：

```text
房屋座落｜台北市大同區延平北路二段144巷12號七樓
```

---

# 20. Important Amounts

以下資料需要視覺上稍微突出：

* 土地總現值
* 總現值
* 自用增值稅合計
* 一般增值稅合計
* 契稅
* 贈與稅

使用：

```css
color: #000000;
font-weight: 600;
```

不要使用：

* 彩色
* 灰底 highlight
* 大框框

---

# 21. Tax Summary

可以設計成一列：

```text
自用增值稅        一般增值稅        契稅
162,279           324,557           32,170
```

使用黑色文字。

重要數字：

```css
font-weight: 600;
```

上方可以使用：

```css
border-top: 1.5px solid #000000;
```

---

# 22. Gift Tax Section

只有勾選「顯示贈與稅試算」時出現。

標題：

```text
贈與稅試算
```

使用：

```css
color: #000000;
font-weight: 600;
border-bottom: 1.5px solid #000000;
```

---

# 23. Gift Tax Calculation

贈與稅一定要完整列出計算過程。

例如：

```text
土地總現值                    4,301,700
房屋評定現值                    536,166
                              ─────────
贈與總額                      4,837,866

減：免稅額                      XXX,XXX
                              ─────────
課稅贈與淨額                  X,XXX,XXX

計算：
X,XXX,XXX × XX% = XXX,XXX

預估贈與稅                      XXX,XXX 元
```

線條使用：

```css
border-color: #999999;
```

最後結果：

```css
color: #000000;
font-weight: 600;
```

---

# 24. Multiple Tax Brackets

如果贈與稅有多級：

必須列出每一級。

例如：

```text
第一級
2,500,000 × 10% = 250,000

第二級
1,500,000 × 15% = 225,000

應納贈與稅 = 475,000 元
```

不要只顯示最後答案。

---

# 25. Notes / Clauses

條款放在 A4 最下方。

顯示勾選的條款。

建議：

```css
font-size: 9px;
line-height: 1.5;
color: #333333;
```

條款標題：

```css
font-weight: 600;
color: #000000;
```

不要使用小於 8.5px 的中文字。

---

# 26. Clause Dividers

條款之間如果需要分隔：

```css
border-top: 1px solid #999999;
```

不要使用太淺的線。

---

# 27. No Shadows

A4 列印版禁止：

```css
box-shadow
```

預覽畫面可以有 shadow。

列印時必須移除。

---

# 28. No Rounded Cards

A4 報表盡量不要使用網頁卡片感。

避免：

* 大圓角
* 卡片
* pill
* tag
* 彩色 icon

如果真的需要框：

使用直角或極小圓角。

正式報表以線條與排版為主。

---

# 29. Print Color Adjustment

請加入：

```css
@media print {
  * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

---

# 30. Print Only the Report

列印時：

只能顯示 A4 報表。

隱藏：

* Header
* PDF 上傳區
* Form
* Button
* 資料編輯區
* 網站背景
* A4 預覽 shadow

例如：

```css
@media print {
  .no-print {
    display: none !important;
  }

  .report-preview {
    padding: 0;
    background: #ffffff;
  }

  .a4-sheet {
    box-shadow: none;
  }
}
```

---

# 31. Density Modes

內容需要盡量維持一張 A4。

建立：

```text
density-normal
density-compact
density-dense
```

---

# 32. Normal Mode

1～2 筆土地時：

字體正常。

表格字體建議：

```css
font-size: 9.5px;
```

條款：

```css
font-size: 9px;
```

---

# 33. Compact Mode

3～4 筆土地時：

略微縮小：

```css
font-size: 9px;
```

減少：

* table padding
* section spacing
* line-height

但是必須保持清楚。

---

# 34. Dense Mode

5 筆以上：

可以：

* 表格縮至 8.5～9px
* padding 再縮小
* 區塊間距縮小

但是不要：

* 小於合理可閱讀尺寸
* 裁切資料
* 隱藏欄位

如果真的放不下，提示使用者。

---

# 35. Single A4 Priority

優先：

「一張 A4 完成」

但以下優先級更高：

1. 資料不能消失
2. 數字不能被裁切
3. 字不能小到難閱讀
4. 計算過程不能省略

如果資料量真的過多：

顯示：

```text
目前資料量較多，可能無法完整容納於單張 A4。
```

不要默默裁掉內容。

---

# 36. Print Test Rule

設計報表時不要只看 Chrome 畫面。

請特別確認：

* 黑白預覽
* 邊框是否清楚
* #999999 是否能辨識
* 小字是否可閱讀
* 所有金額是否完整
* 表格是否超出 A4
* 條款是否被切掉

---

# 37. Final Visual Rule

A4 報表應該呈現：

「正式、乾淨、黑白、清楚、有設計感的稅務試算報表」

不要呈現：

* 網頁截圖
* SaaS dashboard
* 傳統醜 Excel
* 政府網站
* 過度花俏報告

主要靠：

* #000000
* #333333
* #999999
* #FFFFFF
* 線條粗細
* 字重
* 排版
* 對齊
* 留白

產生視覺層級。
