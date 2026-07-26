import { describe, test, expect } from "vitest";
import { parseBoard, serializeBoard } from "../src/parser";
import type { Board } from "../src/types";

/**
 * Property tests for the two invariants the parser exists to uphold:
 *
 *   1. Idempotence — serializing a parsed board is a fixed point. One save
 *      may normalize the file; a second save must not change it again.
 *   2. Opaque preservation — a line the parser does not recognize as board
 *      structure is re-emitted byte-for-byte, indentation included.
 *
 * Statement coverage cannot see these. They are asserted over a corpus of
 * adversarial documents plus a seeded fuzzer so future parser changes have
 * to keep holding them.
 */

/** Structure minus the random ids, which differ on every parse. */
function shape(board: Board) {
  return {
    frontmatter: board.frontmatter,
    preamble: board.preamble,
    lanes: board.lanes.map((lane) => ({
      title: lane.title,
      items: lane.items.map((item) => ({ title: item.title, checked: item.checked })),
      extra: (lane.extra ?? []).map((block) => block.lines),
    })),
    archive: board.archive.map((item) => ({ title: item.title, checked: item.checked })),
    archiveExtra: (board.archiveExtra ?? []).map((block) => block.lines),
  };
}

function assertIdempotent(markdown: string, label: string) {
  const first = serializeBoard(parseBoard(markdown));
  const second = serializeBoard(parseBoard(first));
  expect(second, `${label}: second save changed the file again`).toBe(first);
  expect(
    shape(parseBoard(second)),
    `${label}: board structure drifted on re-parse`
  ).toEqual(shape(parseBoard(first)));
}

const FM = ["---", "kanban-plugin: board", "---", ""];

function doc(...body: string[]): string {
  return [...FM, ...body, ""].join("\n");
}

/**
 * `verbatim` lists lines that are opaque content: they must survive a save
 * with their exact original indentation. `lanes` and `archive` pin down the
 * structure the parser is allowed to see — a line surviving verbatim is not
 * enough if it was also promoted into a phantom lane.
 *
 * Lines indented three spaces or less are *not* listed as verbatim even when
 * they look like prose — CommonMark treats up to three leading spaces as a
 * top-level construct, so the parser is right to promote them to board
 * structure and re-emit them at column zero.
 */
const CORPUS: {
  name: string;
  markdown: string;
  verbatim?: string[];
  lanes?: string[];
  items?: number[];
  archive?: number;
}[] = [
  {
    name: "YAML literal block scalar containing ---",
    markdown: [
      "---",
      "kanban-plugin: board",
      "description: |",
      "  ---",
      "  retained text",
      "---",
      "",
      "## Todo",
      "- [ ] card",
      "",
    ].join("\n"),
    lanes: ["Todo"], items: [1], archive: 0,
  },
  {
    name: "YAML folded block scalar containing --- and a heading",
    markdown: [
      "---",
      "kanban-plugin: board",
      "notes: >",
      "  ---",
      "  ## not a lane",
      "  more",
      "aliases: [Board]",
      "---",
      "",
      "## Todo",
      "- [ ] card",
      "",
    ].join("\n"),
    lanes: ["Todo"], items: [1], archive: 0,
  },
  {
    name: "four-space indented code block after a blank line",
    markdown: doc("## Todo", "- [ ] card", "", "    ## This is indented code", "    plain text"),
    lanes: ["Todo"], items: [1], archive: 0,
    verbatim: ["    ## This is indented code", "    plain text"],
  },
  {
    name: "tab-indented code block after a blank line",
    markdown: doc("## Todo", "- [ ] card", "", "\t## tab indented", "\t- not a card"),
    lanes: ["Todo"], items: [1], archive: 0,
    verbatim: ["\t## tab indented", "\t- not a card"],
  },
  {
    name: "indented thematic break before an Archive heading",
    markdown: doc("## Todo", "- [ ] card", "", "    ---", "    ## Archive", "    - [ ] not archived"),
    lanes: ["Todo"], items: [1], archive: 0,
    verbatim: ["    ---", "    ## Archive", "    - [ ] not archived"],
  },
  {
    name: "indented code block in the preamble",
    markdown: doc("Intro paragraph.", "", "    indented code in preamble", "", "## Todo", "- [ ] card"),
    lanes: ["Todo"], items: [1], archive: 0,
    verbatim: ["    indented code in preamble"],
  },
  {
    name: "backtick fence containing a tilde fence",
    markdown: doc("## Todo", "```js", "~~~", "## This is still code", "```", ""),
    lanes: ["Todo"], items: [0], archive: 0,
    verbatim: ["```js", "~~~", "## This is still code", "```"],
  },
  {
    name: "tilde fence containing a backtick fence",
    markdown: doc("## Todo", "~~~", "```", "## still code", "~~~", ""),
    lanes: ["Todo"], items: [0], archive: 0,
    verbatim: ["~~~", "```", "## still code", "~~~"],
  },
  {
    name: "long fence containing a shorter fence",
    markdown: doc("## Todo", "````", "```", "## still code", "- [ ] not a card", "````", ""),
    lanes: ["Todo"], items: [0], archive: 0,
    verbatim: ["````", "```", "## still code", "- [ ] not a card", "````"],
  },
  {
    name: "fence closed by a longer run of the same marker",
    markdown: doc("## Todo", "```", "## still code", "`````", ""),
    lanes: ["Todo"], items: [0], archive: 0,
    verbatim: ["```", "## still code", "`````"],
  },
  {
    name: "indented fence inside a lane",
    markdown: doc("## Todo", "- [ ] card", "", "    ```", "    ## still code", "    ```"),
    lanes: ["Todo"], items: [1], archive: 0,
    verbatim: ["    ```", "    ## still code", "    ```"],
  },
  {
    name: "unclosed fence at end of document",
    markdown: doc("## Todo", "- [ ] card", "", "```js", "## never closed"),
    lanes: ["Todo"], items: [1], archive: 0,
    verbatim: ["```js", "## never closed"],
  },
  {
    name: "card text carrying structural markers",
    markdown: doc("## Todo", "- [ ] first line", "  ---", "  ## Archive", "  ```", "- [ ] second"),
    lanes: ["Todo"], items: [2], archive: 0,
  },
  {
    name: "real archive section",
    markdown: doc("## Active", "- [ ] task", "", "---", "", "## Archive", "- [x] old"),
    lanes: ["Active"], items: [1], archive: 1,
  },
  {
    name: "archive with trailing prose",
    markdown: doc(
      "## Active",
      "- [ ] task",
      "",
      "---",
      "",
      "## Archive",
      "- [x] old",
      "",
      "Some closing note.",
      "",
      "    indented note"
    ),
    lanes: ["Active"], items: [1], archive: 1,
    verbatim: ["Some closing note.", "    indented note"],
  },
  {
    name: "thematic break between lanes",
    markdown: doc("## A", "- [ ] one", "", "---", "", "## B", "- [ ] two"),
    lanes: ["A", "B"], items: [1, 1], archive: 0,
  },
  {
    name: "no frontmatter",
    markdown: ["## Todo", "- [ ] card", ""].join("\n"),
    lanes: ["Todo"], items: [1], archive: 0,
  },
  {
    name: "frontmatter only",
    markdown: ["---", "kanban-plugin: board", "---", ""].join("\n"),
    lanes: [], items: [], archive: 0,
  },
  {
    name: "empty document",
    markdown: "",
    lanes: [], items: [], archive: 0,
  },
  {
    name: "CRLF line endings",
    markdown: ["---", "kanban-plugin: board", "---", "", "## Todo", "- [ ] card", ""].join("\r\n"),
    lanes: ["Todo"], items: [1], archive: 0,
  },
  {
    name: "delimiters with trailing whitespace",
    markdown: ["---  ", "kanban-plugin: board", "---\t", "", "## Todo", "- [ ] card", ""].join("\n"),
    lanes: ["Todo"], items: [1], archive: 0,
  },
  {
    name: "bare checkbox and empty bullets",
    markdown: doc("## Todo", "- [ ]", "- [ ] real", "-"),
    lanes: ["Todo"], items: [1], archive: 0,
  },
  {
    name: "multiple paragraphs of preamble",
    markdown: doc("First paragraph.", "", "Second paragraph.", "", "## Todo", "- [ ] card"),
    lanes: ["Todo"], items: [1], archive: 0,
    verbatim: ["First paragraph.", "Second paragraph."],
  },
];

