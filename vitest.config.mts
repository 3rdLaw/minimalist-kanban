import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  // vite-plugin-svelte 7 owns `compilerOptions.generate`, and `hot` is no
  // longer a valid option — both were rejected as invalid config when passed.
  plugins: [svelte()],
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
  resolve: {
    conditions: ["browser"],
    alias: {
      obsidian: path.resolve(import.meta.dirname, "./tests/mocks/obsidian.ts"),
    },
  },
});
