import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getProtocolOption } from "../../chat/protocolOptions";
import { SettingsWorkspace } from "./SettingsWorkspace";

const sharedProps = {
  appearance: {
    themeMode: "system" as const,
    onThemeModeChange: () => undefined,
  },
  connection: {
    activeProfile: {
      baseUrl: "https://relay.example.com/v1",
      apiKey: "secret",
      model: "example-model",
    },
    isStreaming: false,
    protocol: "openai-chat" as const,
    protocolInfo: getProtocolOption("openai-chat"),
    onProfileChange: () => undefined,
    onProtocolChange: () => undefined,
  },
  onSectionChange: () => undefined,
};

describe("SettingsWorkspace", () => {
  it("renders connection configuration as its own settings page", () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace {...sharedProps} activeSection="connections" />,
    );

    expect(html).toMatch(
      /<button[^>]*aria-label="连接配置"[^>]*aria-current="page"/,
    );
    expect(html).toContain("Base URL");
    expect(html).toContain("API Key");
    expect(html).toContain("Model");
    expect(html).not.toContain("主题模式");
  });

  it("renders appearance as a separate settings page", () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace {...sharedProps} activeSection="appearance" />,
    );

    expect(html).toMatch(
      /<button[^>]*aria-label="外观"[^>]*aria-current="page"/,
    );
    expect(html).toContain("主题模式");
    expect(html).toContain("跟随系统");
    expect(html).not.toContain("API Key");
  });
});
