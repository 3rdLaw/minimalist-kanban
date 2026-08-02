import { execSync } from "child_process";
import assert from "node:assert/strict";

const VAULT = process.env.OBSIDIAN_E2E_VAULT || "minimalist-kanban-vault";
const TEST_FILE = "E2E Sanity Test";
const TEST_PATH = `${TEST_FILE}.md`;

const KANBAN_CONTENT = [
  "---",
  "kanban-plugin: board",
  "---",
  "",
  "## To Do",
  "- Buy milk",
  "- Walk the dog",
  "",
  "## In Progress",
  "- Write tests",
  "",
  "## Done",
  "",
].join("\\n");

// ── CLI helpers ─────────────────────────────────────────

function cli(cmd: string, retries = 2): string {
  const full = `obsidian vault="${VAULT}" ${cmd}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return execSync(full, { encoding: "utf-8", timeout: 15_000 }).trim();
    } catch (err: any) {
      const stderr = err.stderr?.toString().trim() ?? "";
      const stdout = err.stdout?.toString().trim() ?? "";
      // The `obsidian` CLI never exits non-zero. A bad vault, an unknown
      // subcommand, a missing path, a syntax error in `eval`, even an exception
      // thrown inside `eval` all come back rc=0 with "Error: ..." on stdout. So
      // execSync only throws for transport-level failures, and they arrive in
      // at least three shapes:
      //
      //   crashed helper       stderr carries zypak / SIGABRT / Aborting
      //   timed out            code ETIMEDOUT, signal SIGTERM, output EMPTY
      //   silent non-zero exit status set, code/signal unset, output EMPTY
      //
      // Deciding retries by matching stderr TEXT only ever caught the first
      // shape; the other two carry no text and failed their test on the first
      // blip. Because every application-level outcome is rc=0 + text, ANY throw
      // here is transport-level and worth retrying. See flake pattern 1.
      const timedOut = err.code === "ETIMEDOUT" || err.signal === "SIGTERM" || err.signal === "SIGKILL";
      if (attempt < retries) {
        // A timeout means the app was busy; give it longer than a crash would.
        sleep(timedOut ? 2000 : 300);
        continue;
      }
      throw new Error(
        `CLI failed after ${retries + 1} attempts: ${full}\n` +
        `status: ${err.status ?? "(none)"}  code: ${err.code ?? "(none)"}  ` +
        `signal: ${err.signal ?? "(none)"}\n` +
        `message: ${err.message ?? "(none)"}\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`
      );
    }
  }
  throw new Error(`CLI failed after retries: ${full}`);
}

function evaluate(code: string): string {
  const escaped = code.replace(/"/g, '\\"');
  return cli(`eval code="${escaped}"`);
}

function sleep(ms: number) {
  execSync(`sleep ${ms / 1000}`);
}

function waitFor(
  cmd: string,
  predicate: (output: string) => boolean,
  timeoutMs = 5000
): string {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = cli(cmd);
      if (predicate(result)) return result;
    } catch {
      // keep trying
    }
    sleep(500);
  }
  const result = cli(cmd);
  if (predicate(result)) return result;
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms. Last output: ${result}`
  );
}

function waitForDom(selector: string, expected: string, timeoutMs = 5000) {
  return waitFor(
    `dev:dom selector="${selector}" total`,
    (out) => out.includes(expected),
    timeoutMs
  );
}

/** Poll `read` until file content satisfies the predicate (requestSave debounce is ~2s) */
function waitForFile(
  predicate: (content: string) => boolean,
  timeoutMs = 5000
): string {
  return waitFor(
    `read path="${TEST_PATH}"`,
    predicate,
    timeoutMs
  );
}

function domTotal(selector: string): string {
  return cli(`dev:dom selector="${selector}" total`);
}

function domTextAll(selector: string): string {
  return cli(`dev:dom selector="${selector}" text all`);
}

// The run shares one leaf — "the host leaf". Switching a file into an existing
// leaf never raises the OS window, but the CLI's `create ... open` always
// does, once per board, which stole focus repeatedly during a run and let a
// stray click break whichever test was mid-flight.
//
// Bootstrapping still needs one activating open, so a run raises the window
// exactly once instead of once per board.
//
// A board leaf's view type flips from "markdown" to "kanban-board" via the
// plugin's setViewState redirect, so the host leaf is looked up under both.
const HOST_NOTE = "_e2e_host";
const HOST_PATH = `${HOST_NOTE}.md`;

/**
 * Show `path` in the host leaf without activating it, so the OS window is
 * never raised. Polls because `create` returns before the vault registers the
 * file, and openFile needs the TFile.
 *
 * This waits on the vault's file registry, NOT metadataCache — tests that
 * deliberately open a brand-new board still exercise the redirect's
 * content-read fallback.
 */
