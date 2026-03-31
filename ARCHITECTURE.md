# minimalist-kanban

Minimalist markdown-backed Kanban boards for Obsidian.

Cards are stored as standard Markdown list items under `## ` headings, so boards remain readable and editable as plain text. The plugin registers a custom view type that renders the Markdown as a drag-and-drop board UI.

## Architecture

```
Obsidian loads the plugin
 └─ main.ts (Plugin subclass)
     ├─ Registers KanbanView for the "kanban-board" view type
     ├─ Patches WorkspaceLeaf.setViewState to auto-redirect .md files
     │   that have `kanban-plugin: board` frontmatter
     └─ Registers settings tab and commands

When a kanban file is opened:
 WorkspaceLeaf → KanbanView (extends TextFileView)
   ├─ setViewData()  → parser.ts parseBoard()  → Board data model
   ├─ getViewData()  → parser.ts serializeBoard() → Markdown string
   └─ renderBoard()  → mounts Board.svelte
        ├─ Board.svelte  – manages lanes array, lane-level Sortable, events
        │   └─ Lane.svelte (×N)  – item-level Sortable, add/edit cards
        │       └─ Item.svelte (×N)  – inline edit, checkbox toggle, context menu
        └─ sortable.ts – indirection layer for SortableJS (testability)
```

Data flows one way: user action → Svelte event dispatch → Board handler → mutate `board` → `save()` → `onChange` callback → `KanbanView.requestSave()` → `TextFileView` writes Markdown to disk.

### Frontmatter convention

A file is treated as a kanban board when its YAML frontmatter contains:

```yaml
---
kanban-plugin: board
---
```

The plugin intercepts `setViewState` on all workspace leaves so that opening such a file automatically uses the kanban view instead of the default Markdown editor.

## File overview

### Source (`src/`)

| File | Purpose |
|---|---|
| `main.ts` | Plugin entry point. Registers view, commands ("Create new Kanban board", "Toggle Kanban/Markdown view"), settings tab, and the `setViewState` monkey-patch for auto-redirect. |
| `KanbanView.ts` | `TextFileView` subclass. Bridges Obsidian's file I/O with the Svelte component tree. Calls `parseBoard`/`serializeBoard` and mounts `Board.svelte`. |
| `parser.ts` | Pure-function Markdown ↔ Board serialization. Parses `## ` headings as lanes, `- ` items as cards (with optional `[ ]`/`[x]` checkboxes), supports multi-line card text (indented continuation), and a `---`-delimited archive section. |
| `types.ts` | TypeScript interfaces: `Board`, `Lane`, `Item`, plus `generateId()`. |
| `settings.ts` | `KBSettings` interface, defaults, and `PluginSettingTab` implementation. Three settings: show checkboxes, enter-key behavior, prepend new cards. |
| `sortable.ts` | Thin wrapper (`getSortable()`) that returns either the real SortableJS constructor or a test mock injected via `globalThis.__TEST_SORTABLE__`. |
| `Board.svelte` | Top-level Svelte component. Owns the `board` data, creates a lane-level SortableJS instance for drag-reordering lanes, and dispatches `onChange` to persist changes. Handles all lane/item events and the card context menu (edit, duplicate, move, archive, delete, new note from card). |
| `Lane.svelte` | Renders a single lane: title (inline-editable), item list, and a footer textarea for adding cards. Creates an item-level SortableJS instance with `group: "kb-items"` for cross-lane drag-and-drop. Undoes SortableJS DOM mutations in `onEnd` so Svelte stays in control of the DOM. |
| `Item.svelte` | Renders a single card. Inline title editing, optional checkbox, and a three-dot context menu button. |
| `svelte-shims.d.ts` | Ambient type declarations so TypeScript accepts `.svelte` imports. |

### Build & config

| File | Purpose |
|---|---|
| `esbuild.config.mjs` | Build script using esbuild + `esbuild-svelte`. Bundles `src/main.ts` → `main.js` (CJS, es2018 target). Externalizes `obsidian`, `electron`, CodeMirror, and Node builtins. |
| `manifest.json` | Obsidian plugin manifest. |
| `styles.css` | Plugin stylesheet, loaded by Obsidian automatically. |
| `tsconfig.json` | TypeScript configuration. |
| `package.json` | Dependencies and scripts. |

### Tests (`tests/`)

| File | Purpose |
|---|---|
| `setup.ts` | Vitest setup: loads `@testing-library/jest-dom` matchers, injects `SortableMock` via `globalThis.__TEST_SORTABLE__`, resets mock state between tests. |
| `parser.test.ts` | 22 tests for `parseBoard` and `serializeBoard`: frontmatter, lanes, items, checkboxes, multi-line cards, archive, round-trip fidelity. |
| `item.test.ts` | 14 tests for `Item.svelte`: rendering, inline editing, keyboard handling, checkbox toggle, enter/shift+enter behavior with settings. |
| `lane.test.ts` | 18 tests for `Lane.svelte`: rendering, adding items, lane title editing, context menu, SortableJS initialization and configuration. |
| `board.test.ts` | 23 tests for `Board.svelte`: adding lanes/items, deleting, renaming, moving lanes, card context menu actions (duplicate, move to top/bottom, move to list, archive), drag-and-drop via SortableJS `onEnd` simulation, new note from card. |
| `mocks/obsidian.ts` | Mock for the `obsidian` module. Provides `Menu`, `MenuItem`, `Platform`, `TFile`, and stubbed workspace/vault/fileManager objects. |
| `mocks/sortablejs.ts` | Mock for SortableJS. Records constructor calls in a static `instances` array so tests can inspect options and simulate `onEnd` callbacks. |

