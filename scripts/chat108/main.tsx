import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "./fixture.css";
import { AppShell, type AppPage } from "../../src/ui/AppShell";
import { ConversationNavigation } from "../../src/ui/chat/ConversationNavigation";
import { useConversationNavigation } from "../../src/ui/chat/useConversationNavigation";
import { ChatWorkspace } from "../../src/ui/chat/ChatWorkspace";
import { ChatHeader } from "../../src/ui/chat/ChatHeader";
import { AppearanceChatPreview } from "../../src/ui/settings/AppearanceChatPreview";
import { AppearanceSettings } from "../../src/ui/settings/AppearanceSettings";
import { WindowControls } from "../../src/ui/window/WindowControls";
import { BackgroundImage } from "../../src/ui/settings/BackgroundImage";
import { installScrollbarAutoHide } from "../../src/ui/scrollbarAutoHide";
import { useConversationWorkspace } from "../../src/chat/useConversationWorkspace";
import { createChatRepository, type StoredChatMessage } from "../../src/chat/repository";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";
import { emptyConnectionSettings } from "../../src/chat/settings";
import { createAppearanceController } from "../../src/appearance/appearance";
import type { ThinkingSettings } from "../../src/chat/thinking";
import type { SearchMode } from "../../src/search/mode";
import type { ChatLayout } from "../../src/ui/chat/useChatLayout";
import type { RequestAttachment, SentAttachment } from "../../src/chat/attachments";
import { GlassPerformance, glassPerformanceEnabled, performanceMessages } from "./glassPerformance";

// Isolated local artwork only; generated wallpaper is an optional ignored local asset.
const artwork = document.createElement("canvas");
artwork.width = 960; artwork.height = 600;
const context = artwork.getContext("2d")!;
const gradient = context.createLinearGradient(0, 0, 960, 600);
gradient.addColorStop(0, "#25475e"); gradient.addColorStop(0.45, "#ba8c73"); gradient.addColorStop(1, "#547a76");
context.fillStyle = gradient; context.fillRect(0, 0, 960, 600);
for (let row = 0; row < 8; row++) for (let column = 0; column < 14; column++) {
  context.fillStyle = (row + column) % 2 ? "#fff4" : "#102a423d";
  context.beginPath(); context.arc(column * 78, row * 90, 20 + (column % 3) * 10, 0, Math.PI * 2); context.fill();
}
context.fillStyle = "#f5e4cf"; context.font = "600 44px sans-serif";
context.fillText("AYASE / SYNTHETIC", 54, 530);
const wallpaperUrl = artwork.toDataURL("image/png");
const busyArtwork = document.createElement("canvas");
busyArtwork.width = 960; busyArtwork.height = 600;
const busyContext = busyArtwork.getContext("2d")!;
busyContext.drawImage(artwork, 0, 0);
for (let index = 0; index < 28; index++) {
  busyContext.fillStyle = ["#fff9", "#18314999", "#e1988099", "#8ac4c8aa"][index % 4];
  busyContext.beginPath(); busyContext.moveTo(index * 48 - 120, 0); busyContext.lineTo(index * 48 + 170, 600);
  busyContext.lineTo(index * 48 + 190, 600); busyContext.lineTo(index * 48 - 90, 0); busyContext.fill();
}
const busyWallpaperUrl = busyArtwork.toDataURL("image/png");
const demoImage = wallpaperUrl.split(",")[1];
const imageBlob = await new Promise<Blob>((resolve, reject) => artwork.toBlob(blob => blob ? resolve(blob) : reject(new Error("Synthetic image encoding failed")), "image/png"));
const imageAttachment: SentAttachment = { reference: "chat108-synthetic-image", name: "合成构图.png", mimeType: "image/png", size: imageBlob.size };
async function readImage(item: SentAttachment): Promise<RequestAttachment> {
  if (item.reference !== imageAttachment.reference) throw new Error("Only the fixture's synthetic image is available.");
  return { name: item.name, mimeType: item.mimeType, size: item.size, data: demoImage };
}

