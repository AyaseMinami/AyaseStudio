import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

export default defineConfig({
  cacheDir: fileURLToPath(new URL("../../.update76.local/vite-cache", import.meta.url)),
  plugins: [react(), tailwindcss(), { name: "isolated-native-update-probe", configureServer(server) {
    server.middlewares.use("/native-probe-result", (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
      let body = "";
      req.on("data", chunk => { if (body.length < 4096) body += String(chunk); });
      req.on("end", () => {
        void (async () => {
          try {
            const result = JSON.parse(body);
            const directory = fileURLToPath(new URL("../../.update76.local/", import.meta.url));
            await mkdir(directory, { recursive: true });
            await writeFile(`${directory}/native-probe.json`, JSON.stringify({ ok: result.ok === true, status: result.status }));
            res.end("ok");
          } catch { res.statusCode = 400; res.end(); }
        })();
      });
    });
  } }],
  resolve: { alias: [
    { find: /(?:\.\.\/)+chat\/externalLinks$/, replacement: fileURLToPath(new URL("./externalLinks.ts", import.meta.url)) },
  ] },
  server: { host: "127.0.0.1", port: 1521, strictPort: true },
});
