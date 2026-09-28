const typographyProperties = [
  "font-family", "font-size", "font-style", "font-weight", "font-stretch",
  "font-variant", "font-feature-settings", "font-kerning", "font-optical-sizing",
  "font-variation-settings", "line-height", "letter-spacing", "word-spacing",
  "text-transform", "text-indent", "text-align", "direction", "tab-size",
  "word-break", "overflow-wrap", "white-space",
] as const;

export type TextareaCaretAffinity = "upstream" | "downstream";

/** Measure the full text, independently of the textarea's current scroll position. */
export function isTextareaVisualBoundary(
  textarea: HTMLTextAreaElement, direction: -1 | 1, affinity?: TextareaCaretAffinity,
): boolean {
  if (textarea.selectionStart !== textarea.selectionEnd) return false;
  if (!textarea.value) return true;
  const document = textarea.ownerDocument;
  const view = document.defaultView;
  if (!view) return false;
  const computed = view.getComputedStyle(textarea);
  const contentWidth = textarea.clientWidth - (parseFloat(computed.paddingLeft) || 0) -
    (parseFloat(computed.paddingRight) || 0);
  if (contentWidth <= 0) return false;

  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  Object.assign(mirror.style, {
    position: "fixed", left: "-100000px", top: "0", visibility: "hidden",
    pointerEvents: "none", boxSizing: "content-box", width: `${contentWidth}px`,
    padding: "0", border: "0", margin: "0", height: "auto",
  });
  for (const property of typographyProperties) mirror.style.setProperty(property, computed.getPropertyValue(property));
  // Keep an actual final line box for empty last lines (including a trailing newline).
  const text = document.createTextNode(textarea.value + "\u200b");
  mirror.append(text);
  document.body.append(mirror);
  try {
    const range = document.createRange();
    const caretTops = (offset: number): number[] => {
      range.setStart(text, offset);
      range.collapse(true);
      const rects = range.getClientRects();
      return Array.from(rects).filter((rect) => rect.height > 0).map((rect) => rect.top);
    };
    const candidates = caretTops(textarea.selectionStart);
    const boundaries = caretTops(direction === -1 ? 0 : textarea.value.length);
    if (!candidates.length || !boundaries.length) return false;
    const boundary = direction === -1 ? Math.min(...boundaries) : Math.max(...boundaries);
    // A collapsed range can include both sides of a soft wrap. The DOM does not
    // expose textarea caret affinity; absent keyboard evidence, require both.
    const caret = affinity === "upstream" ? [Math.min(...candidates)] :
      affinity === "downstream" ? [Math.max(...candidates)] : candidates;
    return caret.every((top) => Math.abs(top - boundary) < 1);
  } finally {
    mirror.remove();
  }
}
