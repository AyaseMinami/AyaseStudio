import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({ cacheDir: fileURLToPath(new URL("../../.model-groups119.local/vite-cache", import.meta.url)),
  plugins: [react(), tailwindcss()], resolve: { alias: [
    { find: /(?:\.\.\/)+avatar\/library$/, replacement: fileURLToPath(new URL("./avatarLibrary.ts", import.meta.url)) },
    { find: /(?:\.\.\/)+avatar\/providerAvatars$/, replacement: fileURLToPath(new URL("./providerAvatars.ts", import.meta.url)) },
    { find: /^@tauri-apps\/api\/core$/, replacement: fileURLToPath(new URL("./nativeCore.ts", import.meta.url)) },
    { find: /^@tauri-apps\/plugin-http$/, replacement: fileURLToPath(new URL("./externalHttp.ts", import.meta.url)) },
  ] }, server: { host: "127.0.0.1", port: 1520, strictPort: true } });
