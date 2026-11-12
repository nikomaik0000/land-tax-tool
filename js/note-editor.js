const MARKERS = new Set(["bullet", "diamond", "decimal"]);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function normalizeRuns(value) {
  if (!Array.isArray(value)) return null;
  const runs = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.text !== "string") return null;
    const text = item.text.replace(/\r\n?/g, "\n");
    const bold = item.bold === true;
    const previous = runs.at(-1);
    if (previous?.bold === bold) previous.text += text;
    else runs.push({ text, bold });
  }
  return runs.length ? runs : [{ text: "", bold: false }];
}

export function createEmptyNoteDocument() {
  return { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "", bold: false }] }] };
}

export function plainTextToNoteDocument(value = "") {
  return { version: 1, blocks: [{ type: "paragraph", runs: [{ text: String(value).replace(/\r\n?/g, "\n"), bold: false }] }] };
}

export function normalizeNoteDocument(value, fallback = "") {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.blocks)) return plainTextToNoteDocument(fallback);
  const blocks = [];
  for (const block of value.blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) return plainTextToNoteDocument(fallback);
    if (block.type === "paragraph") {
      const runs = normalizeRuns(block.runs);
      if (!runs) return plainTextToNoteDocument(fallback);
      blocks.push({ type: "paragraph", runs });
      continue;
    }
    if (block.type === "list" && MARKERS.has(block.marker) && Array.isArray(block.items)) {
      const items = [];
      for (const item of block.items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return plainTextToNoteDocument(fallback);
        const runs = normalizeRuns(item.runs);
        if (!runs) return plainTextToNoteDocument(fallback);
        items.push({ runs });
      }
      if (items.length) blocks.push({ type: "list", marker: block.marker, items });
      continue;
    }
    return plainTextToNoteDocument(fallback);
  }
  return { version: 1, blocks: blocks.length ? blocks : createEmptyNoteDocument().blocks };
}

function runsText(runs) { return runs.map((run) => run.text).join(""); }

function runsHaveVisibleText(runs) {
  return runsText(runs).replaceAll("\u200b", "").trim().length > 0;
}

export function noteDocumentToPlainText(value) {
  const document = normalizeNoteDocument(value);
  return document.blocks.map((block) => {
    if (block.type === "paragraph") return runsText(block.runs);
    return block.items.map((item, index) => {
      const marker = block.marker === "bullet" ? "•" : block.marker === "diamond" ? "◆" : `${index + 1}.`;
      const text = runsText(item.runs);
      const lines = text.split("\n");
      return [`${marker} ${lines[0] ?? ""}`, ...lines.slice(1)].join("\n");
    }).join("\n");
  }).join("\n");
}

export function noteHasContent(note) {
  const document = normalizeNoteDocument(note?.contentDoc, note?.content);
  return document.blocks.some((block) => block.type === "paragraph"
    ? runsText(block.runs).trim()
    : block.items.some((item) => runsHaveVisibleText(item.runs)));
}

function renderRuns(runs) {
  return runs.map((run) => {
    const text = escapeHtml(run.text).replaceAll("\n", "<br>");
    return run.bold ? `<strong>${text}</strong>` : text;
  }).join("");
}

export function renderNoteDocument(value, fallback = "") {
  const document = normalizeNoteDocument(value, fallback);
  return `<div class="report-rich-content">${document.blocks.map((block) => {
    if (block.type === "paragraph") return `<p>${renderRuns(block.runs)}</p>`;
    const tag = block.marker === "decimal" ? "ol" : "ul";
    const visibleItems = block.items.filter((item) => runsHaveVisibleText(item.runs));
    if (!visibleItems.length) return "";
    return `<${tag} class="report-rich-list report-rich-list-${block.marker}">${visibleItems.map((item) => `<li>${renderRuns(item.runs)}</li>`).join("")}</${tag}>`;
  }).join("")}</div>`;
}

function appendRuns(parent, runs) {
  for (const run of runs) {
    const target = run.bold ? document.createElement("strong") : parent;
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      if (index) target.append(document.createElement("br"));
      if (part) target.append(document.createTextNode(part));
    });
    if (run.bold) parent.append(target);
  }
}

function renderEditorDocument(editor, value, fallback) {
  const normalized = normalizeNoteDocument(value, fallback);
  editor.replaceChildren();
  for (const block of normalized.blocks) {
    if (block.type === "paragraph") {
      const paragraph = document.createElement("p"); appendRuns(paragraph, block.runs); if (!paragraph.hasChildNodes()) paragraph.append(document.createElement("br")); editor.append(paragraph); continue;
    }
    const list = document.createElement(block.marker === "decimal" ? "ol" : "ul"); list.dataset.marker = block.marker;
    for (const item of block.items) { const li = document.createElement("li"); appendRuns(li, item.runs); if (!li.hasChildNodes()) li.append(document.createElement("br")); list.append(li); }
    editor.append(list);
  }
}

