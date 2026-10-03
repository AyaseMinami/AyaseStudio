import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  cacheDir: ".chat108.local/workbench-cache",
  plugins: [{
    name: "workbench-isolated-avatar-library", enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/avatar/library.ts")) return;
      const singleton = "export const avatarLibrary = createAvatarLibraryRepository();";
      if (!code.includes(singleton)) throw new Error("Review fixture isolation after avatar repository changes.");
      return code.replace(singleton, 'export const avatarLibrary = createAvatarLibraryRepository("WorkbenchMaterialSynthetic");');
    },
  }, react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 1536, strictPort: true, hmr: false, watch: null },
});