describe("property: one save is a fixed point", () => {
  for (const { name, markdown } of CORPUS) {
    test(name, () => assertIdempotent(markdown, name));
  }
});

describe("property: only real board syntax becomes structure", () => {
  for (const { name, markdown, lanes, items, archive } of CORPUS) {
    if (!lanes) continue;
    test(name, () => {
      const board = parseBoard(markdown);
      expect(board.lanes.map((l) => l.title), `${name}: wrong lanes`).toEqual(lanes);
      if (items) {
        expect(board.lanes.map((l) => l.items.length), `${name}: wrong card counts`).toEqual(items);
      }
      if (archive !== undefined) {
        expect(board.archive, `${name}: wrong archive`).toHaveLength(archive);
      }
    });
  }
});

describe("property: opaque content survives verbatim", () => {
  for (const { name, markdown, verbatim } of CORPUS) {
    if (!verbatim) continue;
    test(name, () => {
      const out = serializeBoard(parseBoard(markdown));
      const outLines = out.split("\n");
      for (const line of verbatim) {
        expect(outLines, `${name}: lost or reindented ${JSON.stringify(line)}`).toContain(line);
      }
    });
  }
});

describe("property: frontmatter body survives verbatim", () => {
  for (const { name, markdown } of CORPUS) {
    test(name, () => {
      const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
      if (!match) return;
      const original = match[1].split(/\r?\n/);
      expect(parseBoard(markdown).frontmatter, name).toEqual(original);
    });
  }
});

// ── Fuzz ─────────────────────────────────────────────────

/** Deterministic LCG so a failure is always reproducible from its seed. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const ALPHABET = [
  "## Lane",
  "## Archive",
  "- [ ] card",
  "- [x] done",
  "- plain bullet",
  "- [ ]",
  "",
  "---",
  "  ---",
  "    ---",
  "```",
  "```js",
  "~~~",
  "````",
  "  ```",
  "    ```",
  "prose line",
  "  two space indent",
  "    four space indent",
  "\ttab indent",
  "  - nested bullet",
  "    - deep bullet",
  "  continuation text",
  "# H1",
  "### H3",
  "> quote",
  "| a | b |",
];

describe("property: fuzzed documents are stable under a second save", () => {
  test("300 seeded documents", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = lcg(seed);
      const length = 1 + Math.floor(rand() * 14);
      const body: string[] = [];
      for (let i = 0; i < length; i++) {
        body.push(ALPHABET[Math.floor(rand() * ALPHABET.length)]);
      }
      // Half the documents get frontmatter, half start straight into content.
      const markdown = (rand() < 0.5 ? [...FM, ...body] : body).join("\n") + "\n";
      assertIdempotent(markdown, `seed ${seed}:\n${markdown}`);
    }
  });
});
