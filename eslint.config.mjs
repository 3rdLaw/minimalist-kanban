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
    files: ["src/LinkSuggest.ts"],
    rules: {
      // The rule asks for `doc.win.createDiv()` in place of
      // `doc.createElement("div")`. That does not type-check: Obsidian declares
      // `createDiv` as a bare global function, not a member of `Window`, so
      // obsidian.d.ts rejects it with "Property 'createDiv' does not exist on
      // type 'Window'" — and typescript-eslint then reports every use of the
      // result as unsafe. Tried it; 4 svelte-check errors and 20 lint errors.
      //
      // The rule's purpose is pop-out window correctness, which this module
      // already handles by stricter means: elements come from
      // `textarea.ownerDocument` and are measured against `doc.defaultView`,
      // never the module-load-time `document`/`window`. The "LinkSuggest in a
      // secondary window" suite asserts that, down to `popup.ownerDocument`.
      //
      // Turned off here rather than inline because the recommended config's
      // `eslint-comments/no-restricted-disable` forbids inline suppression of
      // obsidianmd rules.
      "obsidianmd/prefer-create-el": "off",
    },
  },
  {
    files: ["src/settings.ts"],
    rules: {
      // Adopting `getSettingDefinitions()` is a real improvement -- it makes
      // the four toggles appear in Obsidian's settings search -- but the API
      // is `@since 1.13.0` and manifest.json declares
      // `minAppVersion: 1.1.13`. Taking it means requiring 1.13.0, which is
      // newer than the Obsidian this is developed against (1.12.7), so it
      // cannot even be exercised here yet.
      //
      // It is also not a drop-in. `setControlValue` defaults to persisting
      // `plugin.settings`, whereas this plugin's `saveSettings()` also walks
      // open leaves and calls `KanbanView.onSettingsChanged()` so live boards
      // re-render. Adopting the API without overriding `setControlValue`
      // would silently break that.
      //
      // Revisit together with a minAppVersion bump; see the note in
      // PUBLISHING.md.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    ignores: ["node_modules/**", "main.js", "tests/**", "*.config.*"],
  },
]);