function showInHostLeaf(path: string): void {
  const code =
    "(() => {" +
    "  const leaves = [];" +
    "  app.workspace.iterateAllLeaves(l => {" +
    "    const t = l.view && l.view.getViewType ? l.view.getViewType() : '';" +
    "    if (t === 'markdown' || t === 'kanban-board') leaves.push(l);" +
    "  });" +
    "  const leaf = leaves.find(l => l.view.containerEl.offsetParent !== null) ?? leaves[0];" +
    "  if (!leaf) return 'no-leaf';" +
    `  const file = app.vault.getAbstractFileByPath('${path}');` +
    "  if (!file) return 'no-file';" +
    // openFile is async, so report success only once the view has actually
    // switched — otherwise callers race it. Re-entrant: a second poll won't
    // re-open. Both MarkdownView and KanbanView expose `file`.
    `  if (leaf.view.file && leaf.view.file.path === '${path}') return 'ok';` +
    "  leaf.openFile(file, { active: false });" +
    "  return 'opening';" +
    "})()";
  let out: string;
  try {
    out = waitFor(
      `eval code="${code}"`,
      (o) => o.includes("ok") || o.includes("no-leaf"),
      8000
    );
  } catch (err: any) {
    // 'no-file' stays out of the predicate on purpose: create returns before
    // the vault indexes the file, so a transient 'no-file' must keep polling.
    // But it is also the one reply that can never become 'ok' by itself, so if
    // the poll ran out while still seeing it, report THAT rather than the
    // generic timeout — which names the symptom and leaves the cause (the file
    // was never created) out entirely.
    if (String(err.message).includes("no-file")) {
      throw new Error(
        `showInHostLeaf("${path}"): vault still had no such file after 8000ms. ` +
        `It was deleted, or the create that should have made it never landed ` +
        `on this path.`
      );
    }
    throw err;
  }
  if (out.includes("no-leaf")) {
    // Nothing to reuse — bootstrap with an activating open. Expected only at
    // suite start; mid-run it means a leaf was torn down unexpectedly.
    cli(`open path="${path}"`);
  }
}

/**
 * Open the shared host leaf. The only window-raise in a run.
 *
 * The note is a COMMITTED FIXTURE, not created here. `create` does not fail on
 * a name that is taken — it succeeds having made "_e2e_host 1.md" instead
 * (flake pattern 1) — so creating it each run meant any run that started with the
 * note still present, i.e. any run killed before its cleanup, orphaned another
 * numbered copy into this git-tracked vault. Committing it removes the failure
 * mode rather than guarding it: there is no create left to duplicate, and
 * nothing to delete at the end of a run.
 */
function bootstrapHostLeaf() {
  // Still polled: the fixture is on disk from the start, but the vault's file
  // registry populates asynchronously and `open` needs the TFile.
  waitFor(
    `eval code="app.vault.getAbstractFileByPath('${HOST_PATH}') ? 'indexed' : 'waiting'"`,
    (out) => out.includes("indexed"),
    8000
  );
  cli(`open path="${HOST_PATH}"`);
}

function cleanup() {
  try {
    cli(`delete path="${TEST_PATH}" permanent`);
  } catch {
    // file doesn't exist
  }
}

// ── Per-test state hygiene ──────────────────────────────

/**
 * Every note the suite has created, deleted at the end of a run.
 *
 * Deliberately NOT deleted per test: several tests hand a board to the next one
 * (the two drag tests share DRAG_PATH, the context-menu group shares
 * ACTIONS_PATH), so per-test deletion would pull files out from under them.
 * This is the safety net for the case that actually leaks — a test that throws
 * before reaching its own inline delete.
 */
const createdPaths = new Set<string>();

/**
 * Create a note, and make sure it lands on the path the caller asked for.
 *
 * `create` does not fail on a taken name: it succeeds having made "Name 1.md"
 * (see flake pattern 1), so a leftover from an earlier failure would leave the
 * test reading STALE content with the fresh copy orphaned beside it. Deleting
 * first makes the create deterministic; verifying the reported path catches the
 * case where the delete did not take.
 */
function createNote(name: string, content: string): void {
  const path = `${name}.md`;
  createdPaths.add(path);
  cli(`delete path="${path}" permanent`);
  const out = cli(`create name="${name}" content="${content}"`);
  const made = /Created:\s*(.+)$/m.exec(out)?.[1]?.trim();
  if (made && made !== path) {
    cli(`delete path="${made}" permanent`);
    throw new Error(
      `createNote("${name}"): create landed on "${made}" — the vault still ` +
      `held a copy the delete above did not clear.`
    );
  }
}

/**
 * Dismiss transient UI so a failing test cannot poison the next one.
 *
 * This is what the observed cascade needed: a link-suggest test threw before
 * its closing Escape, leaving the card edit textarea open, and the next test's
 * wait for `.kb-item-edit` then matched the stale one and timed out. Toasts are
 * left alone — they expire on their own, and the tests that assert on
 * `.kb-undo-notice` need the plugin's own bookkeeping intact.
 */
function resetUiState(): void {
  try {
    evaluate(
      "(() => {" +
      "  document.querySelectorAll('.kb-item-edit, .kb-lane-title-input, .kb-add-item-input')" +
      "    .forEach(el => {" +
      "      el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));" +
      "      el.blur();" +
      "    });" +
      // Obsidian's context menu is appended to body and survives a failed click
      "  document.querySelectorAll('.menu').forEach(m => m.remove());" +
      "})()"
    );
  } catch { /* best effort — never mask the real failure */ }
}

/** JSON map of every lane title to its card titles, for order assertions. */
function laneMap(): string {
  return evaluate(
    "JSON.stringify([...document.querySelectorAll('.kb-lane')].map(l => " +
      "l.querySelector('.kb-lane-title').textContent + ': ' + " +
      "[...l.querySelectorAll('.kb-item-title')].map(i => i.textContent.trim()).join(', ')))"
  );
}

