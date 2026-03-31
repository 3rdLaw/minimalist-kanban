# Minimalist Kanban

A lightweight Kanban board plugin for [Obsidian](https://obsidian.md). Boards are stored as plain Markdown files — no proprietary formats, no JSON blobs. Your data stays readable and editable as standard Markdown.

Inspired by the [Kanban](https://github.com/mgmeyers/obsidian-kanban) plugin. Minimalist Kanban aims to be a simpler, smaller alternative that covers the core workflow: lists, cards, drag-and-drop, and nothing else.

## What it looks like

A board file is just Markdown with `## ` headings as lists and `- [ ]` items as cards:

```markdown
---
kanban-plugin: board
---

## To Do
- [ ] Buy groceries
- [ ] Write documentation

## In Progress
- [ ] Build the thing

## Done
- [x] Set up project
```

The plugin renders this as a drag-and-drop board. Every change writes back to the same Markdown file.

## Creating a board

Open the command palette (`Ctrl/Cmd + P`) and run **Create new Kanban board**. This creates a new Markdown file with the required frontmatter and three starter lists.

You can also create a board manually — any `.md` file with this frontmatter will be opened as a board:

```yaml
---
kanban-plugin: board
---
```

## Features

- **Drag-and-drop** cards between lists, and reorder lists by dragging the grip handle
- **Inline editing** — click a card to edit its text
- **Multi-line cards** — use Shift+Enter to add line breaks within a card (configurable)
- **Wikilinks and Markdown links** render as clickable links in card titles
- **Ctrl/Cmd+Click** a link in a card to open it in a new tab
- **Toggle view** — switch between the Kanban board and the raw Markdown editor (`Ctrl/Cmd + P` → **Toggle Kanban/Markdown view**)
- **Card context menu** — right-click or tap the `⋮` button on a card to duplicate, move, archive, or delete it
- **Create notes from cards** — turn a card into a linked note via the context menu
- **Archive** — archive cards to move them out of the board without deleting them
- **Checkboxes** — cards are stored with `- [ ]`/`- [x]` syntax, compatible with Obsidian Tasks and Dataview. Optionally display checkboxes in the UI via Settings.
- **Mobile support** — touch-friendly drag-and-drop and always-visible menu buttons

## Migrating from the Kanban plugin

Minimalist Kanban reads the same `kanban-plugin: board` frontmatter and Markdown format as the [Kanban](https://github.com/mgmeyers/obsidian-kanban) plugin. To migrate:

1. Disable the Kanban plugin
2. Enable Minimalist Kanban
3. Open your existing board files — they should render automatically

A few things to note:
- Old plugin metadata blocks (`%% kanban:settings %%`) are preserved in the file but ignored. They will be removed if you edit and save the board.
- Date/time card metadata and lane-level settings are not supported and will be dropped on save.
- All cards are stored with checkbox syntax (`- [ ]`/`- [x]`) for compatibility with Obsidian Tasks.

## Settings

| Setting | Default | Description |
|---|---|---|
| Show checkboxes | Off | Display checkboxes on cards in the board UI |
| Enter key adds new line | Off | When on, Enter adds a new line and Shift+Enter submits. When off, the behavior is reversed. |
| Prepend new cards | Off | Add new cards to the top of the list instead of the bottom |

## Building from source

```bash
npm install
npm run build     # Production build → main.js
npm run dev       # Watch mode with source maps
npm test          # Run unit tests (80 tests)
npm run test:e2e  # Run e2e tests (requires Obsidian 1.12+ with CLI)
```

## License

[MIT](LICENSE)
