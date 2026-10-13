import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({ cacheDir: ".edit128.local/vite-cache", plugins: [react(), tailwindcss(), {
  name: "edit128-isolation", enforce: "pre",
  resolveId(source, importer) {
    if (!importer?.replaceAll("\\", "/").endsWith("/src/chat/useChatSession.ts")) return;
    const targets: Record<string, string> = { "./repository": "./repository.ts", "./attachmentResources": "./files.ts", "./runtime": "./runtime.ts" };
    if (targets[source]) return fileURLToPath(new URL(targets[source], import.meta.url));
  },
}], server: { host: "127.0.0.1", port: 1528, strictPort: true, hmr: false, watch: null } });