/**
 * Synthetic drag-and-drop. SortableJS uses native HTML5 DnD in Electron,
 * which synthetic mouse events alone can't trigger. This staged sequence
 * works: pointerdown arms the element (Sortable sets draggable=true), then
 * dragstart on the draggable, dragenter/dragover/drop on the target, and
 * dragend — each stage in its own eval so Sortable sees separate turns.
 *
 * armExpr:  element receiving pointerdown (the drag handle, or the card)
 * dragExpr: the draggable element (the lane, or the card)
 * dropExpr: the drop target
 * at: where on the target to drop — "bottom" inserts after a card,
 *     "right" moves a lane past the target lane
 */
function synthDrag(
  armExpr: string,
  dragExpr: string,
  dropExpr: string,
  at: "bottom" | "right"
) {
  evaluate([
    "window.__mk = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0})",
    `window.__drag = ${dragExpr}`,
    `window.__drop = ${dropExpr}`,
    "window.__dt = new DataTransfer()",
    `const arm = ${armExpr}`,
    "const r = arm.getBoundingClientRect()",
    "arm.dispatchEvent(new PointerEvent('pointerdown', window.__mk(r.x + 5, r.y + 5)))",
  ].join("; "));
  sleep(200);
  evaluate([
    "const r = window.__drag.getBoundingClientRect()",
    "window.__drag.dispatchEvent(new DragEvent('dragstart', Object.assign(window.__mk(r.x + 10, r.y + 10), {dataTransfer: window.__dt})))",
  ].join("; "));
  sleep(200);
  const point =
    at === "bottom"
      ? "{x: t.x + t.width / 2, y: t.y + t.height - 2}"
      : "{x: t.x + t.width - 5, y: t.y + 20}";
  evaluate([
    "const t = window.__drop.getBoundingClientRect()",
    `const p = ${point}`,
    "const o = Object.assign(window.__mk(p.x, p.y), {dataTransfer: window.__dt})",
    "window.__drop.dispatchEvent(new DragEvent('dragenter', o))",
    "window.__drop.dispatchEvent(new DragEvent('dragover', o))",
    "window.__drop.dispatchEvent(new DragEvent('drop', o))",
    "window.__drag.dispatchEvent(new DragEvent('dragend', o))",
  ].join("; "));
}

function findCard(title: string): string {
  return `[...document.querySelectorAll('.kb-item')].find(i => i.querySelector('.kb-item-title')?.textContent.trim() === '${title}')`;
}

function createBoard() {
  createNote(TEST_FILE, KANBAN_CONTENT);
  showInHostLeaf(TEST_PATH);
  waitForDom(".kb-lane", "3", 8000);
}

function clickMenuItem(label: string) {
  evaluate(
    `[...document.querySelectorAll('.menu-item-title')].find(el => el.textContent === '${label}').closest('.menu-item').click()`
  );
}

// ── Test runner ─────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  FAIL  ${name}`);
    // Every line, not just the first: cli() puts the failing command on line
    // one and the diagnostic (status/code/signal/message/stdout/stderr) after
    // it, and that is usually the only thing that says WHY a run failed.
    for (const line of String(err.message).split("\n")) console.log(`        ${line}`);
    failed++;
  } finally {
    // Runs on pass too: a test that returns early can leave an editor open
    // just as easily as one that throws.
    resetUiState();
  }
}

// ── Tests ───────────────────────────────────────────────

console.log("\n=== e2e tests ===\n");

cleanup();
bootstrapHostLeaf();

// ── Plugin lifecycle ────────────────────────────────────

test("plugin is enabled", () => {
  const list = cli("plugins:enabled");
  assert.ok(list.includes("minimalist-kanban"), `minimalist-kanban not in enabled plugins`);
});

test("plugin reloads without error", () => {
  cli("plugin:reload id=minimalist-kanban");
});

// ── Board rendering ─────────────────────────────────────

test("create kanban file and open it", () => {
  createBoard();
  const content = cli(`read path="${TEST_PATH}"`);
  assert.ok(content.includes("kanban-plugin: board"), "Missing frontmatter");
  assert.ok(content.includes("## To Do"), "Missing To Do lane");
});

test("kanban view renders 3 lanes", () => {
  assert.equal(domTotal(".kb-lane"), "3");
});

test("lane titles are correct", () => {
  const titles = domTextAll(".kb-lane-title");
  assert.ok(titles.includes("To Do"));
  assert.ok(titles.includes("In Progress"));
  assert.ok(titles.includes("Done"));
});

test("cards are rendered", () => {
  const cards = domTextAll(".kb-item-title");
  assert.ok(cards.includes("Buy milk"));
  assert.ok(cards.includes("Walk the dog"));
  assert.ok(cards.includes("Write tests"));
});

test("file content round-trips correctly", () => {
  const content = cli(`read path="${TEST_PATH}"`);
  assert.ok(content.includes("Buy milk"));
  assert.ok(content.includes("Walk the dog"));
  assert.ok(content.includes("Write tests"));
});

// ── Add a lane ──────────────────────────────────────────

test("clicking '+ Add List' adds a new lane", () => {
  evaluate("document.querySelector('.kb-add-lane-btn').click()");
  waitForDom(".kb-lane", "4");
  const titles = domTextAll(".kb-lane-title");
  assert.ok(titles.includes("New List"), `Missing "New List" in: ${titles}`);
  // requestSave is debounced ~2s — wait for file to update
  waitForFile((c) => c.includes("## New List"), 5000);
});

// ── Add a card ──────────────────────────────────────────

