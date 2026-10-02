import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  cacheDir: ".chat108.local/vite-cache",
  plugins: [
    {
      name: "chat108-isolate-avatar-library",
      enforce: "pre",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/avatar/library.ts")) return;
        const singleton = "export const avatarLibrary = createAvatarLibraryRepository();";
        if (!code.includes(singleton)) throw new Error("Avatar library isolation seam changed; review the chat108 fixture before running.");
        return code.replace(singleton, 'export const avatarLibrary = createAvatarLibraryRepository("Chat108Synthetic");');
      },
    },
    react(), tailwindcss(),
  ],
  server: { host: "127.0.0.1", port: 1518, strictPort: true, hmr: false, watch: null },
  build: { outDir: ".chat108.local/dist", rollupOptions: { input: "scripts/chat108/index.html" } },
});
