import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "./fixture.css";
import { AppShell, type AppPage } from "../../src/ui/AppShell";
import { ConversationNavigation } from "../../src/ui/chat/ConversationNavigation";
import { useConversationNavigation } from "../../src/ui/chat/useConversationNavigation";
import { ChatWorkspace } from "../../src/ui/chat/ChatWorkspace";
import { ChatHeader } from "../../src/ui/chat/ChatHeader";
import { AppearanceChatPreview } from "../../src/ui/settings/AppearanceChatPreview";
import { BackgroundImage } from "../../src/ui/settings/BackgroundImage";
import { installScrollbarAutoHide } from "../../src/ui/scrollbarAutoHide";
import { useConversationWorkspace } from "../../src/chat/useConversationWorkspace";
import { createChatRepository, type StoredChatMessage } from "../../src/chat/repository";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";
import { emptyConnectionSettings } from "../../src/chat/settings";
import { applyInitialAppearance, defaultAppearancePreferences } from "../../src/appearance/appearance";
import type { ThinkingSettings } from "../../src/chat/thinking";
import type { SearchMode } from "../../src/search/mode";
import type { ChatLayout } from "../../src/ui/chat/useChatLayout";
import type { RequestAttachment, SentAttachment } from "../../src/chat/attachments";

// Only local synthetic artwork: no URL, resource store, or image API is consulted.
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
applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: "light" }), setItem: () => {} },
  systemPrefersDark: false, target: document.documentElement });
installScrollbarAutoHide(document);

function Review() {
  const [page, setPage] = useState<AppPage>("chat");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [palette, setPalette] = useState<"default" | "reading" | "custom">("default");
  const [wallpaper, setWallpaper] = useState(false);
  const [transparency, setTransparency] = useState(0);
  const [layout, setLayout] = useState<ChatLayout>("narrow");
  const [thinking, setThinking] = useState<ThinkingSettings>();
  const [searchMode, setSearchMode] = useState<SearchMode>("off");
  const navigation = useConversationNavigation();
  const workspace = useConversationWorkspace(repository, null, emptyModelIds, () => false);
  useEffect(() => {
    applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: theme,
      colorPreset: palette === "reading" ? "reading" : "default",
      userBubbleColor: palette === "custom" ? "#18364a" : null,
      assistantBubbleColor: palette === "custom" ? theme === "light" ? "#e9cfaa" : "#443d32" : null,
      sidebarTransparency: transparency, composerTransparency: transparency, assistantBubbleTransparency: transparency, backgroundMask: 25 }), setItem: () => {} },
    systemPrefersDark: false, target: document.documentElement });
    if (wallpaper) document.documentElement.setAttribute("data-has-background", "true");
  }, [theme, palette, transparency, wallpaper]);

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
  const preview = <section className="chat108-preview-page"><h2>外观设置 · 真实预览组件</h2><p>工具栏的主题、透明度与合成背景同时应用于此预览。返回聊天检查真实交互。</p>
    <AppearanceChatPreview url={wallpaper ? wallpaperUrl : null} focus={null} fit="cover" mask={25} blur={0} /></section>;
  return <><AppShell activePage={page} onPageChange={setPage}
    background={wallpaper ? <BackgroundImage url={wallpaperUrl} focus={null} fit="cover" blur={0} /> : undefined}>
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
        onReadAttachment={readImage} messages={workspace.view.messages} isHydrated={workspace.isReady} isGenerating={false}
        error={workspace.view.error ?? workspace.operationError ?? workspace.loadError}
        protocolLabel="本地合成回复" modelLabel="合成预览" onDraftChange={workspace.setDraft} onDraftActivate={navigation.activateDraft}
        onClear={() => void clear()} onSend={() => void send()} onStop={() => {}} />
    </ConversationNavigation> : page === "settings" ? preview : <section className="chat108-preview-page"><h2>页面切换检查</h2><p>此夹具只预览聊天。返回聊天可检查导航状态是否保留。</p></section>}
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
    <label>合成背景<select aria-label="夹具背景" value={wallpaper ? "complex" : "none"} onChange={event => setWallpaper(event.currentTarget.value === "complex")}><option value="none">纯色</option><option value="complex">复杂构图</option></select></label>
    <label>透明度 {transparency}%<input aria-label="夹具统一透明度" type="range" min="0" max="100" step="5" value={transparency} onChange={event => setTransparency(Number(event.currentTarget.value))} /></label>
    <label>聊天宽度<select aria-label="夹具聊天宽度" value={layout} onChange={event => setLayout(event.currentTarget.value as ChatLayout)}><option value="narrow">窄屏</option><option value="wide">宽屏</option></select></label>
    <button className="settings-button" type="button" onClick={() => setPage(page === "settings" ? "chat" : "settings")}>{page === "settings" ? "返回真实聊天" : "查看外观预览"}</button>
    <button className="settings-button" disabled={!workspace.isReady} type="button" onClick={() => void saveMessages(seedMessages())}>恢复当前会话示例</button>
    <p>独立合成数据；发送只插入固定回复。编辑、删除、分支和版本切换会写入此预览库。</p>
  </div></details></>;
}
createRoot(document.getElementById("root")!).render(<Review />);