test("typing in textarea and pressing Enter adds a card", () => {
  // Target the "Done" lane's textarea (index 2, since Done is 3rd original lane)
  evaluate([
    "const ta = document.querySelectorAll('.kb-add-item-input')[2]",
    "ta.value = 'Card from e2e'",
    "ta.dispatchEvent(new Event('input', {bubbles:true}))",
    "ta.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))",
  ].join("; "));

  // Wait for the card to appear in DOM
  waitFor(
    'dev:dom selector=".kb-item-title" text all',
    (out) => out.includes("Card from e2e"),
    5000
  );

  // Wait for the file to update, then verify card is under ## Done
  waitForFile((c) => c.includes("Card from e2e"), 5000);
  const content = cli(`read path="${TEST_PATH}"`);
  const doneIdx = content.indexOf("## Done");
  const cardIdx = content.indexOf("Card from e2e");
  assert.ok(cardIdx > doneIdx, "Card should be under ## Done");
});

// ── Delete a card ───────────────────────────────────────

test("deleting a card via context menu removes it", () => {
  const before = domTextAll(".kb-item-title");
  assert.ok(before.includes("Buy milk"), "Setup: Buy milk should exist");

  // Open the first card's context menu
  evaluate("document.querySelector('.kb-item .kb-menu-btn').click()");
  sleep(300);

  // Click "Delete card" in the menu
  clickMenuItem("Delete card");

  // Wait for card to disappear from DOM
  waitFor(
    'dev:dom selector=".kb-item-title" text all',
    (out) => !out.includes("Buy milk"),
    5000
  );

  // Wait for file to update
  waitForFile((c) => !c.includes("Buy milk"), 5000);
});

// ── Undo card deletion ──────────────────────────────────

test("undo: deleting a card shows toast, clicking Undo restores card", () => {
  const before = domTextAll(".kb-item-title");
  assert.ok(before.includes("Walk the dog"), "Setup: Walk the dog should exist");

  // Open the menu for the card whose title is "Walk the dog"
  evaluate([
    "const card = [...document.querySelectorAll('.kb-item')].find(c => c.querySelector('.kb-item-title')?.textContent.trim() === 'Walk the dog')",
    "card.querySelector('.kb-menu-btn').click()",
  ].join("; "));
  sleep(300);

  clickMenuItem("Delete card");

  // Wait for card to disappear
  waitFor(
    'dev:dom selector=".kb-item-title" text all',
    (out) => !out.includes("Walk the dog"),
    5000
  );

  // Undo toast appears with message and Undo button
  waitForDom(".kb-undo-notice", "1", 3000);
  const toastText = domTextAll(".kb-undo-notice");
  assert.ok(
    toastText.includes("Card deleted"),
    `Toast should mention "Card deleted": ${toastText}`
  );
  assert.equal(domTotal(".kb-undo-btn"), "1", "Undo button should exist");

  // Click Undo
  evaluate("document.querySelector('.kb-undo-btn').click()");

  // Card returns to DOM
  waitFor(
    'dev:dom selector=".kb-item-title" text all',
    (out) => out.includes("Walk the dog"),
    3000
  );

  // File content has the card restored
  waitForFile((c) => c.includes("Walk the dog"), 5000);
});

// ── Plugin reload preserves state ───────────────────────

test("plugin reload preserves board state", () => {
  const beforeCards = domTextAll(".kb-item-title");
  const beforeLanes = domTotal(".kb-lane");

  cli("plugin:reload id=minimalist-kanban");
  waitForDom(".kb-lane", beforeLanes, 8000);

  const afterCards = domTextAll(".kb-item-title");
  assert.equal(afterCards, beforeCards, "Cards should be identical after reload");
});

// ── Toggle Kanban/Markdown view ─────────────────────────

test("toggle to markdown view hides kanban UI", () => {
  cli('command id="minimalist-kanban:toggle-kanban-view"');

  // The view switch is async — wait for lanes to disappear
  waitFor(
    'dev:dom selector=".kb-lane" total',
    (out) => out.includes("No elements found"),
    5000
  );
  assert.equal(domTotal(".cm-editor"), "1", "CodeMirror should be visible");
});

test("toggle back to kanban view restores board", () => {
  cli('command id="minimalist-kanban:toggle-kanban-view"');

  waitForDom(".kb-lane", "4", 8000);
  const cards = domTextAll(".kb-item-title");
  assert.ok(cards.includes("Walk the dog"));
  assert.ok(cards.includes("Write tests"));
});

// ── Mobile: lanes stay within viewport ──────────────────

test("mobile mode: lanes do not extend past board bottom", () => {
  evaluate("app.emulateMobile(true)");
  sleep(500);
  // Reload plugin so mobile styles take effect on the view
  cli("plugin:reload id=minimalist-kanban");
  waitForDom(".kb-lane", "4", 8000);

  const result = evaluate(
    '(() => {' +
    '  const board = document.querySelector(".kb-board");' +
    '  const lanes = document.querySelectorAll(".kb-lane");' +
    '  const boardRect = board.getBoundingClientRect();' +
    '  let maxBottom = 0;' +
    '  lanes.forEach(l => { const r = l.getBoundingClientRect(); if (r.bottom > maxBottom) maxBottom = r.bottom; });' +
    '  return JSON.stringify({ laneBtm: Math.round(maxBottom), boardBtm: Math.round(boardRect.bottom) });' +
    '})()'
  );
  const { laneBtm, boardBtm } = JSON.parse(result.replace(/^=> /, ""));
  assert.ok(
    laneBtm <= boardBtm,
    `Lane bottom (${laneBtm}) should not exceed board bottom (${boardBtm})`
  );

  evaluate("app.emulateMobile(false)");
  sleep(300);
  cli("plugin:reload id=minimalist-kanban");
  waitForDom(".kb-lane", "4", 8000);
});

