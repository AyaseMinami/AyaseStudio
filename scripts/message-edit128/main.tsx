import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useChatSession } from "../../src/chat/useChatSession";
import { ChatWorkspace } from "../../src/ui/chat/ChatWorkspace";
import { saveConnectionSettings } from "../../src/chat/settings";
import { createChatRepository } from "./repository";
import { assets, fixture, seed, textFile, rememberAssets } from "./files";
import { base64ToBytes, bytesToBase64 } from "../../src/chat/attachments";
import "../../src/App.css";

const repository = createChatRepository();
saveConnectionSettings({ version: 3, activeModelId: "synthetic-model", builtinsInitialized: true, providers: [{ id: "synthetic", name: "隔离服务", connections: [{
  id: "local", name: "模拟连接", protocol: "openai-chat", baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "synthetic-model", modelId: "synthetic-model" }],
}] }] });
await repository.initializeWorkspace("synthetic-model", ["synthetic-model"]);
const existing = (await repository.load("current"))?.messages ?? [];
// Recreate known synthetic originals when a new tab has no fixture session cache.
for (const item of existing.flatMap(message => message.attachments ?? [])) if (!assets.has(item.reference)) {
  let data: string | undefined;
  if (item.name === "合成图片.png") {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d")!; context.fillStyle = "#b4d5de"; context.fillRect(0, 0, 640, 360);
    context.fillStyle = "#324764"; context.font = "36px sans-serif"; context.fillText("#128 Synthetic Image", 100, 185);
    data = canvas.toDataURL("image/png").split(",")[1];
  } else if (item.name === "很长的附件文件名用于验证窄窗口换行以及完整名称提示-原始记录.txt") data = bytesToBase64(new TextEncoder().encode("original text"));
  if (data) assets.set(item.reference, { name: item.name, mimeType: item.mimeType, size: atob(data).length, data });
}
rememberAssets();
if (!(await repository.load("current"))?.messages.length) {
  const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#b4d5de"; context.fillRect(0, 0, 640, 360); context.fillStyle = "#324764"; context.font = "36px sans-serif"; context.fillText("#128 Synthetic Image", 100, 185);
  const image = seed("合成图片.png", canvas.toDataURL("image/png").split(",")[1], "image/png");
  const text = textFile("很长的附件文件名用于验证窄窗口换行以及完整名称提示-原始记录.txt", "original text");
  await repository.save({ id: "current", updatedAt: 1, messages: [
    { id: "user128", role: "user", content: "用户原始正文。附件草稿与底部输入独立。", status: "complete", attachments: [image, text] },
    { id: "assistant128", role: "assistant", replyToId: "user128", content: "助手可以编辑正文；保留原附件预览。", status: "complete", attachments: [text] },
  ] });
}
// This fixture owns a separate database/origin and synthetic in-memory resources only.
function Acceptance() {
  const chat = useChatSession({ onConfigurationRequired: () => undefined });
  const [dark, setDark] = useState(false), [, render] = useState(0);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "rgb(var(--color-canvas))", color: "rgb(var(--color-text))", overflow: "hidden" }}>
    <div style={{ padding: 8, display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0, fontSize: 12 }}>
      <button onClick={() => setDark(!dark)}>切换浅深主题</button>
      <button onClick={() => { fixture.failSave = !fixture.failSave; render(v => v + 1); }}>模拟保存失败：{fixture.failSave ? "开启" : "关闭"}</button>
      <button onClick={() => { fixture.failProvider = !fixture.failProvider; render(v => v + 1); }}>模拟供应商失败：{fixture.failProvider ? "开启" : "关闭"}</button>
      <span data-testid="fixture-facts">#128 隔离 · provider模拟调用 {fixture.requests} · 合成文件 {assets.size}</span>
      <button onClick={() => {
        const editor = document.querySelector(".message-editor");
        if (!editor) return;
        const transfer = new DataTransfer(); transfer.items.add(new File(["synthetic first"], "同名新增文件.txt")); transfer.items.add(new File(["synthetic second"], "同名新增文件.txt"));
        editor.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }}>模拟投放两份同名文件</button>
      <button onClick={() => {
        const textarea = document.querySelector(".message-editor textarea"); const image = [...assets.values()].find(item => item.mimeType === "image/png");
        if (!textarea || !image) return;
        const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(base64ToBytes(image.data)).buffer], "image.png", { type: "image/png" }));
        textarea.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      }}>模拟图片粘贴</button>
      {chat.workspace.loadError && <button onClick={chat.workspace.retry}>重新加载并核对</button>}
    </div>
    <ChatWorkspace hideHeader title="#128 合成对话" draft={chat.draft} onDraftChange={chat.setDraft} draftAttachments={chat.draftAttachments}
      attachmentBusy={chat.attachmentBusy} isHydrated={chat.isHydrated} isGenerating={chat.isGenerating} isWorkspaceBusy={chat.workspace.busy}
      messages={chat.messages} protocol="openai-chat" protocolLabel="完全模拟 · 零联网" onClear={chat.clearConversation}
      onFiles={chat.addFiles} onRemoveAttachment={chat.removeDraftAttachment} onReadAttachment={chat.readAttachment} error={chat.error}
      onSend={chat.sendMessage} onStop={chat.stopGeneration} messageActionsDisabled={!chat.isHydrated || chat.isGenerating}
      messageActions={{ edit: chat.editMessage, editAndSend: chat.editAndSendMessage, delete: chat.deleteMessage, retry: chat.retryMessage,
        branch: chat.branchMessage, selectVersion: chat.selectRoundVersion }} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Acceptance />);
