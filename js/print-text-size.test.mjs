import assert from "node:assert/strict";
import test from "node:test";
import { applyPrintTextSizeClass, loadPrintTextSize, normalizePrintTextSize, savePrintTextSize } from "./print-text-size.js";

test("print text size defaults to medium and accepts only known values", () => {
  assert.equal(normalizePrintTextSize(), "medium");
  assert.equal(normalizePrintTextSize("large"), "large");
  assert.equal(normalizePrintTextSize("oversized"), "medium");
});

test("print text size uses an isolated storage key", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(loadPrintTextSize("report-a", "small", storage), "small");
  assert.equal(savePrintTextSize("report-a", "large", storage), "large");
  assert.equal(loadPrintTextSize("report-a", "medium", storage), "large");
  assert.equal(loadPrintTextSize("report-b", "medium", storage), "medium");
});

test("print text size class replacement never touches unrelated classes", () => {
  const classes = new Set(["a4-sheet", "report-font-small"]);
  const element = { classList: { remove: (...items) => items.forEach((item) => classes.delete(item)), add: (item) => classes.add(item) } };
  assert.equal(applyPrintTextSizeClass(element, "large"), "large");
  assert.deepEqual([...classes].sort(), ["a4-sheet", "report-font-large"]);
});
