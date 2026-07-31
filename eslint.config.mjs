import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        ...globals.browser,
        // Svelte 5 runes. Compiler-provided, so they are undeclared as far as
        // eslint is concerned; only `.svelte.ts` modules may use them.
        $state: "readonly",
        $derived: "readonly",
        $effect: "readonly",
        $props: "readonly",
      },
    },
    rules: {
      "obsidianmd/sample-names": "off",
      "obsidianmd/no-sample-code": "off",
      "require-await": "error",
    },
  },
  {
    ignores: ["node_modules/**", "main.js", "tests/**", "*.config.*"],
  },
]);
