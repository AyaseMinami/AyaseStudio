// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionSettingsState } from "../../chat/settings";
import type { GeneralSettingsState } from "../../general/preferences";
import { avatarLibrary } from "../../avatar/library";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../avatar/image";
import { SettingsWorkspace } from "./SettingsWorkspace";

vi.mock("../../avatar/library", () => ({ avatarLibrary: { list: vi.fn(), usages: vi.fn() } }));
vi.mock("../../avatar/image", async (original) => ({ ...await original<typeof import("../../avatar/image")>(), decodeAvatar: vi.fn(), renderAvatar: vi.fn() }));

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
    unifiedThemeColor: null, effectiveUserBubbleColor: "#d2e3f7",
    onUnifiedThemeColorChange: () => undefined, onUserBubbleColorChange: () => undefined,
    colorPreset: "default" as const,
    onColorPresetChange: () => undefined,
    themeMode: "system" as const,
    resolvedTheme: "light" as const,
    accentColor: null,
    canvasColor: null,
    assistantBubbleColor: null,
    unifiedTransparency: 0,
    chromeTransparency: 40,
    sidebarTransparency: 0,
    composerTransparency: 0,
    sidebarGlassEnabled: false,
    composerGlassEnabled: false,
    assistantBubbleTransparency: 6,
    effectiveAccentColor: "#6d28d9",
    effectiveCanvasColor: "#fafaf9",
    backgroundReference: null,
    backgroundLibrary: [],
    backgroundEnabled: false,
    backgroundName: null,
    backgroundUrl: null,
    backgroundFocus: null,
    backgroundFit: "cover" as const,
    backgroundMask: 65,
    backgroundBlur: 0,
    backgroundBusy: false,
    backgroundError: null,
    readabilityWarnings: [],
    onThemeModeChange: () => undefined,
    onAccentColorChange: () => undefined,
    onCanvasColorChange: () => undefined,
    onAssistantBubbleColorChange: () => undefined,
    onUnifiedTransparencyChange: () => undefined,
    onChromeTransparencyChange: () => undefined,
    onSidebarTransparencyChange: () => undefined,
    onComposerTransparencyChange: () => undefined,
    onSidebarGlassEnabledChange: () => undefined,
    onComposerGlassEnabledChange: () => undefined,
    onAssistantBubbleTransparencyChange: () => undefined,
    onEditBackgroundFocus: () => undefined,
    onBackgroundFitChange: () => undefined,
    onBackgroundMaskChange: () => undefined,
    onBackgroundBlurChange: () => undefined,
    onPrepareLibraryBackground: async () => null,
    onSaveLibraryBackground: async () => { throw new Error("not used"); },
    onDiscardLibraryBackground: async () => undefined,
    onResolveLibraryBackground: async () => { throw new Error("not used"); },
    onApplyLibraryBackground: async () => undefined,
    onRemoveLibraryBackgrounds: async () => undefined,
    onRestoreBackground: async () => undefined,
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
    onConnectionMove: () => undefined,
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
  it("places general first and keeps search before data management", () => {
    const html = renderToStaticMarkup(<SettingsWorkspace {...sharedProps} activeSection="search" />);
    expect(html).toMatch(/<button[^>]*aria-label="网络搜索"[^>]*aria-current="page"/);
    const navigationLabels = [...html.matchAll(/<button[^>]*class="settings-navigation-button"[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
    expect(navigationLabels).toEqual(["常规", "连接配置", "外观", "网络搜索", "数据管理", "关于"]);
    expect(html).toContain("搜索服务与偏好");
    expect(html).toContain("网络搜索");
    expect(html).not.toContain('aria-label="供应商列表"');
  });
  it("shows about and feedback as a separate settings destination", () => {
    const html = renderToStaticMarkup(<SettingsWorkspace {...sharedProps} activeSection="about" />);
    expect(html).toMatch(/<button[^>]*aria-label="关于"[^>]*aria-current="page"/);
    expect(html).toContain("反馈与建议");
    expect(html).toContain("ayasechikage@gmail.com");
    expect(html).not.toContain("API Key<input");
  });
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
    expect(html).toContain("选择背景");
    expect(html).toMatch(/role="combobox"[^>]*aria-label="图片适配方式"[^>]*><span>填充<\/span>/);
    expect(html).toContain("遮罩强度");
    expect(html).toContain("模糊程度");
    expect(html).toContain("恢复当前主题默认外观");
    expect(html).not.toContain("API Key");
  });

  it("shows library selection and disable controls for an applied background", () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        {...sharedProps}
        activeSection="appearance"
        appearance={{
          ...sharedProps.appearance,
          backgroundReference:
            "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp",
          backgroundEnabled: true,
          backgroundUrl: "asset://localhost/private/background.webp",
          backgroundFit: "contain",
          backgroundMask: 52,
          backgroundBlur: 8,
        }}
      />,
    );

    expect(html).toContain("本地背景已应用");
    expect(html).toContain("选择背景");
    expect(html).toContain("停用背景");
    expect(html).toContain("52%");
    expect(html).toContain("8px");
    expect(html).toMatch(/role="combobox"[^>]*aria-label="图片适配方式"[^>]*><span>适应<\/span>/);
  });
});

