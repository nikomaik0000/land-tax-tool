# UI Style Guide

本文件定義「土地／房屋稅費試算表產生器」網站操作介面的視覺規範。

此規範只負責：

* 網站操作介面
* 表單
* PDF 上傳區
* 土地資料確認表
* 按鈕
* Checkbox
* A4 預覽區外框

真正列印給客戶的 A4 報表請遵守：

`design/PRINT_STYLE_GUIDE.md`

如果兩份規範衝突：

* 網站 UI → 以 `UI_STYLE_GUIDE.md` 為準
* A4 列印報表 → 以 `PRINT_STYLE_GUIDE.md` 為準

---

# 1. Overall Direction

整體設計希望延續現有網站的設計語言：

* Minimal
* Clean
* Editorial
* Japanese-inspired
* Professional
* Monochrome
* Large spacing
* Fine borders
* Calm
* Designer-made work tool

希望看起來像：

「設計師製作的精緻工作工具」

而不是：

* 工程師預設頁面
* Bootstrap 後台
* 政府機關網站
* 傳統 ERP
* 傳統 Excel 系統
* SaaS dashboard

不要過度裝飾。

---

# 2. Color Palette

網站 UI 採黑白灰。

```css
:root {
  --ui-bg: #ffffff;

  --ui-text: #222222;
  --ui-text-secondary: #777777;

  --ui-border: #e8e8e8;
  --ui-border-strong: #cccccc;

  --ui-surface: #fafafa;
  --ui-surface-hover: #f5f5f5;

  --ui-primary: #222222;
  --ui-primary-hover: #000000;
}
```

網站 UI 可以使用較柔和的灰階。

但不要使用：

* 藍色
* 綠色
* 紅色
* 黃色
* 米色
* 彩色漸層
* 彩色 icon

成功、錯誤等狀態也盡量透過：

* 文字
* 符號
* 框線
* 粗細

表達。

例如：

`✓ 已成功讀取`

不用綠色。

---

# 3. Typography

中文字體優先：

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "PingFang TC",
  "Noto Sans TC",
  "Microsoft JhengHei",
  sans-serif;
```

整體不要使用過粗字重。

建議：

```css
font-weight: 400;
```

欄位名稱：

```css
font-weight: 500;
```

主標題：

```css
font-weight: 600;
```

不要大量使用：

```css
font-weight: 700;
font-weight: 800;
font-weight: 900;
```

---

# 4. Letter Spacing

網站維持偏寬鬆、精緻的字距。

一般文字：

```css
letter-spacing: 0.04em;
```

主標題：

```css
letter-spacing: 0.08em;
```

英文小標可以稍微更開。

---

# 5. Page Layout

桌機版內容不要撐滿整個螢幕。

建議：

```css
.app-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 48px 32px 80px;
}
```

頁面要有大量留白。

區塊之間建議：

```css
margin-top: 48px;
```

不要把所有功能塞得很緊。

---

# 6. Header

Header 保持非常簡單。

建議：

```text
LAND TAX TOOL
土地及房屋稅費試算
```

英文主標可以字距較寬。

中文副標使用較小字級與灰字。

Header 不要有：

* 大 Logo
* 漸層
* 彩色 icon
* 大 Hero Banner
* 複雜 navigation
* sidebar

Header 下方可使用：

```css
border-bottom: 1px solid var(--ui-border);
```

---

# 7. Section Style

不要每個區塊都包成一張厚重卡片。

優先使用：

```text
案件資料
────────────────

內容
```

區塊標題建議：

```css
.section-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
```

區塊之間用留白與細線區隔。

---

# 8. Cards

如果必要才使用容器。

容器規格：

```css
border: 1px solid #ececec;
border-radius: 8px;
background: #ffffff;
```

不要使用明顯陰影。

避免：

```css
box-shadow:
```

如真的需要，只允許非常淡、幾乎不可察覺的陰影。

---

# 9. Input Fields

Input 要乾淨、平整。

建議：

```css
input,
select,
textarea {
  height: 46px;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  background: #ffffff;
  color: #222222;
  padding: 0 14px;
}
```

Textarea 高度依內容需要調整。

Focus：

```css
input:focus,
select:focus,
textarea:focus {
  border-color: #555555;
  outline: none;
}
```

不要使用瀏覽器預設亮藍色 focus。

---

# 10. Form Labels

Label：

```css
font-size: 13px;
font-weight: 500;
color: #333333;
margin-bottom: 8px;
```

Placeholder：

```css
color: #aaaaaa;
```

---

# 11. Buttons

主要按鈕：

黑底白字。

```css
.btn-primary {
  background: #222222;
  color: #ffffff;
  border: 1px solid #222222;
  border-radius: 6px;
}
```

Hover：

```css
background: #000000;
```

次要按鈕：

```css
.btn-secondary {
  background: #ffffff;
  color: #222222;
  border: 1px solid #cccccc;
}
```

不要使用：

* 藍色按鈕
* 紅色刪除按鈕
* 綠色成功按鈕

刪除可以使用：

`刪除`

或：

`×`

搭配黑灰色即可。

---

# 12. Upload Area

PDF 上傳區要有設計感，但保持克制。

建議：

```css
.upload-zone {
  border: 1px dashed #bdbdbd;
  border-radius: 8px;
  background: #ffffff;
  padding: 40px 24px;
  text-align: center;
}
```

內容：

```text
選擇土地增值稅 PDF

