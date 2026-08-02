# Testing

```bash
npm test              # vitest unit suite
npm run lint          # eslint + svelte-check (src) + tsc (tests)
npm run check:tests   # typecheck everything under tests/ on its own
npm run test:e2e      # drives a live Obsidian (~3 min)
```

The e2e suite in `tests/e2e/sanity.e2e.ts` drives a real Obsidian instance
through the `obsidian` CLI. The vault is `tests/e2e/minimalist-kanban-vault/`,
tracked in git, with the plugin directory symlinked to the repo root — so the
running app always loads this checkout's `main.js`. Build before running.

`.claude/e2e-flake-patterns.md` symlinks here. That symlink is not tracked
(`.claude/` is gitignored); this file is the source of truth.

---

## Flake patterns

Hard-won rules for keeping the e2e suite stable. The sibling **fleet-tables**
repo has an e2e harness sharing an ancestor with this one — `cli()`, `test()`
and `showInHostLeaf()` are near-identical — so a defect found in one is worth
checking in the other. Everything below came from diagnosing a real flake that
failed about one test per run, a different test each time.

### 1. The `obsidian` CLI never exits non-zero — so retry timeouts, not text

Every application-level error comes back as **rc=0** with `Error: ...` on
stdout. Measured against the live app, all rc=0:

| condition | output |
|---|---|
| bad vault name | `Vault not found.` |
| unknown subcommand | `Error: Command "frobnicate" not found.` |
| open/delete a missing path | `Error: File "..." not found.` |
| syntax error in `eval` | `Error: Unexpected end of input` |
| exception thrown inside `eval` | `Error: Cannot read properties of undefined ...` |

**`execSync` therefore only throws for transport failures**, in at least three
shapes:

| shape | `status` | `code` | `signal` | stdout/stderr |
|---|---|---|---|---|
| crashed helper | — | — | — | zypak / SIGABRT text in stderr |
| timed out | — | `ETIMEDOUT` | `SIGTERM` | **both empty** |
| silent non-zero exit | set | — | — | **both empty** |

`cli()` used to decide retries by matching **stderr text**, and the list here
was only `event_origin_changed` / `zypak-helper` — so it caught the first shape
and nothing else. The other two carry no text at all and failed their test on
the first blip.

The rule is now structural rather than a list of shapes: because every
application-level outcome is rc=0 + text, **any** throw is transport-level and
is retried. Do not go back to matching stderr text — two of the three shapes
have none, and the third was only discovered after the failure report was
widened to print `status`/`code`/`signal`/`message` alongside stdout/stderr.

### 2. Print the whole error, not the first line

`test()` used to log `err.message.split("\n")[0]` — precisely the line that
omits every diagnostic field. In fleet-tables that single truncation was the
difference between three false starts and an actual diagnosis. Print all of it.

### 3. Never infer success from an rc=0 CLI call

`create` on a taken name does **not** fail. It returns `Created: Name 1.md` at
rc=0, having made a numbered duplicate — while helpers go on to open `Name.md`,
so the test reads the STALE original with the fresh copy orphaned beside it.

Use `createNote()`, which deletes first and then verifies the path `create`
reported. Never call `cli('create ...')` directly.

### 4. The host note is a committed fixture

`tests/e2e/minimalist-kanban-vault/_e2e_host.md` is committed. The suite opens
it and never creates or deletes it. Creating it per run meant any run that
ended without reaching its cleanup left it behind, so the next run orphaned an
`_e2e_host N.md` into the tracked vault. Committing it removes the failure mode
rather than guarding it. Do not re-add a delete for it.

It is deliberately plain prose — no headings, list items or fences — so nothing
in it can render as a lane or card and poison document-wide selectors.

### 5. Poll for anything asynchronous; never sleep for it

Two things routinely take longer than a fixed sleep, and both produce
"No elements found" — a working feature reported as broken:

- **Vault and metadataCache indexing after `create`.** `create` returns before
  either is populated. Poll for what you actually need: the file in
  `app.vault.getAbstractFileByPath`, and for heading suggestions,
  `app.metadataCache.getFileCache(f).headings`.
- **UI that renders asynchronously**, like the link-suggest popup. A single
  `domTextAll()` after `sleep(500)` either catches it or fails the test.

Both `link suggest:` tests were flaking on exactly this. They now poll via
`ensureLinkTarget()` and `waitFor` instead of `sleep(1000)` / `sleep(500)`.