// ── Auto-scroll on new card ─────────────────────────────

test("adding cards scrolls the lane to show the new item", () => {
  // Add several cards to the "To Do" lane to overflow it
  for (let i = 0; i < 15; i++) {
    evaluate([
      'const ta = document.querySelectorAll(".kb-add-item-input")[0]',
      `ta.value = 'Scroll test ${i}'`,
      "ta.dispatchEvent(new Event('input', {bubbles:true}))",
      "ta.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))",
    ].join("; "));
    sleep(150);
  }

  // Wait for the last card to appear
  waitFor(
    'dev:dom selector=".kb-item-title" text all',
    (out) => out.includes("Scroll test 14"),
    5000
  );

  // Check that the items container is scrolled to the bottom
  const result = evaluate(
    '(() => {' +
    '  const items = document.querySelector(".kb-lane-items");' +
    '  return JSON.stringify({' +
    '    scrollTop: Math.round(items.scrollTop),' +
    '    scrollHeight: items.scrollHeight,' +
    '    clientHeight: items.clientHeight,' +
    '    atBottom: items.scrollTop + items.clientHeight >= items.scrollHeight - 5' +
    '  });' +
    '})()'
  );
  const scroll = JSON.parse(result.replace(/^=> /, ""));
  assert.ok(
    scroll.atBottom,
    `Lane should be scrolled to bottom after adding cards (scrollTop=${scroll.scrollTop}, scrollHeight=${scroll.scrollHeight}, clientHeight=${scroll.clientHeight})`
  );
});

// ── Link suggest ───────────────────────────────────────

const LINK_TARGET = "Link Target";

/**
 * Put the note the suggest tests link to in place, and wait until BOTH indexes
 * it needs are populated: the vault file list (file suggestions) and
 * metadataCache headings (heading suggestions).
 *
 * Polled, not slept. The original `sleep(1000)` after create was a fixed guess
 * at asynchronous indexing, and when it came up short the test failed with
 * "No elements found" — reporting a broken feature when the feature was fine.
 *
 * Called by both suggest tests so neither depends on the other having run.
 */
function ensureLinkTarget(): void {
  createNote(LINK_TARGET, "# Important Section\\nSome content");
  waitFor(
    `eval code="(() => { const f = app.vault.getAbstractFileByPath('${LINK_TARGET}.md'); if (!f) return 'no-file'; const c = app.metadataCache.getFileCache(f); return (c && c.headings && c.headings.length) ? 'indexed' : 'waiting'; })()"`,
    (o) => o.includes("indexed"),
    8000
  );
}

test("link suggest: [[ triggers file autocomplete in card edit", () => {
  ensureLinkTarget();

  // Click the "Write tests" card to enter edit mode
  evaluate([
    "const t = [...document.querySelectorAll('.kb-item-title')].find(e => e.textContent.trim() === 'Write tests')",
    "t.click()",
  ].join("; "));
  waitFor('dev:dom selector=".kb-item-edit" total', (o) => o.includes("1"), 3000);

  // Type [[Link to trigger file suggestions
  evaluate([
    "const ta = document.querySelector('.kb-item-edit')",
    "ta.value = '[[Link'",
    "ta.selectionStart = 6",
    "ta.selectionEnd = 6",
    "ta.dispatchEvent(new Event('input', {bubbles:true}))",
  ].join("; "));

  // Poll for the popup instead of sleep(500) + a single-shot read: the suggest
  // renders asynchronously, so one read at a fixed offset either catches it or
  // reports "No elements found" and fails a working feature.
  const suggestText = waitFor(
    'dev:dom selector=".kb-link-suggest .suggestion-title" text all',
    (o) => o.includes("Link Target"),
    5000
  );
  assert.ok(
    suggestText.includes("Link Target"),
    `Expected "Link Target" in suggest: ${suggestText}`
  );

  // Press Enter to accept the suggestion
  evaluate(
    "document.querySelector('.kb-item-edit').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))"
  );
  sleep(300);

  // Verify textarea contains [[Link Target]]
  const result = evaluate(
    "JSON.stringify(document.querySelector('.kb-item-edit').value)"
  );
  const value = JSON.parse(result.replace(/^=> /, ""));
  assert.ok(
    value.includes("[[Link Target]]"),
    `Expected [[Link Target]] in value: ${value}`
  );

  // Verify suggest popup is hidden (no is-active class)
  const hasActive = evaluate(
    "document.querySelector('.kb-link-suggest').classList.contains('is-active')"
  );
  assert.ok(hasActive.includes("false"), "Suggest should not have is-active class after accept");

  // Escape to cancel edit without saving
  evaluate(
    "document.querySelector('.kb-item-edit').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))"
  );
  sleep(200);
});

