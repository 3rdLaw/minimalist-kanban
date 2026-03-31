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
      if (attempt < retries && stderr.includes("event_origin_changed")) {
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

// ── Cleanup ─────────────────────────────────────────────

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
