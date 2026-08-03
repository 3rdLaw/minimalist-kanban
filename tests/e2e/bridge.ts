/**
 * A launch-free transport for `eval`, `dev:dom`, `read`, `create` and `delete`.
 *
 * `obsidian <cmd>` is `flatpak run md.obsidian.Obsidian <cmd>`: a FULL app
 * launch that hands the command to the already-running instance over Electron's
 * single-instance IPC, then exits. Two costs follow from that, and both are
 * severe:
 *
 *   - The launch takes ~770ms cold, ~550ms amortised in a warm run. A kanban
 *     run makes 324 calls and took 2m50s; a fleet-tables run makes 974 and took
 *     8m59s — i.e. nearly the whole suite runtime was startup, not testing.
 *   - The launching instance takes focus before it quits. Measured: with
 *     Obsidian focused, `obsidian tabs` fires a window `blur` and hasFocus goes
 *     false. Hundreds of those per run is the window-raising that makes the
 *     machine unusable while the suite runs.
 *
 * None of those commands needs a process — every one has a direct equivalent
 * against the `app` object that is already loaded. This installs a poller
 * INSIDE the renderer (one launch, at bootstrap) that reads a request file and
 * writes a reply. ~24ms per call, and no launch at all.
 *
 * What is deliberately NOT bridged: `plugin:reload`/`enable`/`disable`, which
 * a disable+enable pair does not faithfully reproduce — with it bridged,
 * fleet-tables went 43/64, every failure in reading mode, search or sidecar
 * rendering. Also `plugins:enabled` and a plain (trashing) `delete`, which no
 * caller needs enough to be worth the risk. Together, ~3-6 calls a run.
 *
 * The request/reply files live under ~/.cache, deliberately NOT in the vault:
 * a vault write would fire Obsidian's own file-change events on every single
 * call and perturb the tests we are trying to measure. The flatpak has
 * `filesystems=home`, so both sides see the same path.
 *
 * Every failure path falls back to the CLI, so the bridge can only make the
 * suite faster, never less able to run. `E2E_NO_BRIDGE=1` forces the old path.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** How often the in-renderer poller looks for a new request. */
const POLL_MS = 20;

/** Matches the CLI's own 15s per-command ceiling. */
const REPLY_TIMEOUT_MS = 15_000;

/**
 * Ceiling for a command the caller has warned will reload the renderer. The
 * poller dies with the page, so there is nothing to wait for — this only needs
 * to outlast a reload that does NOT happen (a no-op emulateMobile call, say),
 * where the real reply still arrives.
 */
const RELOAD_TIMEOUT_MS = 3_000;

let dir = "";
let inPath = "";
let outPath = "";
/** Set by bridgeExpectReload() — consumed by the next bridged command. */
let expectReload = false;
let vaultName = "";
let seq = 0;
let installed = false;
/** Set once the bridge has failed; from then on every call takes the CLI path. */
let givenUp = Boolean(process.env.E2E_NO_BRIDGE);

/** Kinds to leave on the CLI path, for bisecting a behaviour change. */
const SKIP = (process.env.E2E_BRIDGE_SKIP ?? "").split(",").map((s) => s.trim());

export function initBridge(vault: string): void {
  vaultName = vault;
  dir = path.join(os.homedir(), ".cache", "obsidian-e2e", vault);
  inPath = path.join(dir, "in.json");
  outPath = path.join(dir, "out.json");
}

/**
 * Announce that the next bridged command will reload the renderer.
 *
 * `app.emulateMobile()` ends in `window.location.reload()`, which drops the
 * poller — so its reply never comes and the call would otherwise sit out the
 * full 15s ceiling, twice per kanban run.
 *
 * This is deliberately an explicit call rather than something inferred. The
 * first attempt used a heartbeat file and guessed "stale means dead", which
 * cannot distinguish a reloaded renderer from a busy one: a bridged
 * `plugin:reload` blocks the event loop for over 2s, so it was repeatedly
 * declared dead while working perfectly. A reload is something a test *does*,
 * on purpose, in one known place — so the test says so.
 */