test("link suggest: # shows heading autocomplete", () => {
  // Idempotent: does not assume the previous test ran or succeeded.
  ensureLinkTarget();

  // Click "Write tests" to enter edit mode
  evaluate([
    "const t = [...document.querySelectorAll('.kb-item-title')].find(e => e.textContent.trim() === 'Write tests')",
    "t.click()",
  ].join("; "));
  waitFor('dev:dom selector=".kb-item-edit" total', (o) => o.includes("1"), 3000);

  // Type [[Link Target# to trigger heading suggestions for that note
  evaluate([
    "const ta = document.querySelector('.kb-item-edit')",
    "ta.value = '[[Link Target#'",
    "ta.selectionStart = 14",
    "ta.selectionEnd = 14",
    "ta.dispatchEvent(new Event('input', {bubbles:true}))",
  ].join("; "));

  // Poll, for the same reason as the file suggest above.
  const headings = waitFor(
    'dev:dom selector=".kb-link-suggest .suggestion-title" text all',
    (o) => o.includes("Important Section"),
    5000
  );
  assert.ok(
    headings.includes("Important Section"),
    `Expected "Important Section" in headings: ${headings}`
  );

  // Press Enter to accept
  evaluate(
    "document.querySelector('.kb-item-edit').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))"
  );
  sleep(300);

  // Verify textarea contains the heading link
  const result = evaluate(
    "JSON.stringify(document.querySelector('.kb-item-edit').value)"
  );
  const value = JSON.parse(result.replace(/^=> /, ""));
  assert.ok(
    value.includes("[[Link Target#Important Section]]"),
    `Expected heading link in value: ${value}`
  );

  // Escape to cancel edit
  evaluate(
    "document.querySelector('.kb-item-edit').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))"
  );
  sleep(200);
  // The helper note is not deleted here. An inline cleanup only runs when the
  // test reaches it, which is exactly what leaked "Link Target.md" when this
  // test flaked — and the next run's `create` then made "Link Target 1.md".
  // createNote() registered it; the end-of-run sweep removes it either way.
});

// ── Content preservation through the live save pipeline ─

test("editing a board preserves custom frontmatter, preamble, and fenced content", () => {
  const FILE = "E2E Preservation Test";
  const PATH = `${FILE}.md`;
  // ~~~ fences (not ```) because the content passes through a shell string
  const content = [
    "---",
    "kanban-plugin: board",
    "tags: [e2e-keep]",
    "---",
    "",
    "Intro note kept by the parser.",
    "",
    "## Keep",
    "- Existing card",
    "",
    "~~~",
    "- not a card",
    "## not a lane",
    "~~~",
    "",
  ].join("\\n");

  try { cli(`delete path="${PATH}" permanent`); } catch { /* didn't exist */ }

  try {
    // Opening a brand-new file exercises the redirect's content-read
    // fallback (metadataCache hasn't indexed it yet)
    createNote(FILE, content);
    showInHostLeaf(PATH);
    waitForDom(".kb-lane", "1", 8000);

    // Fence decoys must not render as cards or lanes
    const cards = domTextAll(".kb-item-title");
    assert.ok(cards.includes("Existing card"), `Missing real card: ${cards}`);
    assert.ok(!cards.includes("not a card"), `Fence content rendered as card: ${cards}`);
    const titles = domTextAll(".kb-lane-title");
    assert.ok(!titles.includes("not a lane"), `Fence content rendered as lane: ${titles}`);

    // Make a real edit through the UI to trigger the save pipeline
    evaluate([
      "const ta = document.querySelector('.kb-add-item-input')",
      "ta.value = 'New e2e card'",
      "ta.dispatchEvent(new Event('input', {bubbles:true}))",
      "ta.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))",
    ].join("; "));

    // Wait out the debounced save, then verify nothing was mangled
    const saved = waitFor(
      `read path="${PATH}"`,
      (c) => c.includes("New e2e card"),
      8000
    );
    assert.ok(saved.includes("tags: [e2e-keep]"), "Custom frontmatter key was dropped");
    assert.ok(saved.includes("Intro note kept by the parser."), "Preamble text was dropped");
    assert.ok(saved.includes("- not a card"), "Fenced content was dropped");
    assert.ok(saved.includes("## not a lane"), "Fenced content was dropped");
    assert.ok(saved.includes("- [ ] Existing card"), "Existing card lost");
  } finally {
    try { cli(`delete path="${PATH}" permanent`); } catch { /* already gone */ }
  }
});

// ── Multi-paragraph card text ───────────────────────────

test("multi-paragraph card text survives the save/reload cycle", () => {
  const FILE = "E2E Multiline Test";
  const PATH = `${FILE}.md`;
  const content = [
    "---",
    "kanban-plugin: board",
    "---",
    "",
    "## Col",
    "- Seed card",
    "",
  ].join("\\n");

  try { cli(`delete path="${PATH}" permanent`); } catch { /* didn't exist */ }

  try {
    createNote(FILE, content);
    showInHostLeaf(PATH);
    waitForDom(".kb-lane", "1", 8000);

    // Edit the card into two paragraphs separated by a blank line, blur to save
    evaluate([
      "const t = [...document.querySelectorAll('.kb-item-title')].find(e => e.textContent.trim() === 'Seed card')",
      "t.click()",
    ].join("; "));
    waitFor('dev:dom selector=".kb-item-edit" total', (o) => o.includes("1"), 3000);
    evaluate([
      "const ta = document.querySelector('.kb-item-edit')",
      "ta.value = 'para one\\n\\npara two'",
      "ta.dispatchEvent(new Event('input', {bubbles:true}))",
      // blur() is a no-op when the window never granted focus — fire the event
      "ta.dispatchEvent(new FocusEvent('blur'))",
    ].join("; "));

    // Wait out the debounced save; the file must still hold a single card
    const saved = waitFor(`read path="${PATH}"`, (c) => c.includes("para two"), 8000);
    assert.equal(
      (saved.match(/- \[ \]/g) || []).length,
      1,
      `Card was split in the file: ${JSON.stringify(saved)}`
    );

    // Reload the plugin (forces a fresh parse) and check the card stayed whole
    cli("plugin:reload id=minimalist-kanban");
    waitForDom(".kb-lane", "1", 8000);
    const cards = domTextAll(".kb-item-title");
    assert.ok(cards.includes("para one"), `Card lost first paragraph: ${cards}`);
    assert.ok(cards.includes("para two"), `Card lost second paragraph: ${cards}`);
    assert.equal(domTotal(".kb-item"), "1", "Card was split on re-parse");
  } finally {
    try { cli(`delete path="${PATH}" permanent`); } catch { /* already gone */ }
  }
});