function inlineRuns(root) {
  const runs = [];
  const push = (text, bold) => {
    if (!text) return;
    const previous = runs.at(-1);
    if (previous?.bold === bold) previous.text += text;
    else runs.push({ text, bold });
  };
  const visit = (node, bold = false) => {
    if (node.nodeType === Node.TEXT_NODE) { push((node.nodeValue ?? "").replaceAll("\u200b", ""), bold); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "BR") { push("\n", bold); return; }
    const nextBold = bold || node.tagName === "STRONG" || node.tagName === "B";
    for (const child of node.childNodes) visit(child, nextBold);
  };
  for (const child of root.childNodes) visit(child);
  return runs.length ? runs : [{ text: "", bold: false }];
}

export function editorElementToNoteDocument(editor) {
  const blocks = [];
  for (const child of editor.children) {
    if (child.matches("ul, ol")) {
      const marker = child.tagName === "OL" ? "decimal" : MARKERS.has(child.dataset.marker) ? child.dataset.marker : "bullet";
      const items = [...child.children].filter((item) => item.tagName === "LI").map((item) => ({ runs: inlineRuns(item) }));
      if (items.length) blocks.push({ type: "list", marker, items });
    } else {
      blocks.push({ type: "paragraph", runs: inlineRuns(child) });
    }
  }
  if (!blocks.length) blocks.push(createEmptyNoteDocument().blocks[0]);
  return normalizeNoteDocument({ version: 1, blocks });
}

function closestEditableBlock(node, editor, offset = 0) {
  if (node === editor || (node?.nodeType === Node.ELEMENT_NODE && node.matches?.("ul, ol"))) {
    const children = node.childNodes; const index = Math.max(0, Math.min(offset >= children.length ? children.length - 1 : offset, children.length - 1));
    node = children[index] ?? node.lastChild;
    if (node?.nodeType === Node.ELEMENT_NODE && node.matches("ul, ol")) node = node.querySelector("li:last-child");
  }
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const block = element?.closest("li, p");
  return block && editor.contains(block) ? block : null;
}

function placeCaretStart(node) {
  const range = document.createRange(); const selection = getSelection();
  range.selectNodeContents(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
}

function placeCaretEnd(node) {
  const range = document.createRange(); const selection = getSelection();
  range.selectNodeContents(node); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
}

function insertPlainText(text) {
  const selection = getSelection(); if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0); range.deleteContents();
  const fragment = document.createDocumentFragment(); const parts = text.replace(/\r\n?/g, "\n").split("\n");
  let last = null;
  parts.forEach((part, index) => { if (index) { last = document.createElement("br"); fragment.append(last); } if (part) { last = document.createTextNode(part); fragment.append(last); } });
  range.insertNode(fragment); if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
}

function insertSoftBreak() {
  const selection = getSelection(); if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0); range.deleteContents();
  const br = document.createElement("br"); const placeholder = document.createTextNode("\u200b");
  const fragment = document.createDocumentFragment(); fragment.append(br, placeholder); range.insertNode(fragment);
  range.setStart(placeholder, 0); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
}

function applyBold(editor) {
  const selection = getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0); if (!editor.contains(range.commonAncestorContainer)) return false;
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer : walker.nextNode();
  while (node) { if (range.intersectsNode(node) && !node.parentElement?.closest("strong")) nodes.push(node); node = walker.nextNode(); }
  const specs = nodes.map((textNode) => ({
    node: textNode,
    start: textNode === range.startContainer ? range.startOffset : 0,
    end: textNode === range.endContainer ? range.endOffset : textNode.nodeValue.length
  })).filter(({ start, end }) => end > start);
  for (const spec of specs.reverse()) {
    const after = spec.node.splitText(spec.end); const selected = spec.node.splitText(spec.start); const strong = document.createElement("strong");
    selected.replaceWith(strong); strong.append(selected); void after;
  }
  selection.removeAllRanges();
  return specs.length > 0;
}

