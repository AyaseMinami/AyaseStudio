import { useEffect, useState } from "react";
import { brandAvatars, materializeBrandAvatar } from "../../src/avatar/brandCatalog";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../src/avatar/image";
import type { UserAvatar } from "../../src/avatar/repository";
import { AssistantAvatar } from "../../src/ui/chat/AssistantAvatar";
import { AvatarPreview, AvatarSettings } from "../../src/ui/settings/AvatarSettings";
import { BrandAvatar } from "../../src/ui/avatar/BrandAvatar";

async function alphaRange(blob: Blob) {
  const image = await decodeAvatar(blob), canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let min = 255, max = 0;
  for (let index = 3; index < pixels.length; index += 4) { min = Math.min(min, pixels[index]); max = Math.max(max, pixels[index]); }
  const sample = context.getImageData(canvas.width / 2, canvas.height * 3 / 16, 1, 1).data[3];
  return { min, max, corner: pixels[3], sample };
}

export function TransparencyAcceptance() {
  const [snapshots, setSnapshots] = useState<Record<string, UserAvatar>>({});
  const [report, setReport] = useState("尚未运行真实 PNG 透明度检查");
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<UserAvatar>();
  const userAvatar = { value: user, url: undefined, busy: false, error: undefined,
    save: async (value?: UserAvatar) => { setUser(value); return true; } };
  const [userUrl, setUserUrl] = useState<string>();
  useEffect(() => {
    const url = user ? URL.createObjectURL(user.thumbnail) : undefined;
    setUserUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [user]);
  async function verify() {
    setBusy(true);
    try {
      const next: Record<string, UserAvatar> = {};
      for (const brand of brandAvatars) {
        const snapshot = await materializeBrandAvatar(brand.id), alpha = await alphaRange(snapshot.thumbnail);
        if (alpha.min !== 0 || alpha.max !== 255 || alpha.corner !== 0) throw new Error(`${brand.label}: 透明快照检查失败`);
        next[brand.id] = snapshot;
      }
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#da456b"; context.fillRect(16, 16, 32, 32);
      context.fillStyle = "rgba(30, 150, 200, .5)"; context.fillRect(24, 8, 16, 8);
      const original = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("synthetic PNG failed")), "image/png"));
      const thumbnail = await renderAvatar(await decodeAvatar(original), centeredCrop), alpha = await alphaRange(thumbnail);
      if (alpha.min !== 0 || alpha.max !== 255 || alpha.corner !== 0 || alpha.sample !== 128) throw new Error("上传头像裁切未保留 Alpha");
      setUser({ original, thumbnail, crop: centeredCrop }); setSnapshots(next);
      setReport("11/11 内置 PNG 快照及上传头像裁切保留透明通道：通过");
    } catch (error) { setReport(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section aria-label="透明头像验收" style={{ overflow: "auto", padding: 16 }}>
    <style>{".transparency-brand,.transparency-snapshot { width: 64px; height: 64px; }"}</style>
    <button className="settings-button" disabled={busy} onClick={() => void verify()}>检查透明通道与快照</button>
    <p role="status">{report}</p>
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
      {brandAvatars.map(brand => <figure key={brand.id} style={{ margin: 0, display: "grid", justifyItems: "center", gap: 8 }}>
        <BrandAvatar id={brand.id} className="transparency-brand" />
        <AssistantAvatar avatar={snapshots[brand.id]} assistantId={`snapshot-${brand.id}`} className="transparency-snapshot" />
        <figcaption>{brand.label}</figcaption>
      </figure>)}
    </div>
    {user && <><AvatarSettings avatar={{ ...userAvatar, url: userUrl }} onImport={() => {}} /><AvatarPreview avatar={{ ...userAvatar, url: userUrl }} /></>}
  </section>;
}
