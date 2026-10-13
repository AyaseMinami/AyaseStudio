import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageList } from "../../src/ui/chat/MessageList";
import type { StoredChatMessage } from "../../src/chat/repository";
import type { RequestAttachment, SentAttachment } from "../../src/chat/attachments";
import "../../src/App.css";

function picture(name: string, width: number, height: number): RequestAttachment & SentAttachment {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#edf4fb"; ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += 200) for (let x = 0; x < width; x += 200) {
    ctx.fillStyle = (x + y) % 400 ? "#bfd8ed" : "#dce8ce"; ctx.fillRect(x + 4, y + 4, 192, 192);
    ctx.fillStyle = "#263d4d"; ctx.font = "26px sans-serif"; ctx.fillText(`${x}, ${y}`, x + 15, y + 45);
  }
  ctx.fillStyle = "#b84b4b"; ctx.font = "44px sans-serif"; ctx.fillText(name, 40, height / 2);
  return { name, mimeType: "image/png", size: 1000, reference: name, data: canvas.toDataURL("image/png").split(",")[1] };
}
const images = [picture("宽图.png", 1600, 1000), picture("长图.png", 800, 1800), picture("小图.png", 120, 80)];
const messages: StoredChatMessage[] = Array.from({ length: 18 }, (_, i) => ({ id: String(i), role: i % 2 ? "assistant" : "user", content: `隔离对话 ${i + 1}。滚动后打开图片，关闭后核对原位置。`, status: "complete", ...(i === 14 ? { attachments: images.map(({ data: _data, ...item }) => item) } : {}) }));
const read = async (item: SentAttachment) => images.find(image => image.reference === item.reference)!;
function Acceptance() {
  const [dark, setDark] = useState(false);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "rgb(var(--color-canvas))", color: "rgb(var(--color-text))" }}>
    <div style={{ padding: 12, flexShrink: 0 }}><button type="button" onClick={() => setDark(!dark)}>切换浅深主题</button> · #124 合成图片，无用户数据或联网请求</div>
    <MessageList messages={messages} onReadAttachment={read} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Acceptance />);
