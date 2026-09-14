import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.live.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
