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

  // Verify suggest popup is hidden
  const display = evaluate(
    "document.querySelector('.kb-link-suggest').style.display"
  );
  assert.ok(display.includes("none"), "Suggest should be hidden after accept");

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

// ── Cleanup ─────────────────────────────────────────────

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
