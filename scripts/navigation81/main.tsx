import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import { AppShell, type AppPage } from "../../src/ui/AppShell";
import { ConversationNavigation } from "../../src/ui/chat/ConversationNavigation";
import { useConversationNavigation } from "../../src/ui/chat/useConversationNavigation";
import { ChatWorkspace } from "../../src/ui/chat/ChatWorkspace";
import { ChatHeader } from "../../src/ui/chat/ChatHeader";
import { useConversationWorkspace } from "../../src/chat/useConversationWorkspace";
import { createChatRepository } from "../../src/chat/repository";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";
import { applyInitialAppearance, defaultAppearancePreferences, type AppearancePreferences } from "../../src/appearance/appearance";

function applyAppearancePreferences(preferences: AppearancePreferences) {
  applyInitialAppearance({ storage: { getItem: () => JSON.stringify(preferences), setItem: () => {} }, systemPrefersDark: false, target: document.documentElement });
}

const repository = createChatRepository("Navigation81Synthetic");
const initial = await repository.initializeWorkspace(null, []);
if (initial.assistants.length === 1) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#34596f"; context.fillRect(0, 0, 64, 64);
  context.fillStyle = "#e4b678"; context.fillRect(10, 10, 44, 44);
  const thumbnail = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
  const imageAvatar = { original: thumbnail, thumbnail, crop: { x: 0.5, y: 0.5, zoom: 1 } };
  const names = ["写作助手", "👩🏽‍💻 开发助手", "Research", "写作助手（长名称与同首字测试）", ...Array.from({ length: 12 }, (_, i) => `样例助手 ${i + 1}`)];
  for (const [index, name] of names.entries()) {
    await repository.execute({ type: "create-assistant", id: `synthetic-${index}`, input: { name, icon: "", avatar: index === 1 ? imageAvatar : undefined, defaultModelId: null, defaultConfig: defaultSessionConfig() } });
    for (let c = 0; c < (index === 0 ? 24 : 2); c++) await repository.execute({ type: "create-conversation", id: `synthetic-${index}-c${c}`, assistantId: `synthetic-${index}` });
  }
  await repository.save({ id: "synthetic-0-c0", updatedAt: Date.now(), messages: [
    { id: "u", role: "user", content: "这是一条隔离的合成消息。", status: "complete" },
    { id: "a", role: "assistant", content: "# 输入与阅读\n\n点击头像展开助手列表，再点击正文、空白或输入工具区收缩为头像列。\n\n普通失焦、键盘聚焦和滚动保持导航状态。开发助手使用合成图片供切换回归检查。\n\n" + "合成阅读内容。\n\n".repeat(15), status: "complete" },
  ] });
  await repository.execute({ type: "select", assistantId: "synthetic-0", conversationId: "synthetic-0-c0" });
}
applyAppearancePreferences(defaultAppearancePreferences);
function Review() {
  const [page, setPage] = useState<AppPage>("chat");
  const [theme, setTheme] = useState(false);
  const [background, setBackground] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const navigation = useConversationNavigation();
  const workspace = useConversationWorkspace(repository, null, [], () => generating);
  return <><AppShell activePage={page} onPageChange={setPage} background={background ? <div style={{ height: "100%", background: "linear-gradient(125deg,#34596f,#b39371,#416169)" }} /> : undefined}>
    {page === "chat" ? <ConversationNavigation workspace={workspace} settings={{ version: 3, providers: [], activeModelId: null }} generatingIds={generating && workspace.conversation ? new Set([workspace.conversation.id]) : new Set()} navigation={navigation}
      toolbar={<ChatHeader conversationId={workspace.conversation?.id} title="合成体验" isHydrated={workspace.isReady} isWorkspaceBusy={workspace.isTemporarilyBusy} isGenerating={generating} onClear={() => {}} />}>
      <ChatWorkspace key={workspace.conversation?.id ?? "loading"} hideHeader assistant={workspace.assistant} title="合成体验" draft={workspace.view.draft} draftSelection={workspace.view.draftSelection}
        modelPicker={{ settings: { version: 3, providers: [], activeModelId: null }, selectedModelId: null, disabled: !workspace.isReady, onSelect: async () => true }}
        isWorkspaceBusy={workspace.isTemporarilyBusy} protocol="openai-chat" onThinkingChange={() => {}} onSearchModeChange={() => {}}
        messageActionsDisabled={!workspace.isReady || generating}
        messageActions={{ edit: async () => false, editAndSend: async () => false, delete: async () => false, retry: async () => {}, branch: async () => false }}
        onDraftSelectionChange={workspace.setDraftSelection} messages={workspace.view.messages} isHydrated={workspace.isReady} isGenerating={generating}
        protocolLabel="隔离数据 · 无供应商请求" onDraftChange={workspace.setDraft} onDraftActivate={navigation.activateDraft} onClear={() => {}}
        onSend={() => {}} onStop={() => setGenerating(false)} />
    </ConversationNavigation> : <section className="settings-page"><h2>隔离页面切换</h2><p>返回聊天检查运行中导航状态。此入口不加载真实设置或凭据。</p></section>}
  </AppShell><div style={{ position: "fixed", right: 8, top: 4, zIndex: 45, display: "flex", gap: 4 }}>
    <button className="settings-button" onClick={() => { setTheme(!theme); applyAppearancePreferences({ ...defaultAppearancePreferences, themeMode: theme ? "light" : "dark", sidebarTransparency: transparent ? 45 : 0 }); }}>主题</button>
    <button className="settings-button" onClick={() => setBackground(!background)}>合成背景</button>
    <button className="settings-button" onClick={() => { setTransparent(!transparent); applyAppearancePreferences({ ...defaultAppearancePreferences, themeMode: theme ? "dark" : "light", sidebarTransparency: transparent ? 0 : 45 }); }}>透明度</button>
    <button className="settings-button" onClick={() => setGenerating(!generating)}>模拟生成</button>
  </div></>;
}
createRoot(document.getElementById("root")!).render(<Review />);
