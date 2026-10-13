import { useState } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { brandAvatars, materializeBrandAvatar } from "../../src/avatar/brandCatalog";
import { decodeAvatar } from "../../src/avatar/image";
import type { UserAvatar } from "../../src/avatar/repository";
import { AssistantAvatarEditor } from "../../src/ui/chat/AssistantAvatarEditor";
import { AssistantAvatar } from "../../src/ui/chat/AssistantAvatar";
import { applyInitialAppearance, defaultAppearancePreferences } from "../../src/appearance/appearance";
import "../../src/App.css";

function setTheme(dark: boolean) {
  applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: dark ? "dark" : "light" }), setItem: () => {} }, systemPrefersDark: false, target: document.documentElement });
}
setTheme(false);

async function verify() {
  let fetchBlocked = false;
  try { await fetch(brandAvatars.find(brand => brand.id === "doubao")!.src!); }
  catch { fetchBlocked = true; }
  if (!fetchBlocked) throw new Error("验收源未阻止同源 fetch");
  for (const brand of brandAvatars) {
    const snapshot = await materializeBrandAvatar(brand.id);
    const image = await decodeAvatar(snapshot.thumbnail);
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, 256, 256).data;
    if (pixels[3] !== 0 || !pixels.some((value, index) => index % 4 === 3 && value > 0))
      throw new Error(`${brand.label} 未保存透明图案`);
  }
  return "通过：同源 fetch 被阻止，11/11 内置头像仍保存真实透明图案";
}

function App() {
  const [avatar, setAvatar] = useState<UserAvatar>();
  const [dark, setDark] = useState(false);
  const [status, setStatus] = useState("等待验证");
  const [busy, setBusy] = useState(false);
  return <main style={{ padding: 24, color: "rgb(var(--color-text))", minHeight: "100dvh" }}>
    <h1>内置头像 CSP 验收</h1><p>内存草稿与隔离头像库，无生产数据或服务商请求。</p>
    <button className="settings-button" onClick={() => { setTheme(!dark); setDark(!dark); }}>切换主题</button>
    <button className="settings-button" disabled={busy} onClick={async () => {
      setBusy(true); try { setStatus(await verify()); } catch (error) { setStatus(String(error)); } finally { setBusy(false); }
    }}>验证 CSP 与全部内置快照</button>
    <p role="status">{status}</p>
    <AssistantAvatarEditor assistantName="豆包" assistantId="synthetic-doubao" value={avatar} onChange={setAvatar} onDefaultChange={() => {}} />
    <p>应用后的助手头像</p><AssistantAvatar assistantName="豆包" assistantId="synthetic-doubao" avatar={avatar} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);

if (isTauri() && new URL(location.href).searchParams.has("native")) {
  void (async () => {
    let result = "passed";
    try { await verify(); } catch (error) { result = `failed:${String(error)}`; }
    // Report through img-src without weakening production connect-src.
    const receipt = new Image();
    await new Promise<void>(resolve => { receipt.onload = receipt.onerror = () => resolve(); receipt.src = `/avatar-csp-report?result=${encodeURIComponent(result)}`; });
    await getCurrentWindow().destroy();
  })();
}