const longAnswer = `## 把阅读笔记整理成可以继续使用的材料

先记下一个清楚的问题：**这段内容改变了我对什么的理解？** 留出一点空白，让重要的观点有自己的位置。

### 三步整理

1. 用一句话概括主题，避免把原文重新抄一遍。
2. 给每个观点留一条证据，再写出它适用的条件。
3. 最后记录一个可以继续追问的问题。

> 好的笔记可以很短。关键是下次阅读时，能够知道当时为什么觉得它有价值。

| 材料 | 记录内容 | 下一步 |
| --- | --- | --- |
| 概念 | 用自己的话解释 | 找一个反例 |
| 数据 | 数字、单位与背景 | 对照其他证据 |
| 实践 | 做了什么与结果 | 缩小实验范围 |

下面是一段可以复用的代码：

\`\`\`typescript
interface ReadingNote {
  question: string;
  evidence: string[];
  nextStep?: string;
}

function summarize(note: ReadingNote): string {
  return [note.question, ...note.evidence].join("\\n");
}
\`\`\`

还可以用一个简单公式提醒自己：$价值 = 理解 + 可复用性$。这里的公式只是阅读练习，并不代表可测量的指标。

### 回顾时可以检查

- [x] 是否有明确的问题
- [x] 是否把结论和证据分开
- [ ] 是否留下下一步

这是一段较长的合成回复，用来观察中文阅读节奏、行宽、代码块、表格与消息操作的关系。滚动到顶部可以检查短问答，滚动到底部可以切换最后一轮的两个版本。`;

function seedMessages(): StoredChatMessage[] {
  const firstUser: StoredChatMessage = { id: "demo-u1", role: "user", content: "你好。今天可以帮我整理一下阅读笔记吗？", status: "complete" };
  const firstAnswer: StoredChatMessage = { id: "demo-a1", role: "assistant", generationModel: "demo-model-a", replyToId: firstUser.id, content: "可以。把你想保留的观点发给我，我们一起整理。", status: "complete" };
  const imageUser: StoredChatMessage = { id: "demo-u2", role: "user", content: "我想保留轻松的阅读感受，类似这张构图。", attachments: [imageAttachment], status: "complete" };
  const imageAnswer: StoredChatMessage = { id: "demo-a2", role: "assistant", replyToId: imageUser.id, content: "这张合成图片用来检查附件缩略图和预览弹层。正文可以保持简洁，让材料自己说话。", status: "complete" };
  const user: StoredChatMessage = { id: "demo-u3", role: "user", content: "请给一个完整的整理示例，包括表格、代码和检查清单。", status: "complete" };
  const answer: StoredChatMessage = { id: "demo-a3", role: "assistant", generationModel: "demo-model-b", replyToId: user.id, content: longAnswer, thinkingSummary: "先确定笔记的使用目的，再把观点、证据和下一步分开。示例包含常见 Markdown 元素，方便检查密集内容的阅读体验。此处全部为合成思考内容。", status: "complete",
    generationMetrics: [{ version: 1, protocol: "openai-chat", streaming: true, status: "complete", elapsedMs: 4800, firstTextMs: 420, usageComplete: true, usage: { inputTokens: 840, outputTokens: 326, cacheReadTokens: 320 } }] };
  const alternative: StoredChatMessage = { ...answer, id: "demo-a3-v2", content: "## 简短版本\n\n先写问题，再补证据，最后留下下一步。\n\n- 问题：我想理解什么？\n- 证据：哪些内容支持这个判断？\n- 下一步：有什么值得继续验证？\n\n这是同一轮的第二个合成版本，可用箭头返回完整示例。", thinkingSummary: undefined };
  return [firstUser, firstAnswer, imageUser, imageAnswer, { ...user, roundVersions: { selected: 0, pairs: [[user, answer], [user, alternative]] } }, answer];
}

