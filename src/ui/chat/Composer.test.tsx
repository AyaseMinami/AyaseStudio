// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Composer } from "./Composer";

it("retains the full multiline provider error and status as inert text", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const error = '<html><script>alert(1)</script></html>\n' + "details ".repeat(1000) + "\nrequest-id: final-line (400)";
  try {
    await act(async () => root.render(<Composer draft="" error={error} isHydrated isGenerating={false}
      onDraftChange={() => {}} onSend={() => {}} onStop={() => {}} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(error);
    expect(host.querySelector("script")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
