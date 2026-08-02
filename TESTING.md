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

Setup overwrites (`createNote()` deletes before creating), so a leftover file
never changes what a test sees. What it would change is the *vault*, which is
tracked in git — and an inline delete at the end of a test only runs if the test
got that far. `createNote()` registers every path and the end-of-run sweep
removes them, so a thrown test cannot leak a file into the repo, or into the
next run where `create` would silently turn the leftover into a numbered
duplicate.

`Link Target.md` was leaking exactly this way.

Deletion is deliberately end-of-run rather than per-test: deleting a file the
host leaf is showing can tear the leaf down, which is one source of the
empty-view windows described above.

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

**Every test passes on its own.** All 23 were verified individually, not
inferred — if one only passes as part of a full run, that is a bug in the test.

## Every test sets up its own state

The suite used to share one board across the whole run. That was convenient and
wrong: a test's meaning depended on which tests had run before it. `toggle back
restores board` asserted 4 lanes only because an earlier test added one; the
archive tests asserted against `## Renamed`, a lane title a *third* test set;
`checkbox` expected 4 cards because `duplicate card` had made one. None could be
run — or read — in isolation, and one early failure cascaded through the group.

The rules now:

- **Build what you need.** Call `createBoard()`, `setupDragBoard()` or
  `setupActionsBoard()` at the top of the test. They are unconditional;
  `createNote()` deletes before creating, so setup doubles as teardown of
  whatever the last test left. Never assume a board is already open — the two
  `link suggest:` tests drive the *"Write tests"* card and so need
  `createBoard()` even though their subject is a different note.
- **Restore global state in a `finally`.** Plugin settings and mobile emulation
  are process-wide. `showCheckboxes` and `showArchive` were switched on by one
  test and off by a *later* one, so running either alone left the plugin
  misconfigured for everything after. Use `setPluginSetting()`, which returns a
  restore function, and call it in a `finally` so a failed assertion cannot
  leak the setting.
- **Assert against your own setup**, never against a value an earlier test
  produced. If an assertion needs a duplicated card or an archived one, do the
  duplicating or archiving in that test.
- Files do not need per-test deletion: setup overwrites, and the end-of-run
  sweep clears the vault. Deleting mid-run risks tearing down the leaf.

### Grouping

Tests that assert several things about the *same unmutated* board are one test,
not several — otherwise each would rebuild the same board to check one line.
`board renders lanes, titles and cards, and round-trips to file` is five former
tests. Likewise, steps that are only meaningful in sequence are one test:
toggling to markdown and back is a round trip, and the archive lifecycle
(archive, undo, re-archive, restore) is one flow.

That took the suite from 29 tests to 23 — and made it *faster* (~2m50s), since
the merges removed board rebuilds that bought nothing.