// ── Drag and drop ───────────────────────────────────────

const DRAG_FILE = "E2E Drag Test";
const DRAG_PATH = `${DRAG_FILE}.md`;

test("drag: card moves across lanes and saves in order", () => {
  try { cli(`delete path="${DRAG_PATH}" permanent`); } catch { /* didn't exist */ }
  const content = [
    "---",
    "kanban-plugin: board",
    "---",
    "",
    "## Alpha",
    "- card one",
    "- card two",
    "",
    "## Beta",
    "- card three",
    "",
  ].join("\\n");
  createNote(DRAG_FILE, content);
  showInHostLeaf(DRAG_PATH);
  waitForDom(".kb-lane", "2", 8000);

  // Drop "card one" onto the bottom edge of "card three" (inserts after it)
  synthDrag(findCard("card one"), findCard("card one"), findCard("card three"), "bottom");

  waitFor(
    'dev:dom selector=".kb-lane" text all',
    (out) => /Beta[\s\S]*card three[\s\S]*card one/.test(out),
    5000
  );
  const lanes = laneMap();
  assert.ok(lanes.includes("Alpha: card two"), `Alpha should only have card two: ${lanes}`);
  assert.ok(lanes.includes("Beta: card three, card one"), `Beta order wrong: ${lanes}`);

  const saved = waitFor(
    `read path="${DRAG_PATH}"`,
    (c) => /## Beta[\s\S]*card one/.test(c),
    8000
  );
  const alphaSection = saved.substring(saved.indexOf("## Alpha"), saved.indexOf("## Beta"));
  assert.ok(!alphaSection.includes("card one"), `card one still under Alpha:\n${saved}`);
  assert.ok(
    saved.indexOf("card three") < saved.indexOf("card one"),
    `card one should be after card three:\n${saved}`
  );
});

test("drag: lane reorder via drag handle saves", () => {
  // Continues from the previous test's board: Alpha, Beta
  synthDrag(
    "document.querySelector('.kb-lane .kb-lane-drag-handle')",
    "document.querySelector('.kb-lane')",
    "[...document.querySelectorAll('.kb-lane')][1]",
    "right"
  );

  waitFor(
    'dev:dom selector=".kb-lane-title" text all',
    (out) => out.indexOf("Beta") < out.indexOf("Alpha"),
    5000
  );
  const saved = waitFor(
    `read path="${DRAG_PATH}"`,
    (c) => c.indexOf("## Beta") < c.indexOf("## Alpha"),
    8000
  );
  assert.ok(saved.indexOf("## Beta") < saved.indexOf("## Alpha"), `Lane order not saved:\n${saved}`);

  try { cli(`delete path="${DRAG_PATH}" permanent`); } catch { /* already gone */ }
});

// ── Card menu, archive, lane actions, settings ──────────

const ACTIONS_FILE = "E2E Actions Test";
const ACTIONS_PATH = `${ACTIONS_FILE}.md`;

function openCardMenu(title: string) {
  evaluate(`${findCard(title)}.querySelector('.kb-menu-btn').click()`);
  sleep(300);
}

test("context menu: duplicate card", () => {
  try { cli(`delete path="${ACTIONS_PATH}" permanent`); } catch { /* didn't exist */ }
  const content = [
    "---",
    "kanban-plugin: board",
    "---",
    "",
    "## One",
    "- alpha",
    "- beta",
    "",
    "## Two",
    "- gamma",
    "",
  ].join("\\n");
  createNote(ACTIONS_FILE, content);
  showInHostLeaf(ACTIONS_PATH);
  waitForDom(".kb-lane", "2", 8000);

  openCardMenu("alpha");
  clickMenuItem("Duplicate card");
  const saved = waitFor(
    `read path="${ACTIONS_PATH}"`,
    (c) => (c.match(/- \[ \] alpha/g) || []).length === 2,
    8000
  );
  // The duplicate sits directly after the original, before beta
  assert.ok(
    /- \[ \] alpha\n- \[ \] alpha\n- \[ \] beta/.test(saved),
    `Duplicate not adjacent:\n${saved}`
  );
});

test("context menu: move to top", () => {
  openCardMenu("beta");
  clickMenuItem("Move to top");
  const saved = waitFor(
    `read path="${ACTIONS_PATH}"`,
    (c) => /## One\n- \[ \] beta/.test(c),
    8000
  );
  assert.ok(saved.indexOf("beta") < saved.indexOf("alpha"), `beta should be first:\n${saved}`);
});

test("checkbox: toggling a card checkbox writes [x]", () => {
  evaluate(
    "const p = app.plugins.plugins['minimalist-kanban']; p.settings.showCheckboxes = true; p.saveSettings()"
  );
  waitForDom(".kb-item-checkbox", "4", 5000);

  evaluate(`${findCard("beta")}.querySelector('.kb-item-checkbox').click()`);
  const saved = waitFor(
    `read path="${ACTIONS_PATH}"`,
    (c) => c.includes("- [x] beta"),
    8000
  );
  assert.ok(saved.includes("- [x] beta"), `Checkbox state not saved:\n${saved}`);

  evaluate(
    "const p = app.plugins.plugins['minimalist-kanban']; p.settings.showCheckboxes = false; p.saveSettings()"
  );
  waitFor('dev:dom selector=".kb-item-checkbox" total', (o) => o.includes("No elements found"), 5000);
});

