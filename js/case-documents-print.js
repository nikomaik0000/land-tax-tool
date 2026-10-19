export function preparePrintableCaseCard(root, cardHtml) {
  root.innerHTML = `<article class="case-card-sheet case-card-print-sheet" aria-label="案件資料卡列印版">${cardHtml}</article>`;
  expandPrintRowspans(root);
  return root.firstElementChild;
}

export function expandPrintRowspans(root) {
  root.querySelectorAll(".case-card-table tbody").forEach((body) => {
    if (body.closest(".common-card-table")) return;
    const carries = [];
    const headerRow = body.closest("table")?.tHead?.rows[body.closest("table").tHead.rows.length - 1];
    const columnCount = headerRow ? [...headerRow.cells].reduce((sum, cell) => sum + (cell.colSpan || 1), 0) : 0;
    [...body.rows].forEach((row) => {
      const originals = [...row.cells];
      const rebuilt = [];
      let sourceIndex = 0;
      let column = 0;
      while (column < columnCount) {
        const carry = carries[column];
        if (carry) {
          const clone = carry.cell.cloneNode(true);
          clone.rowSpan = 1;
          rebuilt.push(clone);
          carry.remaining -= 1;
          if (carry.remaining === 0) carries[column] = null;
          column += clone.colSpan || 1;
          continue;
        }
        const cell = originals[sourceIndex++];
        if (!cell) break;
        const span = cell.rowSpan || 1;
        if (span > 1) carries[column] = { cell: cell.cloneNode(true), remaining: span - 1 };
        cell.rowSpan = 1;
        rebuilt.push(cell);
        column += cell.colSpan || 1;
      }
      row.replaceChildren(...rebuilt);
    });
  });
}

