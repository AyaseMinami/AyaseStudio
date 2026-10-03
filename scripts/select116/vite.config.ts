import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  cacheDir: "scripts/select116/.local/vite-cache",
  plugins: [{
    name: "select116-isolated-boundaries", enforce: "pre",
    transform(code, id) {
      const path = id.replaceAll("\\", "/");
      if (path.endsWith("/src/avatar/library.ts")) {
        const singleton = "export const avatarLibrary = createAvatarLibraryRepository();";
        if (!code.includes(singleton)) throw Error("Review avatar isolation seam before running select116.");
        return code.replace(singleton, 'export const avatarLibrary = createAvatarLibraryRepository("Select116Synthetic");');
      }
      if (path.endsWith("/src/search/settings.ts")) {
        const storage = "(storage ?? localStorage)";
        if (!code.includes(storage)) throw Error("Review search storage isolation seam before running select116.");
        return code.replaceAll(storage, "(storage ?? select116Storage)") + `
const select116Values = new Map<string, string>();
const select116Storage = {
  getItem(key: string): string | null {
    if (!select116Values.has(key)) {
      const defaults = defaultSearchConfiguration();
      return JSON.stringify({ ...defaults,
        tavily: { ...defaults.tavily, enabled: true, apiKey: "synthetic-only" },
        zhipu: { ...defaults.zhipu, enabled: true, apiKey: "synthetic-only" } });
    }
    return select116Values.get(key)!;
  },
  setItem(key: string, value: string) { select116Values.set(key, value); }
};`;
      }
      if (path.endsWith("/src/search/runtime.ts")) return `export async function searchExa() {
        return { sources: [{ id: "fixture", title: "隔离搜索结果", url: "https://synthetic.invalid", excerpt: "本页不发送任何搜索请求。" }] };
      }`;
      if (path.endsWith("/src/chat/externalLinks.ts")) return `
        export function safeExternalUrl(value: string) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
        export async function openExternal() { /* All external navigation is suppressed in this fixture. */ }
      `;
    },
  }, react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 1557, strictPort: true, hmr: false, watch: null },
  build: { outDir: "scripts/select116/.local/dist", rollupOptions: { input: "scripts/select116/index.html" } },
});