test("lane rename via title edit", () => {
  evaluate(
    "[...document.querySelectorAll('.kb-lane-title')].find(t => t.textContent === 'Two').click()"
  );
  waitFor('dev:dom selector=".kb-lane-title-input" total', (o) => o.includes("1"), 3000);
  evaluate([
    "const inp = document.querySelector('.kb-lane-title-input')",
    "inp.value = 'Renamed'",
    "inp.dispatchEvent(new Event('input', {bubbles:true}))",
    "inp.dispatchEvent(new FocusEvent('blur'))",
  ].join("; "));
  const saved = waitFor(`read path="${ACTIONS_PATH}"`, (c) => c.includes("## Renamed"), 8000);
  assert.ok(!saved.includes("## Two"), `Old lane title still present:\n${saved}`);
});

test("archive card: undo restores it, redo-archive persists to file", () => {
  // Archive gamma, then undo
  openCardMenu("gamma");
  clickMenuItem("Archive card");
  waitForDom(".kb-undo-notice", "1", 3000);
  const toastText = domTextAll(".kb-undo-notice");
  assert.ok(toastText.includes("Card archived"), `Unexpected toast: ${toastText}`);
  evaluate("document.querySelector('.kb-undo-btn').click()");
  waitFor(
    'dev:dom selector=".kb-item-title" text all',
    (out) => out.includes("gamma"),
    3000
  );
  let saved = waitFor(
    `read path="${ACTIONS_PATH}"`,
    (c) => c.includes("gamma") && !c.includes("## Archive"),
    8000
  );
  assert.ok(/## Renamed\n- \[ \] gamma/.test(saved), `gamma not restored to its lane:\n${saved}`);

  // Archive again, this time letting it stand; show the archive lane
  evaluate(
    "const p = app.plugins.plugins['minimalist-kanban']; p.settings.showArchive = true; p.saveSettings()"
  );
  sleep(300);
  openCardMenu("gamma");
  clickMenuItem("Archive card");
  waitForDom(".kb-archive-lane", "1", 5000);
  const archiveText = domTextAll(".kb-archive-lane");
  assert.ok(archiveText.includes("gamma"), `Archive lane missing card: ${archiveText}`);

  saved = waitFor(`read path="${ACTIONS_PATH}"`, (c) => c.includes("## Archive"), 8000);
  assert.ok(
    /---\n\n## Archive\n- \[ \] gamma/.test(saved),
    `Archive section malformed:\n${saved}`
  );
});

test("archive card: restore returns it to the last lane", () => {
  evaluate("document.querySelector('.kb-archive-item .kb-menu-btn').click()");
  sleep(300);
  clickMenuItem("Restore card");
  const saved = waitFor(
    `read path="${ACTIONS_PATH}"`,
    (c) => !c.includes("## Archive"),
    8000
  );
  assert.ok(/## Renamed[\s\S]*- \[ \] gamma/.test(saved), `gamma not restored:\n${saved}`);

  evaluate(
    "const p = app.plugins.plugins['minimalist-kanban']; p.settings.showArchive = false; p.saveSettings()"
  );
});

test("lane delete shows undo toast and restores lane with cards", () => {
  // Delete the "Renamed" lane (holds gamma)
  evaluate(
    "[...document.querySelectorAll('.kb-lane')].find(l => l.querySelector('.kb-lane-title').textContent === 'Renamed').querySelector('.kb-lane-header .kb-menu-btn').click()"
  );
  sleep(300);
  clickMenuItem("Delete list");
  waitFor('dev:dom selector=".kb-lane" total', (o) => o.includes("1"), 5000);
  waitFor(`read path="${ACTIONS_PATH}"`, (c) => !c.includes("## Renamed"), 8000);

  waitForDom(".kb-undo-notice", "1", 3000);
  const toastText = domTextAll(".kb-undo-notice");
  assert.ok(toastText.includes('List "Renamed" deleted'), `Unexpected toast: ${toastText}`);
  evaluate("document.querySelector('.kb-undo-btn').click()");
  waitFor('dev:dom selector=".kb-lane" total', (o) => o.includes("2"), 5000);

  const saved = waitFor(`read path="${ACTIONS_PATH}"`, (c) => c.includes("## Renamed"), 8000);
  assert.ok(/## Renamed[\s\S]*- \[ \] gamma/.test(saved), `Lane restored without cards:\n${saved}`);

  try { cli(`delete path="${ACTIONS_PATH}" permanent`); } catch { /* already gone */ }
});

// ── Cleanup ─────────────────────────────────────────────

cleanup();
// Sweep every note the run created. Tests still delete their own boards inline
// where that matters for the next test, but an inline delete only runs if the
// test got that far — this catches what a thrown test left behind, so a
// failure never leaks into the git-tracked vault (or into the next run, where
// `create` would silently turn the leftover into a numbered duplicate).
for (const path of createdPaths) {
  try { cli(`delete path="${path}" permanent`); } catch { /* already gone */ }
}
// The host note is NOT swept: it is a committed fixture (see bootstrapHostLeaf)
// and createNote never registered it. Removing it here is what left the vault
// in a state where the next run's `create` silently made "_e2e_host 1.md".

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
