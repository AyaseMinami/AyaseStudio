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
    resolvedTheme: "light" as const,
    accentColor: null,
    canvasColor: null,
    effectiveAccentColor: "#6d28d9",
    effectiveCanvasColor: "#fafaf9",
    backgroundReference: null,
    backgroundFit: "cover" as const,
    backgroundMask: 65,
    backgroundBlur: 0,
    backgroundBusy: false,
    backgroundError: null,
    readabilityWarnings: [],
    onThemeModeChange: () => undefined,
    onAccentColorChange: () => undefined,
    onCanvasColorChange: () => undefined,
    onBackgroundFitChange: () => undefined,
    onBackgroundMaskChange: () => undefined,
    onBackgroundBlurChange: () => undefined,
    onSelectBackground: () => undefined,
    onRemoveBackground: () => undefined,
    onResetCustomAppearance: () => undefined,
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
    onProviderMove: () => undefined,
    onRefreshModelCatalog: async () => undefined,
    onRunModelTest: async () => undefined,
    onSelectModel: () => undefined,
  },
  onSectionChange: () => undefined,
};

describe("SettingsWorkspace", () => {
  it("shows the HTTP status and provider detail in a failed model test", () => {
    const html = renderToStaticMarkup(<SettingsWorkspace {...sharedProps} activeSection="connections"
      connection={{ ...sharedProps.connection, modelTests: { "model-example": {
        status: "failed", totalMs: 10,
        error: { kind: "http", status: 401, message: "Unauthorized <script>unsafe</script>", retryable: false },
      } } }} />);
    expect(html).toContain("HTTP 401");
    expect(html).toContain("Unauthorized &lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("renders the three-level connection workspace with distinct selection states", () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace {...sharedProps} activeSection="connections" />,
    );

    expect(html).toMatch(
      /<button[^>]*aria-label="连接配置"[^>]*aria-current="page"/,
    );
    expect(html).toContain('aria-label="供应商列表"');
    expect(html).toContain('aria-label="示例供应商的连接渠道列表"');
    expect(html).toContain('aria-label="连接详情"');
    expect(html).toContain("请求地址详情");
    expect(html).not.toMatch(/第一栏|第二栏|第三栏/);
    expect(html).toContain('aria-label="模型列表"');
    expect(html).toContain("示例供应商");
    expect(html).toContain("高速线路");
    expect(html).toContain("example-model");
    expect(html).toContain("助手默认模型");
    expect(html).toContain('aria-label="设为助手默认模型 example-model"');
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
    expect(html).toContain("自定义配色");
    expect(html).toContain('type="color"');
    expect(html).toContain("选择本地图片");
    expect(html).toContain("填充");
    expect(html).toContain("适应");
    expect(html).toContain("遮罩强度");
    expect(html).toContain("模糊程度");
    expect(html).toContain("恢复当前主题默认外观");
    expect(html).not.toContain("API Key");
  });

  it("shows replacement and removal controls for an imported background", () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        {...sharedProps}
        activeSection="appearance"
        appearance={{
          ...sharedProps.appearance,
          backgroundReference:
            "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp",
          backgroundFit: "contain",
          backgroundMask: 52,
          backgroundBlur: 8,
        }}
      />,
    );

    expect(html).toContain("本地背景已应用");
    expect(html).toContain("替换本地图片");
    expect(html).toContain("移除背景");
    expect(html).toContain("52%");
    expect(html).toContain("8px");
    expect(html).toMatch(/<option value="contain" selected=""/);
  });
});