function applyMarker(editor, marker) {
  const selection = getSelection(); if (!selection?.rangeCount) return false;
  const block = closestEditableBlock(selection.anchorNode, editor, selection.anchorOffset) ?? editor.querySelector("li, p"); if (!block) return false;
  const list = block.closest("ul, ol");
  if (marker === "none") {
    if (!list) return false;
    const fragment = document.createDocumentFragment();
    for (const item of [...list.children]) { const paragraph = document.createElement("p"); while (item.firstChild) paragraph.append(item.firstChild); fragment.append(paragraph); }
    const first = fragment.firstChild; list.replaceWith(fragment); editor.__noteCaretTarget = first; return true;
  }
  if (!MARKERS.has(marker)) return false;
  if (list) {
    const replacement = document.createElement(marker === "decimal" ? "ol" : "ul"); replacement.dataset.marker = marker;
    while (list.firstChild) replacement.append(list.firstChild); list.replaceWith(replacement); editor.__noteCaretTarget = replacement.querySelector("li"); return true;
  }
  const replacement = document.createElement(marker === "decimal" ? "ol" : "ul"); replacement.dataset.marker = marker;
  const item = document.createElement("li"); while (block.firstChild) item.append(block.firstChild); replacement.append(item); block.replaceWith(replacement); editor.__noteCaretTarget = item; return true;
}

function handleEnter(editor, event) {
  const selection = getSelection(); if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0); const block = closestEditableBlock(range.startContainer, editor, range.startOffset); if (!block) return false;
  event.preventDefault();
  if (event.shiftKey) { insertSoftBreak(); return true; }
  if (!range.collapsed) range.deleteContents();
  if (block.tagName === "LI" && !block.textContent.replaceAll("\u200b", "").trim()) {
    const list = block.parentElement; const paragraph = document.createElement("p"); paragraph.append(document.createElement("br"));
    block.remove(); list.after(paragraph); if (!list.children.length) list.remove(); placeCaretStart(paragraph); return true;
  }
  const next = document.createElement(block.tagName === "LI" ? "li" : "p");
  const tail = document.createRange(); tail.selectNodeContents(block);
  if (range.startContainer === block || block.contains(range.startContainer)) tail.setStart(range.startContainer, range.startOffset);
  else tail.collapse(false);
  next.append(tail.extractContents());
  if (!next.hasChildNodes()) next.append(document.createElement("br")); block.after(next); placeCaretStart(next); return true;
}

export function mountNoteEditor({ host, note, onChange = () => {} }) {
  const toolbar = document.createElement("div"); toolbar.className = "note-editor-toolbar"; toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "備註格式");
  const options = [["none", "無"], ["bullet", "•"], ["diamond", "◆"], ["decimal", "1. 2. 3."]];
  for (const [value, label] of options) { const button = document.createElement("button"); button.type = "button"; button.dataset.noteMarker = value; button.textContent = label; button.setAttribute("aria-label", `項目符號：${label}`); toolbar.append(button); }
  const bold = document.createElement("button"); bold.type = "button"; bold.dataset.noteBold = ""; bold.innerHTML = "<strong>B</strong>"; bold.setAttribute("aria-label", "將選取文字設為粗體"); toolbar.append(bold);
  const editor = document.createElement("div"); editor.className = "note-rich-editor"; editor.contentEditable = "true"; editor.setAttribute("role", "textbox"); editor.setAttribute("aria-multiline", "true"); editor.dataset.placeholder = "輸入內容";
  renderEditorDocument(editor, note.contentDoc, note.content);
  host.replaceChildren(toolbar, editor);
  let composing = false;
  const sync = () => { note.contentDoc = editorElementToNoteDocument(editor); note.content = noteDocumentToPlainText(note.contentDoc); onChange(); };
  toolbar.addEventListener("mousedown", (event) => event.preventDefault());
  toolbar.addEventListener("click", (event) => {
    const marker = event.target.closest("[data-note-marker]")?.dataset.noteMarker;
    const changed = marker ? applyMarker(editor, marker) : event.target.closest("[data-note-bold]") ? applyBold(editor) : false;
    if (changed) {
      sync();
      if (marker) queueMicrotask(() => { const target = editor.__noteCaretTarget; editor.focus({ preventScroll: true }); if (target?.isConnected) placeCaretEnd(target); });
    }
  });
  editor.addEventListener("compositionstart", () => { composing = true; });
  editor.addEventListener("compositionend", () => { composing = false; sync(); });
  editor.addEventListener("input", () => { if (!composing) sync(); });
  editor.addEventListener("keydown", (event) => { if (event.key === "Enter" && handleEnter(editor, event)) queueMicrotask(sync); });
  editor.addEventListener("paste", (event) => { event.preventDefault(); insertPlainText(event.clipboardData?.getData("text/plain") ?? ""); sync(); });
  return { editor, sync };
}
