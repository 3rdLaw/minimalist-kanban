# Testing

```bash
npm test              # vitest unit suite
npm run lint          # eslint + svelte-check + e2e typecheck
npm run check:e2e     # typecheck tests/e2e on its own
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

## Still outstanding

- **The vitest suites are not typechecked.** `npm run check:e2e` covers
  `tests/e2e/` only. The unit suites under `tests/` carry ~89 pre-existing type
  errors (mock augmentations like `Menu.instances`, missing vitest globals), so
  including them would mean fixing all of that before the gate could go green.
  Worth doing as its own change; `tsconfig.e2e.json` just needs its `include`
  widened once they are clean.
- **No `E2E` filter.** fleet-tables supports `E2E="substring" npm run test:e2e`
  to run one test in ~15-20s. This suite always runs all 29. Worth porting.