export function bridgeExpectReload(): void {
  expectReload = true;
}

/** Sleep without spawning anything — `execSync("sleep")` would be a process per poll. */
function nap(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The poller, as source to run inside the renderer.
 *
 * Written with single quotes throughout: it gets embedded in a double-quoted
 * shell argument, and staying clear of `"` keeps that escaping trivial.
 */
function pollerSource(): string {
  return `(() => {
  const fs = require('fs');
  const IN = '${inPath}', OUT = '${outPath}';
  if (window.__e2eBridge) clearInterval(window.__e2eBridge);
  window.__e2eSeen = null;
  const reply = (id, out) => {
    try {
      fs.writeFileSync(OUT + '.tmp', JSON.stringify({ id: id, out: out }));
      fs.renameSync(OUT + '.tmp', OUT);
    } catch (e) { /* host will time out and fall back to the CLI */ }
  };
  window.__e2eBridge = setInterval(async () => {
    let req;
    try { req = JSON.parse(fs.readFileSync(IN, 'utf8')); } catch (e) { return; }
    if (!req || req.id === window.__e2eSeen) return;
    window.__e2eSeen = req.id;
    const notFound = (p) => 'Error: File ' + JSON.stringify(p) + ' not found.';
    let out;
    try {
      if (req.kind === 'read') {
        out = (await app.vault.adapter.exists(req.path))
          ? await app.vault.adapter.read(req.path)
          : notFound(req.path);
      } else if (req.kind === 'create') {
        // The CLI does not fail on a taken name: it succeeds having made
        // 'Name 1.md'. Replicated exactly, so a bridged run and a CLI run leave
        // the vault in the same state — including the trap that the callers'
        // path check exists to catch.
        let target = req.name + '.md';
        let n = 0;
        while (await app.vault.adapter.exists(target)) {
          n++;
          target = req.name + ' ' + n + '.md';
        }
        await app.vault.create(target, req.content);
        out = 'Created: ' + target;
      } else if (req.kind === 'delete') {
        const f = app.vault.getAbstractFileByPath(req.path);
        if (f) {
          // Permanent, matching 'delete ... permanent'. vault.delete keeps the
          // file cache in step, which adapter.remove alone would not.
          await app.vault.delete(f, true);
          out = 'Deleted permanently: ' + req.path;
        } else if (await app.vault.adapter.exists(req.path)) {
          await app.vault.adapter.remove(req.path);
          out = 'Deleted permanently: ' + req.path;
        } else {
          out = notFound(req.path);
        }
      } else if (req.kind === 'open') {
        const f = app.vault.getAbstractFileByPath(req.path);
        if (!f) out = notFound(req.path);
        else {
          // getLeaf(false) reuses the active leaf, or makes one when the suite
          // has detached them all. Unlike the CLI's open, this activates the
          // leaf WITHOUT raising the OS window — which is the whole point.
          await app.workspace.getLeaf(false).openFile(f);
          out = 'Opened: ' + req.path;
        }
      } else if (req.kind === 'command') {
        out = app.commands.executeCommandById(req.targetId)
          ? 'Executed: ' + req.targetId
          : 'Error: Command ' + JSON.stringify(req.targetId) +
            ' not found. Use \\'commands\\' to list available command IDs.';
      } else if (req.kind === 'dom') {
        const els = document.querySelectorAll(req.selector);
        if (!els.length) out = 'No elements found.';
        else if (req.mode === 'total') out = String(els.length);
        else if (req.all) out = Array.from(els).map(e => e.textContent || '').join('\\n');
        else out = els[0].textContent || '';
      } else {
        let v = (0, eval)(req.code);
        // The CLI resolves a promise that settles on the microtask queue but
        // returns nothing for one that takes real time (measured: a 800ms
        // promise prints no output). Racing a zero-delay timer reproduces that.
        if (v && typeof v.then === 'function') {
          v = await Promise.race([v, new Promise((r) => setTimeout(() => r(undefined), 0))]);
        }
        out = v === undefined ? ''
          : '=> ' + (v !== null && typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));
      }
    } catch (e) {
      out = 'Error: ' + ((e && e.message) || String(e));
    }
    reply(req.id, out);
  }, ${POLL_MS});
  return 'bridge-up';
})()`;
}

/**
 * Install the poller, retrying a couple of times before giving up on it.
 *
 * The retries are not decorative. Reinstalling straight after a renderer
 * reload races it: the `eval` lands while the page is still coming back and
 * returns nothing. Treating that single miss as fatal disabled the bridge for
 * the whole rest of the run — kanban went from 5 launches to 226, because
 * everything after the mobile test fell back to the CLI.
 */
function install(): boolean {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) nap(700);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.rmSync(outPath, { force: true });
      fs.rmSync(inPath, { force: true });
      const code = pollerSource().replace(/"/g, '\\"');
      const out = execSync(`obsidian vault="${vaultName}" eval code="${code}"`, {
        encoding: "utf-8",
        timeout: 20_000,
      });
      if (out.includes("bridge-up")) {
        installed = true;
        return true;
      }
    } catch {
      // Transport failure — same shapes cli() retries. Try again.
    }
  }
  return false;
}

