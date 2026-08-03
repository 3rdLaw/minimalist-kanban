/**
 * A launch-free transport for `eval` and `dev:dom`.
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
 * `eval` and `dev:dom` are 86% of the calls and neither needs a process. This
 * installs a poller INSIDE the renderer (one launch, at bootstrap) that reads a
 * request file and writes a reply. ~24ms per call, and no launch at all.
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

let dir = "";
let inPath = "";
let outPath = "";
let vaultName = "";
let seq = 0;
let installed = false;
/** Set once the bridge has failed; from then on every call takes the CLI path. */
let givenUp = Boolean(process.env.E2E_NO_BRIDGE);

export function initBridge(vault: string): void {
  vaultName = vault;
  dir = path.join(os.homedir(), ".cache", "obsidian-e2e", vault);
  inPath = path.join(dir, "in.json");
  outPath = path.join(dir, "out.json");
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
    let out;
    try {
      if (req.kind === 'dom') {
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

function install(): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.rmSync(outPath, { force: true });
    fs.rmSync(inPath, { force: true });
    const code = pollerSource().replace(/"/g, '\\"');
    const out = execSync(`obsidian vault="${vaultName}" eval code="${code}"`, {
      encoding: "utf-8",
      timeout: 20_000,
    });
    installed = out.includes("bridge-up");
    return installed;
  } catch {
    return false;
  }
}

interface Request {
  kind: "eval" | "dom";
  code?: string;
  selector?: string;
  mode?: string;
  all?: boolean;
}

/**
 * Recognise the two bridgeable commands. Anything else — create, delete, open,
 * plugin:reload, an unsupported dev:dom flag — returns null and takes the CLI
 * path unchanged.
 */
function parse(cmd: string): Request | null {
  const ev = /^eval code="([\s\S]*)"$/.exec(cmd);
  // The callers escape `"` as `\"` to survive the shell; undo that, since the
  // bridge hands the code over as JSON and never goes near a shell.
  if (ev) return { kind: "eval", code: ev[1].replace(/\\"/g, '"') };

  const dom = /^dev:dom selector="([\s\S]*?)"\s*([a-z\s]*)$/.exec(cmd);
  if (!dom) return null;
  const flags = dom[2].trim().split(/\s+/).filter(Boolean);
  if (flags.some((f) => f !== "total" && f !== "text" && f !== "all")) return null;
  return {
    kind: "dom",
    selector: dom[1].replace(/\\"/g, '"'),
    mode: flags.includes("total") ? "total" : "text",
    all: flags.includes("all"),
  };
}

/**
 * Run `cmd` over the bridge, or return null to mean "not bridgeable, or the
 * bridge is not answering — use the CLI".
 */
export function bridgeTry(cmd: string): string | null {
  if (givenUp) return null;
  const req = parse(cmd);
  if (!req) return null;
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

  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const reply = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      if (reply.id === id) return String(reply.out).trim();
    } catch {
      // No reply yet, or a torn read between write and rename — poll again.
    }
    nap(2);
  }

  // No answer in 15s: the window was reloaded (which drops the interval), or
  // Obsidian is wedged. Reinstall once; if that fails, fall back for good.
  installed = false;
  if (!install()) givenUp = true;
  return null;
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