### Vitest configuration (`vitest.config.mts`)

| Setting | Why |
|---|---|
| `@sveltejs/vite-plugin-svelte` with `generate: "dom"` | Compile Svelte components for DOM (not SSR) so lifecycle hooks like `onMount` actually execute. |
| `resolve.conditions: ["browser"]` | Forces Vite to resolve the `svelte` package's `"browser"` export condition, which gives the real DOM runtime. Without this, Svelte's default export is the SSR runtime where `onMount` is a no-op. |
| `resolve.alias: { obsidian → tests/mocks/obsidian.ts }` | Redirects all `import ... from "obsidian"` to the mock, since the real Obsidian API isn't available outside the app. |
| `environment: "jsdom"` | Provides `document`, `window`, etc. for Svelte DOM rendering. |
| `setupFiles: ["./tests/setup.ts"]` | Registers jest-dom matchers and injects the SortableJS mock before each test file. |

## Design constraints

1. **Markdown is the source of truth.** The board is serialized to/from plain Markdown via `parser.ts`. No proprietary JSON blobs — the file is readable in any text editor.

2. **SortableJS owns drag-and-drop, Svelte owns the DOM.** SortableJS mutates the DOM during drags. The `onEnd` handler in `Lane.svelte` reverses those mutations, then updates the Svelte data model, which triggers a clean re-render. This avoids DOM state desynchronization.

3. **No runtime dependencies on Obsidian in tests.** The `obsidian` module is aliased to a mock at the Vite config level. The `sortablejs` mock is injected via `globalThis` and a thin wrapper (`sortable.ts`).

4. **Svelte 4 with plain JS in components.** `.svelte` files use plain JavaScript `<script>` blocks (no `lang="ts"`), keeping the Svelte compiler path simple. TypeScript is used in all `.ts` files.

5. **Single-file bundle.** esbuild produces one `main.js` file with CSS injected inline by the Svelte compiler (`css: "injected"`). No separate CSS extraction step.

## Libraries

| Library | Why |
|---|---|
| **Svelte 4** | Lightweight, compiles to vanilla JS with no runtime framework overhead. Good fit for an Obsidian plugin where bundle size matters. |
| **SortableJS** | Battle-tested drag-and-drop library that handles touch devices, animation, and cross-list moves. The only runtime dependency. |
| **esbuild + esbuild-svelte** | Fast bundler. Matches the Obsidian plugin ecosystem's standard build toolchain. |
| **Vitest** | Fast, Vite-native test runner. Shares the same Svelte/Vite transform pipeline used by the project. |
| **@testing-library/svelte v4** | Component testing utilities matched to Svelte 4. Renders components into jsdom and provides `fireEvent`/`waitFor` helpers. |
| **jsdom** | DOM implementation for Node.js, required by @testing-library. |

## Running tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a specific test file
npx vitest run tests/parser.test.ts
```

The test suite has 77 tests across 4 files (parser, item, lane, board). All tests run in jsdom with mocked Obsidian API and SortableJS.

### E2E tests

E2E tests drive a live Obsidian instance via the [Obsidian CLI](https://obsidian.md/help/Extending+Obsidian/Obsidian+CLI) (requires Obsidian 1.12+). They verify that the plugin loads, renders boards, and round-trips file content inside the real app.

**One-time setup:**

```bash
# Build the plugin and create the test vault with a symlinked plugin
./tests/e2e/setup.sh

# Open the test vault in Obsidian (vault switcher → Open folder as vault)
# Point it to: tests/e2e/vault/

# Disable restricted mode and enable the "Minimalist Kanban" plugin, or via CLI:
obsidian vault="<vault-name>" plugins:restrict off
obsidian vault="<vault-name>" plugin:enable id=minimalist-kanban
```

**Running:**

```bash
# Obsidian must be running with the test vault open
npm run test:e2e
```

The e2e tests use `npx tsx` to run a plain Node script that calls the Obsidian CLI via `child_process.execSync`. Each CLI call takes ~400ms; the full suite runs in about 4 seconds. The test vault name defaults to `kb-test-plugin-vault` and can be overridden with the `OBSIDIAN_E2E_VAULT` environment variable.

## Building the plugin

```bash
# Development build (with watch mode and inline source maps)
npm run dev

# Production build (minified, no source maps)
npm run build
```

Both produce `main.js` in the project root.

## Installing in Obsidian

To try the plugin locally in Obsidian, follow the [Obsidian plugin development guide](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin):

1. Build the plugin: `npm run build`
2. Create a folder in your vault's `.obsidian/plugins/` directory named `minimalist-kanban`
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder
4. In Obsidian, go to Settings → Community plugins → enable "Minimalist Kanban"
5. Use the command palette: "Create new Kanban board"
