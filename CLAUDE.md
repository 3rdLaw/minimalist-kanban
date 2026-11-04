# Agent guide

Guidance for coding agents working in this repository. `AGENTS.md` is a symlink
to this file. It is deliberately short: the detail lives in the docs below, and
those docs are the source of truth.

Minimalist Kanban is an Obsidian community plugin (Svelte 5 + TypeScript,
bundled with esbuild) that renders Markdown files as Kanban boards. The
Markdown file is the source of truth for every board.

## Read first

- [README.md](README.md): what the plugin does, the board file format, settings.
- [ARCHITECTURE.md](ARCHITECTURE.md): data flow, file overview, and the
  numbered design constraints. Read the constraints before changing how the
  board renders, saves, or reacts to external changes.
- [TESTING.md](TESTING.md): the e2e harness and its flake patterns. Read it
  before touching `tests/e2e/`; several rules are counter-intuitive (the
  `obsidian` CLI reports every error at exit code 0).
- [MOBILE.md](MOBILE.md): Android keyboard and phone layout. Read it before
  changing layout CSS or anything that positions UI on mobile.
- [PUBLISHING.md](PUBLISHING.md): lint expectations, version bump, and release.

## Commands

```bash
npm install
npm run build       # production bundle -> main.js (gitignored)
npm run dev         # watch build with inline source maps
npm test            # vitest unit suite (jsdom, mocked Obsidian + SortableJS)
npm run lint        # eslint src/ + svelte-check (src) + tsc on tests/
npm run test:e2e    # drives a live Obsidian; see below
```

`npm run lint` must finish with zero errors and zero warnings. It is three
checks; run them separately (`npx eslint src/`, `npm run check`,
`npm run check:tests`) to see which one failed. A member added to the Obsidian
mock in `tests/mocks/obsidian.ts` needs a matching declaration in
`tests/obsidian-mock.d.ts` (see TESTING.md, "Typechecking the tests").

### E2E tests

`npm run test:e2e` needs a running Obsidian (1.12+, with its CLI) that has the
committed test vault `tests/e2e/minimalist-kanban-vault/` registered and the
plugin enabled; `tests/e2e/setup.sh` does the build and the symlink. If that
isn't available, say so and don't report the e2e suite as passing.

- Build first. The vault's plugin directory is a symlink to the checkout that
  ran `setup.sh`, so Obsidian loads that checkout's `main.js`. From a second
  checkout or worktree, the suite exercises whichever build the registered
  vault points at, not necessarily yours.
- Run one test with `E2E="<name substring>" npm run test:e2e`.
- On Linux, the `obsidian` CLI must inherit the graphical session's
  environment (`DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`; on systemd,
  `systemctl --user show-environment` has the current values). Without it,
  every call dies with status 139 (SIGSEGV), which looks like an Obsidian or
  harness fault and is not. A `dbus ... system_bus_socket` line on stderr is
  benign and also appears on successful calls.
- Obsidian is the developer's running application, not a test fixture. Never
  kill or restart it to clear state. If tests fail or hang, re-run them; a test
  that needs a clean plugin reloads the plugin.

## Working rules

- **Builds go to the test vault only.** Don't copy `main.js`, `manifest.json`
  or `styles.css` into any other vault. Deploying decides what the
  maintainer's synced devices run, so stop at "built and verified, ready to
  deploy" and leave the copy to them.
- **No Notice on routine success.** A successful action should show itself
  (the card moves, the menu closes). Reserve `new Notice(...)` for failures and
  for outcomes the user would not otherwise see, such as a write that no-oped
  or only partly applied. The existing undo toast is the deliberate exception:
  it offers an action, not a confirmation.
- **Never lose typed text.** External changes update the open board in place
  when they can, and any text a remount destroys is handed back in a draft
  notice (ARCHITECTURE.md, constraint 7). Keep both properties when touching
  `KanbanView.setViewData`, `reconcile.ts`, or input handling.
- **Mobile behaviour needs a real device.** `app.emulateMobile(true)` does not
  reproduce the Android keyboard resize. Changes to keyboard handling can't be
  verified on desktop; say so rather than claiming they work.
- **Svelte components are plain JavaScript in legacy mode** with callback
  props (ARCHITECTURE.md, constraints 4 and 5). Don't convert them to runes or
  `lang="ts"` as a side effect of other work.
- **Keep `minAppVersion` where it is** unless the change requires raising it;
  PUBLISHING.md explains the trade-off (for example the deferred declarative
  settings API).
- **The Obsidian workflow is shared with another plugin.** The maintainer's
  fleet-tables plugin (a separate, private repository) uses the same e2e
  approach, `obsidian` CLI setup and working rules, and each repository keeps
  its own copy of them. When you learn something about that shared workflow
  here (the CLI, the e2e bridge, flake patterns, these rules), say so, so it
  can be carried over.

## Commits and releases

- Commit subjects are short, sentence-case descriptions of the user-visible
  effect ("Keep a card's text when making a note from it"). Test-harness-only
  work is prefixed `e2e:`. Release commits are `<version> - <summary>`.
- Tags have no `v` prefix (`0.11.2`, not `v0.11.2`), and must match
  `manifest.json`.
- The release flow is in PUBLISHING.md: `npm version --no-git-tag-version
  <patch|minor|major>`, `npm run build`, `npm run lint && npm test && npm
  audit`, then a GitHub release with `main.js`, `manifest.json` and
  `styles.css` attached. Tagging, pushing, and publishing releases are the
  maintainer's call; don't do them unless asked.
