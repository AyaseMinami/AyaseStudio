// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { isTextareaVisualBoundary } from "./textareaVisualLine";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

function textarea(value: string, offset: number) {
  const input = document.createElement("textarea");
  input.value = value;
  input.style.cssText = "padding: 8px 12px; font-size: 15px; line-height: 24px; white-space: pre-wrap; overflow-wrap: break-word;";
  Object.defineProperty(input, "clientWidth", { value: 180 });
  input.setSelectionRange(offset, offset);
  document.body.append(input);
  return input;
}

function geometry(tops: Record<number, number[]>) {
  let offset = 0;
  const range = document.createRange();
  vi.spyOn(range, "setStart").mockImplementation((_node, value) => { offset = value; });
  vi.spyOn(range, "collapse").mockImplementation(() => {});
  vi.spyOn(range, "getClientRects").mockImplementation(() => (tops[offset] ?? []).map((top) => ({
    top, height: 18,
  })) as unknown as DOMRectList);
  vi.spyOn(document, "createRange").mockReturnValue(range);
}

it("uses measured visual rows for wrapped text and ignores textarea scrolling", () => {
  const input = textarea("abcdefghij", 2);
  input.scrollTop = 48;
  input.scrollLeft = 20;
  geometry({ 0: [8], 2: [8], 5: [8, 32], 8: [32], 10: [56] });
  expect(isTextareaVisualBoundary(input, -1)).toBe(true);
  expect(isTextareaVisualBoundary(input, 1)).toBe(false);
  input.setSelectionRange(5, 5);
  expect(isTextareaVisualBoundary(input, -1)).toBe(false);
  expect(isTextareaVisualBoundary(input, -1, "upstream")).toBe(true);
  expect(isTextareaVisualBoundary(input, -1, "downstream")).toBe(false);
  input.setSelectionRange(8, 8);
  expect(isTextareaVisualBoundary(input, -1)).toBe(false);
  expect(isTextareaVisualBoundary(input, 1)).toBe(false);
  input.setSelectionRange(10, 10);
  expect(isTextareaVisualBoundary(input, 1)).toBe(true);
  expect(document.body.children).toHaveLength(1);
});

it("keeps an ambiguous penultimate line end out of Down history without downstream evidence", () => {
  const input = textarea("abcdefghij", 5);
  geometry({ 0: [0], 5: [24, 48], 10: [48] });
  expect(isTextareaVisualBoundary(input, 1)).toBe(false);
  expect(isTextareaVisualBoundary(input, 1, "upstream")).toBe(false);
  expect(isTextareaVisualBoundary(input, 1, "downstream")).toBe(true);
});

it("matches content width and typography and retains the empty trailing line", () => {
  const input = textarea("first\n", 6);
  geometry({ 0: [0], 6: [24] });
  const append = vi.spyOn(document.body, "append");
  expect(isTextareaVisualBoundary(input, 1)).toBe(true);
  expect(isTextareaVisualBoundary(input, -1)).toBe(false);
  const mirror = append.mock.calls[0][0] as HTMLDivElement;
  expect(mirror.style.width).toBe("156px");
  expect(mirror.style.fontSize).toBe("15px");
  expect(mirror.style.lineHeight).toBe("24px");
  expect(mirror.style.whiteSpace).toBe("pre-wrap");
  expect(mirror.textContent).toBe("first\n\u200b");
  expect(mirror.isConnected).toBe(false);
});

it("allows an empty draft but declines selections or missing layout evidence", () => {
  const input = textarea("", 0);
  expect(isTextareaVisualBoundary(input, -1)).toBe(true);
  expect(isTextareaVisualBoundary(input, 1)).toBe(true);
  input.value = "text";
  input.setSelectionRange(0, 2);
  expect(isTextareaVisualBoundary(input, -1)).toBe(false);
  input.setSelectionRange(2, 2);
  geometry({});
  expect(isTextareaVisualBoundary(input, -1)).toBe(false);
  expect(isTextareaVisualBoundary(input, 1)).toBe(false);
});
