import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({ cacheDir: ".providers100.local/vite-cache", plugins: [react(), tailwindcss()],
  resolve: { alias: [
    { find: /(?:\.\.\/)+avatar\/library$/, replacement: fileURLToPath(new URL("./avatarLibrary.ts", import.meta.url)) },
    { find: /(?:\.\.\/)+avatar\/providerAvatars$/, replacement: fileURLToPath(new URL("./providerAvatars.ts", import.meta.url)) },
  ] }, server: { host: "127.0.0.1", port: 1513, strictPort: true, hmr: false, watch: null } });