const repository = createChatRepository("Chat108Synthetic");
const initial = await repository.initializeWorkspace(null, []);
if (!initial.assistants.some(assistant => assistant.id === "chat108-reading")) {
  for (const [index, name] of ["阅读助手", "写作助手", "👩🏽‍💻 开发助手", "研究与资料整理", "随手记录", "长名称助手 · 观察省略与头像列"].entries()) {
    const id = index === 0 ? "chat108-reading" : `chat108-assistant-${index}`;
    await repository.execute({ type: "create-assistant", id, input: { name, icon: "", defaultModelId: null, defaultConfig: defaultSessionConfig(),
      ...(index === 2 ? { avatar: { original: imageBlob, thumbnail: imageBlob, crop: { x: 0.5, y: 0.5, zoom: 1 } } } : {}) } });
    for (let conversationIndex = 0; conversationIndex < (index === 0 ? 14 : 2); conversationIndex++) {
      const conversationId = `${id}-c${conversationIndex}`;
      await repository.execute({ type: "create-conversation", id: conversationId, assistantId: id });
      await repository.execute({ type: "rename-conversation", id: conversationId, title: conversationIndex === 0 ? "今天的阅读笔记" : conversationIndex === 1 ? "简短问答" : `阅读片段 ${conversationIndex}` });
      await repository.save({ id: conversationId, updatedAt: Date.now(), messages: conversationIndex === 0 ? seedMessages() : conversationIndex === 1 ? seedMessages().slice(0, 2) : [] });
    }
  }
  await repository.execute({ type: "select", assistantId: "chat108-reading", conversationId: "chat108-reading-c0" });
}
const emptyModelIds: string[] = [];
const generatingIds = new Set<string>();
// Dedicated fixture key on a dedicated origin; no production preferences or native resources.
const appearanceController = createAppearanceController({
  storage: { getItem: () => localStorage.getItem("chat108-appearance"), setItem: (_key, value) => localStorage.setItem("chat108-appearance", value) },
  systemTheme: { isDark: () => false, subscribe: () => () => {} }, target: document.documentElement,
});
installScrollbarAutoHide(document);