interface Request {
  kind: "eval" | "dom" | "read" | "create" | "delete" | "open" | "command";
  code?: string;
  selector?: string;
  mode?: string;
  all?: boolean;
  path?: string;
  name?: string;
  content?: string;
  /**
   * Plugin or command id. NOT called `id`: the request is put on the wire as
   * `{ id, ...req }`, so a field called `id` here silently overwrites the
   * envelope's request id — the poller then answers correctly but tagged with
   * the plugin id, the host never matches it, and every such call sat out the
   * full 15s ceiling before falling back.
   */
  targetId?: string;
}

/**
 * Undo the two layers of escaping a CLI argument would have been through.
 *
 * `sh` strips the backslash from `\"` inside a double-quoted word, and the CLI
 * itself turns `\n`/`\t` into real whitespace in a *content* value — measured:
 * it does NOT do that inside `eval` code, where `'a\nb'.charCodeAt(1)` is 10.
 * So only `create` gets the second pass.
 */
const unshell = (s: string): string => s.replace(/\\"/g, '"');
const uncontent = (s: string): string => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");

/**
 * Recognise a bridgeable command. Anything else — `open`, `plugin:reload`, a
 * plain (trashing) `delete`, an unsupported dev:dom flag — returns null and
 * takes the CLI path unchanged, rather than guessing at its semantics.
 */
function parse(cmd: string): Request | null {
  const ev = /^eval code="([\s\S]*)"$/.exec(cmd);
  // The callers escape `"` as `\"` to survive the shell; undo that, since the
  // bridge hands the code over as JSON and never goes near a shell.
  if (ev) return { kind: "eval", code: unshell(ev[1]) };

  const rd = /^read path="([\s\S]*)"$/.exec(cmd);
  if (rd) return { kind: "read", path: unshell(rd[1]) };

  const cr = /^create name="([\s\S]*?)" content="([\s\S]*)"$/.exec(cmd);
  if (cr) return { kind: "create", name: unshell(cr[1]), content: uncontent(unshell(cr[2])) };

  const del = /^delete path="([\s\S]*?)" permanent$/.exec(cmd);
  if (del) return { kind: "delete", path: unshell(del[1]) };

  // `open` bridged deliberately: the CLI's version activates the OS window,
  // and openFile does the same job without touching the window manager.
  const op = /^open path="([\s\S]*)"$/.exec(cmd);
  if (op) return { kind: "open", path: unshell(op[1]) };

  // `plugin:reload` / `enable` / `disable` are deliberately NOT bridged.
  // `await disablePlugin(id); await enablePlugin(id)` looks equivalent and is
  // not: with it bridged, fleet-tables went 43/64, every failure in reading
  // mode, search or sidecar rendering — the features that hang off editor
  // extensions and markdown post-processors, which the CLI's reload evidently
  // restores and a bare disable/enable pair does not. It costs 2-5 launches a
  // run; that is a fair price for a reload that actually reloads.
  //
  // Callers write ids both ways — `id=fleet-table` and `id="fleet-table"` —
  // and the shell strips the quotes before the CLI sees them. Matching \S+
  // kept them, so executeCommandById('"...:toggle-kanban-view"') returned
  // false and the toggle silently never happened.
  const cm = /^command id="?([^"\s]+)"?$/.exec(cmd);
  if (cm) return { kind: "command", targetId: cm[1] };

  const dom = /^dev:dom selector="([\s\S]*?)"\s*([a-z\s]*)$/.exec(cmd);
  if (!dom) return null;
  const flags = dom[2].trim().split(/\s+/).filter(Boolean);
  if (flags.some((f) => f !== "total" && f !== "text" && f !== "all")) return null;
  return {
    kind: "dom",
    selector: unshell(dom[1]),
    mode: flags.includes("total") ? "total" : "text",
    all: flags.includes("all"),
  };
}

