import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte({ hot: false, compilerOptions: { generate: "dom" } })],
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: {
    conditions: ["browser"],
    alias: {
      obsidian: path.resolve(import.meta.dirname, "./tests/mocks/obsidian.ts"),
    },
  },
});
