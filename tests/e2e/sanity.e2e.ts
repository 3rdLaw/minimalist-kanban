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
      // Retry on Flatpak/systemd transient crashes
      if (attempt < retries && (stderr.includes("event_origin_changed") || stderr.includes("zypak-helper"))) {
        sleep(300);
        continue;
      }
      throw new Error(`CLI failed: ${full}\nstdout: ${stdout}\nstderr: ${stderr}`);
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

function cleanup() {
  try {
    cli(`delete path="${TEST_PATH}" permanent`);
  } catch {
    // file doesn't exist
  }
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
  cli(`create name="${TEST_FILE}" content="${KANBAN_CONTENT}" open`);
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
    console.log(`        ${err.message.split("\n")[0]}`);
    failed++;
  }
}

// ── Tests ───────────────────────────────────────────────

console.log("\n=== e2e tests ===\n");

cleanup();

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

test("link suggest: [[ triggers file autocomplete in card edit", () => {
  // Create a target note for the suggest to find
  cli(`create name="Link Target" content="# Important Section\\nSome content"`);
  sleep(1000);

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
  sleep(500);

  // Verify suggest popup shows "Link Target"
  const suggestText = domTextAll(".kb-link-suggest .suggestion-title");
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
  // Use the board file itself — its ## headings are already indexed
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
  sleep(500);

  // Verify heading suggestions appear
  const headings = domTextAll(".kb-link-suggest .suggestion-title");
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

  // Clean up the helper note
  try { cli('delete path="Link Target.md" permanent'); } catch {}
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
    cli(`create name="${FILE}" content="${content}" open`);
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
    cli(`create name="${FILE}" content="${content}" open`);
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
  cli(`create name="${DRAG_FILE}" content="${content}" open`);
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
  cli(`create name="${ACTIONS_FILE}" content="${content}" open`);
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

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