/**
 * Run `cmd` over the bridge, or return null to mean "not bridgeable, or the
 * bridge is not answering — use the CLI".
 */
export function bridgeTry(cmd: string, resent = false): string | null {
  if (givenUp) return null;
  const req = parse(cmd);
  if (!req) return null;
  // E2E_BRIDGE_SKIP="open,plugin" sends those kinds down the CLI path instead,
  // which is how you find out whether a bridged command changed behaviour.
  if (SKIP.includes(req.kind)) return null;
  if (!installed && !install()) {
    givenUp = true;
    return null;
  }

  const id = `${process.pid}-${++seq}`;
  try {
    fs.writeFileSync(`${inPath}.tmp`, JSON.stringify({ id, ...req }));
    fs.renameSync(`${inPath}.tmp`, inPath);
  } catch {
    givenUp = true;
    return null;
  }

  const readReply = (): string | null => {
    try {
      const reply = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      if (reply.id === id) return String(reply.out).trim();
    } catch {
      // No reply yet, or a torn read between write and rename — poll again.
    }
    return null;
  };

  const reloading = expectReload;
  expectReload = false;
  const deadline = Date.now() + (reloading ? RELOAD_TIMEOUT_MS : REPLY_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const reply = readReply();
    if (reply !== null) return reply;
    nap(2);
  }

  if (reloading) {
    // The page reloaded, taking the poller and the reply with it. The command
    // itself DID run — re-running it would toggle mobile emulation straight
    // back — so report the empty output the CLI gives for a call with no
    // return value, and let the next command reinstall.
    installed = false;
    return "";
  }

  // Silence with no reload announced: the renderer is wedged, or something
  // reloaded it without saying so. Reinstall once; if even that fails, hand
  // everything back to the CLI for the rest of the run.
  installed = false;
  if (!install()) {
    givenUp = true;
    return null;
  }
  const afterReinstall = readReply();
  if (afterReinstall !== null) return afterReinstall;
  return resent ? null : bridgeTry(cmd, true);
}

/** Stop the poller. Best effort — a leftover interval is harmless. */
export function stopBridge(): void {
  if (!installed) return;
  try {
    execSync(
      `obsidian vault="${vaultName}" eval code="clearInterval(window.__e2eBridge); window.__e2eBridge = null; 'stopped'"`,
      { encoding: "utf-8", timeout: 10_000 }
    );
  } catch {
    /* leaving it running costs one idle timer */
  }
  installed = false;
}