### 6. Reset UI state after every test

`test()` runs `resetUiState()` in a `finally` — on pass as well as failure —
dismissing open editors (`.kb-item-edit`, `.kb-lane-title-input`,
`.kb-add-item-input`) and any leftover Obsidian `.menu`.

This is what the observed cascade needed: a link-suggest test threw before its
closing Escape, leaving the card editor open, and the *next* test's wait for
`.kb-item-edit` matched the stale one and timed out. One flake became two
failures, and the second named an innocent test.

Toasts (`.kb-undo-notice`) are deliberately left alone — they expire on their
own, and the archive/undo tests need the plugin's own bookkeeping intact.

### 7. Sweep created files at end of run, not only inline

Tests still delete their own boards inline where the next test depends on it
(the drag pair share `DRAG_PATH`; the context-menu group shares
`ACTIONS_PATH`), so per-test deletion is *not* appropriate here. But an inline
delete only runs if the test reached it. `createNote()` registers every path
and the end-of-run sweep removes them, so a thrown test cannot leak a file into
the tracked vault — or into the next run, where `create` would silently turn
the leftover into a numbered duplicate.

`Link Target.md` was leaking exactly this way.

---

## Typechecking the tests

`npm run check:tests` covers everything under `tests/` — both the vitest suites
and the e2e harness. Neither was checked before: vitest and `npx tsx` both strip
types without verifying them, and `tsconfig.check.json` covers only `src/**`.

`obsidian` resolves to the **real** package typings there, not to
`tests/mocks/obsidian.ts`, even though vitest aliases it at runtime. The suites
import from `../src`, so aliasing the module would check the plugin's own source
against the mock and hide real API misuse — the mock's `Menu` has no `Editor`,
`Vault`, or anything else src relies on.

The mock's extra surface is instead declared additively in
`tests/obsidian-mock.d.ts`: the `static instances` arrays, `Menu.findItem`,
`Notice.hidden`, `WorkspaceLeaf.lastViewState` and so on. **A member added to
the mock needs a line there**, or its first use is a type error. Because the
declarations are additive only, a test that typechecks against them still
typechecks against Obsidian proper.

Two things this surfaced that were worth fixing rather than declaring away:

- `new MarkdownView()` — the mock's constructor takes no arguments, the real one
  takes a leaf. The tests now pass the leaf, which the mock ignores.
- Predicates narrowing `menu.items` to the *mock's* `MenuItem` class while the
  array is typed with the real one. They now narrow to the real (augmented)
  type, which is what the array actually holds.

## Running a single e2e test

```bash
E2E="renders 3 lanes" npm run test:e2e
E2E="link suggest" npm run test:e2e
```

Case-insensitive substring of the test name. Everything else is skipped and the
summary reports the skip count. The full run is ~3 minutes; one test is seconds.

The shared board is created inside the *"create kanban file and open it"* test,
and most later tests assert against the board it left open. Under a filter that
test is usually skipped, so the runner calls `createBoard()` once before the
first test that does run. Without that, nearly every filtered selection would
fail on a board that was never opened.

Two groups work on a board other than the default, built by the first test in
the group. Each member calls `ensureDragBoard()` / `ensureActionsBoard()`, which
build that board only if it is not already the open one — so a full run is
unaffected (the builder already opened it and the ensure is a no-op), while a
filtered run gets the board it needs.

What that cannot fix is a test asserting on a *mutation* an earlier test made
rather than just needing a board. Four are in that position and only pass in a
full run:

| test | needs |
|---|---|
| `checkbox: toggling a card checkbox writes [x]` | the card `context menu: duplicate card` added |
| `archive card: undo restores it, redo-archive persists to file` | lane state from the tests before it |
| `archive card: restore returns it to the last lane` | the card archived by the test before it |
| `lane delete shows undo toast and restores lane with cards` | the lane count earlier tests left |

Everything else runs alone. Verified individually: `renders 3 lanes`,
`drag: card moves across lanes`, `drag: lane reorder`, `context menu:
duplicate card`, `context menu: move to top` and `lane rename` all pass under a
filter; the four above and `toggle back to kanban view restores board` (which
needs the preceding toggle-to-markdown) do not — for this reason, not because
they are broken.

Making those five standalone means rewriting their assertions to set up the
state they check rather than inherit it. Worth doing when next editing them.