describe("general settings interactions", () => {
  let root: Root;
  let host: HTMLDivElement;
  const setPreference = vi.fn<GeneralSettingsState["setPreference"]>();
  const saveAvatar = vi.fn();
  const avatar = { busy: false, value: undefined, url: "blob:current-avatar", error: undefined, save: saveAvatar };
  const general: GeneralSettingsState = {
    preferences: { version: 1, backgroundResident: true, confirmBeforeExit: true },
    error: null,
    setPreference,
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    vi.clearAllMocks();
    setPreference.mockResolvedValue(true); saveAvatar.mockResolvedValue(true);
    vi.mocked(avatarLibrary.list).mockResolvedValue([]);
    vi.mocked(avatarLibrary.usages).mockResolvedValue([]);
    const image = document.createElement("img");
    Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });
    vi.mocked(decodeAvatar).mockResolvedValue(image);
    vi.mocked(renderAvatar).mockResolvedValue(new Blob(["crop"], { type: "image/png" }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:crop-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  async function mount(state: GeneralSettingsState | undefined = general) {
    await act(async () => root.render(<SettingsWorkspace {...sharedProps} activeSection="general" avatar={avatar} general={state} />));
  }
  function button(label: string) {
    const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
    expect(found, label).toBeTruthy();
    return found!;
  }
  async function click(label: string) { await act(async () => button(label).click()); }

  it("routes the first navigation entry to general", async () => {
    const onSectionChange = vi.fn();
    await act(async () => root.render(<SettingsWorkspace {...sharedProps} activeSection="connections" onSectionChange={onSectionChange} />));
    await click("常规"); expect(onSectionChange).toHaveBeenCalledWith("general");
  });

  it("shows only a compact current avatar until either library entry opens a modal, then restores focus", async () => {
    await mount();
    expect(host.querySelector('[aria-label="常规"]')?.getAttribute("aria-current")).toBe("page");
    const image = host.querySelector<HTMLImageElement>('img[alt="当前用户头像"]')!;
    expect(image.width).toBe(64); expect(image.height).toBe(64);
    expect(host.querySelector("dialog")).toBeNull();
    expect(host.querySelector('[aria-label="头像聊天效果预览"]')).toBeNull();
    expect(avatarLibrary.list).not.toHaveBeenCalled();
    for (const label of ["更换头像", "管理头像库"]) {
      const trigger = button(label); trigger.focus(); await click(label);
      const dialog = host.querySelector<HTMLDialogElement>(`dialog[aria-label="${label}"]`)!;
      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain("导入图片"); expect(dialog.textContent).toContain("管理");
      expect(dialog.textContent).toContain(label === "管理头像库" ? "删除所选" : "用作用户头像");
      expect(dialog.querySelector('[aria-pressed="true"]')?.textContent).toBe(label === "管理头像库" ? "完成管理" : undefined);
      await click("关闭头像弹窗");
      expect(host.querySelector("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
  });

  it("blocks modal close while the existing avatar library is loading", async () => {
    let finish!: (entries: Awaited<ReturnType<typeof avatarLibrary.list>>) => void;
    vi.mocked(avatarLibrary.list).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount(); button("管理头像库").focus(); await click("管理头像库");
    expect(button("关闭头像弹窗").disabled).toBe(true);
    const dialog = host.querySelector("dialog")!;
    const cancel = new Event("cancel", { bubbles: true, cancelable: true });
    await act(async () => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true); expect(dialog.isConnected).toBe(true);
    await act(async () => finish([]));
    expect(button("关闭头像弹窗").disabled).toBe(false);
    await act(async () => dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(button("管理头像库"));
  });

  it("preserves current-avatar recrop and restore-default controls inside the modal", async () => {
    const original = new Blob(["synthetic"], { type: "image/png" });
    await act(async () => root.render(<SettingsWorkspace {...sharedProps} activeSection="general" general={general}
      avatar={{ ...avatar, value: { original, thumbnail: original, crop: centeredCrop } }} />));
    expect(host.textContent).not.toContain("重新裁切");
    await click("更换头像");
    expect(button("重新裁切").disabled).toBe(false);
    const restoreAvatar = [...host.querySelectorAll<HTMLButtonElement>('dialog[aria-label="更换头像"] button')].find(node => node.textContent === "恢复默认")!;
    await act(async () => restoreAvatar.click()); expect(saveAvatar).toHaveBeenCalledWith();
  });

  async function openCurrentAvatarCrop() {
    const original = new Blob(["synthetic"], { type: "image/png" });
    await act(async () => root.render(<SettingsWorkspace {...sharedProps} activeSection="general" general={general}
      avatar={{ ...avatar, value: { original, thumbnail: original, crop: centeredCrop } }} />));
    await click("更换头像"); await click("重新裁切");
    const library = host.querySelector<HTMLDialogElement>('dialog[aria-label="更换头像"]')!;
    const crop = host.querySelector<HTMLDialogElement>('dialog[aria-labelledby="avatar-crop-title"]')!;
    expect(library.open).toBe(true); expect(crop.open).toBe(true);
    return { library, crop };
  }

  it("cancels only the nested crop when a native non-bubbling cancel event is dispatched", async () => {
    const { library, crop } = await openCurrentAvatarCrop();
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    await act(async () => crop.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(crop.isConnected).toBe(false);
    expect(library.isConnected).toBe(true); expect(library.open).toBe(true);
    expect(saveAvatar).not.toHaveBeenCalled();
  });

  it("refuses nested crop cancellation during processing without unmounting the outer library", async () => {
    let finish!: (thumbnail: Blob) => void;
    vi.mocked(renderAvatar).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { library, crop } = await openCurrentAvatarCrop();
    await click("应用头像");
    expect(crop.querySelector<HTMLButtonElement>("footer button:last-child")?.disabled).toBe(true);
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    await act(async () => crop.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(crop.isConnected).toBe(true); expect(crop.open).toBe(true);
    expect(library.isConnected).toBe(true); expect(library.open).toBe(true);
    expect(saveAvatar).not.toHaveBeenCalled();
    await act(async () => finish(new Blob(["processed"], { type: "image/png" })));
    expect(saveAvatar).toHaveBeenCalledOnce();
    expect(crop.isConnected).toBe(false); expect(library.isConnected).toBe(true);
  });

  it("cancels only the nested library deletion and retains the outer library and management selection", async () => {
    const original = new Blob(["synthetic"], { type: "image/png" });
    vi.mocked(avatarLibrary.list).mockResolvedValue([{ id: "one", name: "雪", version: "v1", avatar: { original, thumbnail: original, crop: centeredCrop } }]);
    await mount(); await click("管理头像库"); await click("勾选 雪"); await click("删除所选（1）");
    const library = host.querySelector<HTMLDialogElement>('dialog[aria-label="管理头像库"]')!;
    const deletion = host.querySelector<HTMLDialogElement>('dialog[aria-label="删除头像"]')!;
    expect(deletion.open).toBe(true);
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    await act(async () => deletion.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(deletion.isConnected).toBe(false);
    expect(library.isConnected).toBe(true); expect(library.open).toBe(true);
    expect(host.querySelector('[aria-label="勾选 雪"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("routes controlled switches through their preference keys and retains values until supplied state changes", async () => {
    await mount();
    const background = host.querySelector<HTMLInputElement>("#general-background-resident")!;
    const exit = host.querySelector<HTMLInputElement>("#general-confirm-exit")!;
    expect(background.checked).toBe(true); expect(exit.checked).toBe(true);
    await act(async () => background.click());
    expect(setPreference).toHaveBeenLastCalledWith("backgroundResident", false);
    expect(background.checked).toBe(true);
    await act(async () => exit.click());
    expect(setPreference).toHaveBeenLastCalledWith("confirmBeforeExit", false);
    await mount({ ...general, preferences: { ...general.preferences, backgroundResident: false, confirmBeforeExit: false } });
    expect(background.checked).toBe(false); expect(exit.checked).toBe(false);
  });

  it("disables edits while a preference is saving", async () => {
    let finish!: (saved: boolean) => void;
    setPreference.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await act(async () => host.querySelector<HTMLInputElement>("#general-background-resident")!.click());
    expect([...host.querySelectorAll<HTMLInputElement>('[role="switch"]')].every((input) => input.disabled)).toBe(true);
    await act(async () => finish(true));
    expect([...host.querySelectorAll<HTMLInputElement>('[role="switch"]')].every((input) => !input.disabled)).toBe(true);
  });

  it("disables unavailable or unreadable settings and shows the supplied error", async () => {
    await act(async () => root.render(<SettingsWorkspace {...sharedProps} activeSection="general" />));
    expect([...host.querySelectorAll<HTMLInputElement>('[role="switch"]')].every((input) => input.disabled)).toBe(true);
    expect(host.textContent).toContain("常规设置暂不可用");
    await mount({ ...general, error: "常规设置无法读取，原数据已保留。" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("常规设置无法读取，原数据已保留。");
    expect([...host.querySelectorAll<HTMLInputElement>('[role="switch"]')].every((input) => input.disabled)).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>("#general-background-resident")!.click());
    expect(setPreference).not.toHaveBeenCalled();
  });

  it("explains tray restoration and preserves drawing-risk prompts separately from ordinary exit confirmation", async () => {
    await mount();
    await act(async () => button("关闭窗口后在后台运行说明").focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("系统托盘");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("恢复窗口");
    await act(async () => button("退出前确认说明").focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("绘图任务和未保存成果仍会显示各自的风险提示");
  });
});