可一次上傳多份檔案

[ 選擇檔案 ]
```

拖曳 Hover：

```css
background: #f8f8f8;
```

不要使用彩色背景。

---

# 13. Uploaded Files

已上傳檔案不要做彩色 tag。

使用簡潔列：

```text
土地增值稅試算_981.pdf        已讀取        ×
土地增值稅試算_982.pdf        已讀取        ×
```

建議：

```css
.file-row {
  border-bottom: 1px solid #eeeeee;
  padding: 12px 0;
}
```

---

# 14. Editable Land Table

PDF 解析後的確認表，要比傳統 Excel 清爽。

建議：

```css
.land-table {
  width: 100%;
  border-collapse: collapse;
}
```

表頭：

```css
.land-table th {
  background: #fafafa;
  font-weight: 500;
  color: #333333;
}
```

儲存格：

```css
.land-table td,
.land-table th {
  border-bottom: 1px solid #ededed;
  padding: 12px 10px;
}
```

不要讓每格都有粗框。

數字：

```css
text-align: right;
```

文字：

```css
text-align: left;
```

Hover：

```css
tbody tr:hover {
  background: #fafafa;
}
```

---

# 15. Table Editing

土地資料允許直接編輯。

編輯欄位不要跳 popup。

如果 input 放在 table 裡：

* 無背景
* 無明顯框線
* focus 才出現深灰底線或細框

保持像資料表，而不是滿桌 input。

---

# 16. Checkbox

Checkbox 必須是黑白風格。

選中：

黑底白勾。

不要顯示藍色。

文字範例：

```text
☑ 顯示贈與稅試算
☑ 增值稅自用條件
```

---

# 17. Money / Important Values

重要金額不要使用顏色強調。

使用：

* 字級
* 粗體
* 留白

例如：

```text
土地總現值
4,837,866 元
```

數字可：

```css
font-size: 20px;
font-weight: 600;
```

---

# 18. A4 Preview Area

網站中的 A4 預覽區：

* 灰白網站背景
* 中央一張白色 A4
* 非常淡的外框或 shadow

這個 shadow 只存在網站預覽。

例如：

```css
.report-preview {
  background: #f5f5f5;
  padding: 32px;
}

.a4-preview {
  background: #ffffff;
  margin: 0 auto;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}
```

真正列印時絕對不能有 shadow。

---

# 19. Responsive Design

手機版：

* 表單單欄
* input 全寬
* 主要按鈕可以全寬
* 土地資料表允許水平滑動
* A4 預覽縮放，不改變 A4 真實比例

例如：

```css
.table-scroll {
  overflow-x: auto;
}
```

不要為了手機硬把 15 個土地欄位壓成窄欄。

---

# 20. Animation

不要有誇張動畫。

允許：

```css
transition: 0.15s ease;
```

用於：

* hover
* focus
* button

禁止：

* bounce
* scale 大幅放大
* loading 彩色動畫
* 漂浮元素

---

# 21. Icons

能不用 icon 就不要用。

優先文字。

必要的符號：

* ✓
* ×
* ＋
* −

即可。

不要引入整套大型 icon library，除非真的需要。

---

# 22. Visual Priority

設計精緻感主要來自：

1. 留白
2. 字距
3. 文字粗細
4. 細線
5. 對齊
6. 一致的 spacing
7. 克制的圓角

不是來自：

* 顏色
* 陰影
* icon
* 動畫
* 卡片數量

---

# 23. Final Design Rule

如果不知道怎麼設計某個元件：

優先選擇：

「更簡單、更乾淨、更少裝飾」

而不是新增視覺效果。

整站請維持一致：

* 白底
* 黑灰字
* 淺灰細線
* 中等圓角
* 無明顯陰影
* 大量留白
* 精緻字距
