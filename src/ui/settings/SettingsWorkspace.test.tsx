import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ConnectionSettingsState } from "../../chat/settings";
import { SettingsWorkspace } from "./SettingsWorkspace";

const connectionSettings: ConnectionSettingsState = {
  version: 3,
  providers: [
    {
      id: "provider-example",
      name: "示例供应商",
      connections: [
        {
          id: "connection-example",
          name: "高速线路",
          protocol: "openai-chat",
          baseUrl: "https://relay.example.com/v1",
          apiKey: "synthetic-test-key",
          models: [
            {
              id: "model-example",
              modelId: "example-model",
              displayName: "示例模型",
            },
          ],
        },
      ],
    },
  ],
  activeModelId: "model-example",
};

const sharedProps = {
  appearance: {
    themeMode: "system" as const,
    onThemeModeChange: () => undefined,
  },
  connection: {
    connectionSettings,
    isStreaming: false,
    modelCatalogs: {},
    modelTests: {},
    onAddConnection: () => "connection-new",
    onAddModel: () => "model-new",
    onAddProvider: () => "provider-new",
    onCancelModelCatalogRefresh: () => undefined,
    onCancelModelTest: () => undefined,
    onConnectionChange: () => undefined,
    onDeleteConnection: () => undefined,
    onDeleteModel: () => undefined,
    onDeleteProvider: () => undefined,
    onModelChange: () => undefined,
    onProviderRename: () => undefined,
    onRefreshModelCatalog: async () => undefined,
    onRunModelTest: async () => undefined,
    onSelectModel: () => undefined,
  },
  onSectionChange: () => undefined,
};

describe("SettingsWorkspace", () => {
  it("renders the three-level connection workspace with distinct selection states", () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace {...sharedProps} activeSection="connections" />,
    );

    expect(html).toMatch(
      /<button[^>]*aria-label="连接配置"[^>]*aria-current="page"/,
    );
    expect(html).toContain('aria-label="供应商列表"');
    expect(html).toContain('aria-label="连接渠道列表"');
    expect(html).toContain('aria-label="模型列表"');
    expect(html).toContain("示例供应商");
    expect(html).toContain("高速线路");
    expect(html).toContain("example-model");
    expect(html).toContain("当前模型");
    expect(html).toContain("添加连接");
    expect(html).toContain("获取模型列表");
    expect(html).not.toContain("添加协议");
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
