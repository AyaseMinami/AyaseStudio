import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("exposes chat and settings as top-level pages with one current page", () => {
    const chatHtml = renderToStaticMarkup(
      <AppShell activePage="chat" onPageChange={() => undefined}>
        <p>Chat workspace</p>
      </AppShell>,
    );
    const settingsHtml = renderToStaticMarkup(
      <AppShell activePage="settings" onPageChange={() => undefined}>
        <p>Settings workspace</p>
      </AppShell>,
    );

    expect(chatHtml).toMatch(
      /<button[^>]*aria-label="聊天"[^>]*aria-current="page"/,
    );
    expect(chatHtml).not.toMatch(
      /<button[^>]*aria-label="设置"[^>]*aria-current="page"/,
    );
    expect(settingsHtml).toMatch(
      /<button[^>]*aria-label="设置"[^>]*aria-current="page"/,
    );
    expect(settingsHtml).not.toMatch(
      /<button[^>]*aria-label="聊天"[^>]*aria-current="page"/,
    );
  });

  it("makes the whole workspace inert while a consistent backup snapshot is prepared", () => {
    const html = renderToStaticMarkup(
      <AppShell activePage="settings" interactionDisabled onPageChange={() => undefined}>
        <p>Settings workspace</p>
      </AppShell>,
    );

    expect(html).toMatch(/<main[^>]*inert=""[^>]*aria-busy="true"/);
  });
});
