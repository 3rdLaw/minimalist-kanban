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
      globals: globals.browser,
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