function Review() {
  const [performanceView, setPerformanceView] = useState({ messages: performanceMessages, generating: false });
  const [page, setPage] = useState<AppPage>("chat");
  const appearance = useSyncExternalStore(appearanceController.subscribe, appearanceController.getSnapshot);
  const theme = appearance.resolvedTheme;
  const setTheme = appearanceController.setThemeMode;
  const palette = appearance.colorPreset === "reading" ? "reading" : appearance.userBubbleColor === "#18364a" ? "custom" : "default";
  function setPalette(next: "default" | "reading" | "custom") {
    appearanceController.setColorPreset(next === "reading" ? "reading" : "default");
    if (next === "custom") {
      appearanceController.setUserBubbleColor("#18364a");
      appearanceController.setAssistantBubbleColor(theme === "light" ? "#e9cfaa" : "#443d32");
    }
  }
  const [wallpaper, setWallpaper] = useState(false);
  const [wallpaperKind, setWallpaperKind] = useState<"complex" | "busy" | "anime">("complex");
  const displayedWallpaper = wallpaperKind === "anime" ? "/.chat108.local/anime-opacity/wallpaper.png" : wallpaperKind === "busy" ? busyWallpaperUrl : wallpaperUrl;
  const transparency = appearance.unifiedTransparency;
  const setTransparency = appearanceController.setUnifiedTransparency;
  const [layout, setLayout] = useState<ChatLayout>("narrow");
  const [thinking, setThinking] = useState<ThinkingSettings>();
  const [searchMode, setSearchMode] = useState<SearchMode>("off");
  const navigation = useConversationNavigation();
  const workspace = useConversationWorkspace(repository, null, emptyModelIds, () => false);
  useEffect(() => {
    if (palette === "custom") appearanceController.setAssistantBubbleColor(theme === "light" ? "#e9cfaa" : "#443d32");
  }, [theme, palette]);
  useEffect(() => {
    document.documentElement.setAttribute("data-has-background", String(wallpaper));
  }, [wallpaper, appearance]);

  async function saveMessages(messages: StoredChatMessage[]) {
    if (!workspace.isReady || !workspace.store) return;
    await workspace.store.updateMessages(messages);
    workspace.setMessages(messages);
  }
  async function send() {
    if (!workspace.isReady || !workspace.view.draft.trim()) return;
    const user: StoredChatMessage = { id: crypto.randomUUID(), role: "user", content: workspace.view.draft, status: "complete" };
    await saveMessages([...workspace.view.messages, user, { id: crypto.randomUUID(), role: "assistant", replyToId: user.id,
      content: "已收到。这是一条本地合成回复，用来检查发送后的布局和滚动。", generationModel: "demo-local-model", status: "complete" }]);
    workspace.setDraft("");
  }
  async function clear() { await saveMessages([]); }
  const conversationId = workspace.conversation?.id;
  const toggleLayout = () => setLayout(current => current === "wide" ? "narrow" : "wide");
  const preview = <div className="settings-workspace"><header className="settings-header" data-tauri-drag-region><WindowControls /></header><div className="settings-page-scroll">
    <AppearanceSettings {...appearance} backgroundUrl={wallpaper ? displayedWallpaper : null}
      onThemeModeChange={appearanceController.setThemeMode} onColorPresetChange={appearanceController.setColorPreset}
      onUnifiedThemeColorChange={appearanceController.setUnifiedThemeColor} onUserBubbleColorChange={appearanceController.setUserBubbleColor}
      onAccentColorChange={appearanceController.setAccentColor} onCanvasColorChange={appearanceController.setCanvasColor}
      onAssistantBubbleColorChange={appearanceController.setAssistantBubbleColor} onAssistantBubbleTransparencyChange={appearanceController.setAssistantBubbleTransparency}
      onUnifiedTransparencyChange={appearanceController.setUnifiedTransparency} onChromeTransparencyChange={appearanceController.setChromeTransparency}
      onSidebarTransparencyChange={appearanceController.setSidebarTransparency} onComposerTransparencyChange={appearanceController.setComposerTransparency}
      onSidebarGlassEnabledChange={appearanceController.setSidebarGlassEnabled} onComposerGlassEnabledChange={appearanceController.setComposerGlassEnabled}
      onBackgroundFitChange={appearanceController.setBackgroundFit} onBackgroundMaskChange={appearanceController.setBackgroundMask} onBackgroundBlurChange={appearanceController.setBackgroundBlur}
      onEditBackgroundFocus={() => {}} onPrepareLibraryBackground={async () => null}
      onSaveLibraryBackground={async () => { throw new Error("The fixture only uses generated artwork."); }} onDiscardLibraryBackground={async () => {}}
      onResolveLibraryBackground={async () => { throw new Error("No native resources in this fixture."); }} onApplyLibraryBackground={async () => {}}
      onRemoveLibraryBackgrounds={async () => {}} onRestoreBackground={async () => {}} onRemoveBackground={async () => {}}
      onResetCustomAppearance={appearanceController.resetCustomAppearance} />
    </div></div>;
  return <><AppShell activePage={page} onPageChange={setPage}
    background={wallpaper ? <BackgroundImage url={displayedWallpaper} focus={null} fit="cover" blur={0} /> : undefined}>
    {page === "chat" ? <ConversationNavigation workspace={workspace} settings={emptyConnectionSettings} generatingIds={generatingIds} navigation={navigation}
      toolbar={<ChatHeader conversationId={conversationId} title={workspace.conversation?.title ?? "加载合成会话"} layout={layout} onToggleLayout={toggleLayout}
        isHydrated={workspace.isReady} isWorkspaceBusy={workspace.isTemporarilyBusy} isGenerating={false} onClear={() => void clear()} />}>
      <ChatWorkspace key={conversationId ?? "loading"} hideHeader assistant={workspace.assistant}
        title={workspace.conversation?.title ?? "合成会话"} layout={layout} onToggleLayout={toggleLayout}
        draft={workspace.view.draft} draftSelection={workspace.view.draftSelection} onDraftSelectionChange={workspace.setDraftSelection} onBrowseHistory={workspace.browseHistory}
        modelPicker={{ settings: emptyConnectionSettings, selectedModelId: null, disabled: !workspace.isReady, onSelect: async () => false }}
        thinking={thinking} protocol="openai-chat" onThinkingChange={setThinking} searchMode={searchMode} onSearchModeChange={setSearchMode}
        isWorkspaceBusy={workspace.isTemporarilyBusy} messageActionsDisabled={!workspace.isReady}
        messageActions={{
          edit: async (messageId, content) => !!conversationId && workspace.execute({ type: "edit-message", conversationId, messageId, content }),
          editAndSend: async (messageId, content) => {
            if (!conversationId) return false;
            const saved = await workspace.execute({ type: "edit-message", conversationId, messageId, content });
            if (saved) workspace.setError("编辑已保存在合成会话；此夹具不执行模型生成。");
            return saved;
          },
          delete: async messageId => !!conversationId && workspace.execute({ type: "delete-message", conversationId, messageId }),
          retry: async () => { workspace.setError("此夹具不执行重新生成；可切换末轮预设版本，或发送文字插入合成回复。"); },
          branch: async messageId => !!conversationId && workspace.execute({ type: "fork-conversation", id: crypto.randomUUID(), conversationId, messageId,
            creationConfig: { modelId: workspace.effective.modelId, config: workspace.effective.config } }),
          selectVersion: async index => !!conversationId && workspace.execute({ type: "select-round-version", conversationId, index }),
        }}
        onReadAttachment={readImage} messages={glassPerformanceEnabled ? performanceView.messages : workspace.view.messages} isHydrated={workspace.isReady} isGenerating={glassPerformanceEnabled && performanceView.generating}
        error={workspace.view.error ?? workspace.operationError ?? workspace.loadError}
        protocolLabel="本地合成回复" modelLabel="合成预览" onDraftChange={workspace.setDraft} onDraftActivate={navigation.activateDraft}
        onClear={() => void clear()} onSend={() => void send()} onStop={() => {}} />
    </ConversationNavigation> : page === "settings" ? preview : <div className="drawing-workspace"><header className="drawing-header" data-tauri-drag-region><WindowControls /></header><section className="chat108-preview-page"><h2>绘图外框检查</h2><p>仅检查共享功能栏与标题栏，不生成图片。</p><AppearanceChatPreview url={wallpaper ? displayedWallpaper : null} focus={null} fit="cover" mask={appearance.backgroundMask} blur={0} /></section></div>}
  </AppShell><details className="chat108-toolbar"><summary>预览控制 · #108</summary><div className="chat108-controls">
    <label>主题<select aria-label="夹具主题" value={theme} onChange={event => {
      const nextTheme = event.currentTarget.value as "light" | "dark";
      if (palette === "reading" && nextTheme === "dark") setPalette("default");
      setTheme(nextTheme);
    }}><option value="light">浅色</option><option value="dark">深色</option></select></label>
    <label>配色<select aria-label="夹具配色" value={palette} onChange={event => {
      const nextPalette = event.currentTarget.value as "default" | "reading" | "custom";
      if (nextPalette === "reading") setTheme("light");
      setPalette(nextPalette);
    }}><option value="default">默认</option><option value="reading">阅读</option><option value="custom">深色用户／暖色助手</option></select></label>
    <label>合成背景<select aria-label="夹具背景" value={wallpaper ? wallpaperKind : "none"} onChange={event => {
      const value = event.currentTarget.value;
      setWallpaper(value !== "none"); if (value !== "none") setWallpaperKind(value as "complex" | "busy" | "anime");
    }}><option value="none">纯色</option><option value="complex">复杂构图</option><option value="busy">密集明暗构图</option><option value="anime">生成的二次元壁纸</option></select></label>
    <label>透明度 {transparency}%<input aria-label="夹具统一透明度" type="range" min="0" max="100" step="5" value={transparency} onChange={event => setTransparency(Number(event.currentTarget.value))} /></label>
    <label>外框 {appearance.chromeTransparency}%<input aria-label="夹具外框透明度" type="range" min="0" max="100" value={appearance.chromeTransparency} onChange={event => appearanceController.setChromeTransparency(Number(event.currentTarget.value))} /></label>
    <label>侧栏 {appearance.sidebarTransparency}%<input aria-label="夹具侧栏透明度" type="range" min="0" max="100" value={appearance.sidebarTransparency} onChange={event => appearanceController.setSidebarTransparency(Number(event.currentTarget.value))} /></label>
    <label>气泡 {appearance.assistantBubbleTransparency}%<input aria-label="夹具气泡透明度" type="range" min="0" max="100" value={appearance.assistantBubbleTransparency} onChange={event => appearanceController.setAssistantBubbleTransparency(Number(event.currentTarget.value))} /></label>
    <label>遮罩 {appearance.backgroundMask}%<input aria-label="夹具背景遮罩" type="range" min="0" max="100" value={appearance.backgroundMask} onChange={event => appearanceController.setBackgroundMask(Number(event.currentTarget.value))} /></label>
    <label>侧栏玻璃<input aria-label="夹具侧栏玻璃" type="checkbox" checked={appearance.sidebarGlassEnabled} onChange={event => appearanceController.setSidebarGlassEnabled(event.currentTarget.checked)} /></label>
    <div className="chat108-comparisons" aria-label="透明度对照">
      {[[75, 20, 6], [25, 35, 6], [35, 45, 6], [40, 50, 6], [45, 55, 6], [50, 60, 6], [60, 70, 6], [40, 50, 12], [40, 50, 20], [40, 50, 30]].map(([chrome, sidebar, bubble]) =>
        <button className="settings-button" type="button" key={`${chrome}-${sidebar}-${bubble}`} onClick={() => {
          appearanceController.setChromeTransparency(chrome); appearanceController.setSidebarTransparency(sidebar); appearanceController.setAssistantBubbleTransparency(bubble);
        }}>{`外框 ${chrome} / 侧栏 ${sidebar} / 气泡 ${bubble}`}</button>)}
    </div>
    <label>聊天宽度<select aria-label="夹具聊天宽度" value={layout} onChange={event => setLayout(event.currentTarget.value as ChatLayout)}><option value="narrow">窄屏</option><option value="wide">宽屏</option></select></label>
    <button className="settings-button" type="button" onClick={() => setPage(page === "settings" ? "chat" : "settings")}>{page === "settings" ? "返回真实聊天" : "查看外观预览"}</button>
    <button className="settings-button" disabled={!workspace.isReady} type="button" onClick={() => void saveMessages(seedMessages())}>恢复当前会话示例</button>
    <p>独立合成数据；发送只插入固定回复。编辑、删除、分支和版本切换会写入此预览库。</p>
  </div></details>{glassPerformanceEnabled && <GlassPerformance ready={workspace.isReady}
    onMessages={(messages, generating) => setPerformanceView({ messages, generating })}
    onGlass={(sidebar, composer) => { appearanceController.setSidebarGlassEnabled(sidebar); appearanceController.setComposerGlassEnabled(composer); }}
    onTheme={setTheme} onPrepare={() => { setPage("chat"); setWallpaper(true); setWallpaperKind("busy"); setLayout("narrow"); navigation.openConversations(); }} />}</>;
}
createRoot(document.getElementById("root")!).render(<Review />);
