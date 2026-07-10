import { describe, test, expect } from "vitest";
import { parseBoard, serializeBoard } from "../src/parser";
import type { Board } from "../src/types";

// ── parseBoard ───────────────────────────────────────────

describe("parseBoard", () => {
  test("parses empty board (frontmatter only)", () => {
    const board = parseBoard("---\nkanban-plugin: board\n---\n");
    expect(board.lanes).toHaveLength(0);
    expect(board.archive).toHaveLength(0);
  });

  test("parses lanes from ## headings", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## To Do\n\n## In Progress\n\n## Done\n"
    );
    expect(board.lanes).toHaveLength(3);
    expect(board.lanes.map((l) => l.title)).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ]);
  });

  test("parses plain list items", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Col\n- Alpha\n- Beta\n"
    );
    expect(board.lanes[0].items).toHaveLength(2);
    expect(board.lanes[0].items[0].title).toBe("Alpha");
    expect(board.lanes[0].items[0].checked).toBe(false);
  });

  test("parses unchecked checkbox items", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Col\n- [ ] Task\n"
    );
    const item = board.lanes[0].items[0];
    expect(item.title).toBe("Task");
    expect(item.checked).toBe(false);
  });

  test("parses checked checkbox items", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Col\n- [x] Done\n- [X] Also done\n"
    );
    expect(board.lanes[0].items[0].checked).toBe(true);
    expect(board.lanes[0].items[1].checked).toBe(true);
  });

  test("parses mixed plain and checkbox items", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Col\n- Plain\n- [ ] Unchecked\n- [x] Checked\n"
    );
    const items = board.lanes[0].items;
    expect(items[0].checked).toBe(false);
    expect(items[1].checked).toBe(false);
    expect(items[2].checked).toBe(true);
  });

  test("parses multi-line items (continuation lines)", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- Line one",
      "  Line two",
      "  Line three",
      "- Next item",
    ].join("\n");
    const items = parseBoard(md).lanes[0].items;
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Line one\nLine two\nLine three");
    expect(items[1].title).toBe("Next item");
  });

  test("parses archive section", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Active",
      "- Task",
      "",
      "---",
      "",
      "## Archive",
      "- Old task",
      "- [x] Ancient",
    ].join("\n");
    const board = parseBoard(md);
    expect(board.lanes).toHaveLength(1);
    expect(board.lanes[0].title).toBe("Active");
    expect(board.archive).toHaveLength(2);
    expect(board.archive[0].title).toBe("Old task");
    expect(board.archive[1].checked).toBe(true);
  });

  test("handles board with no archive", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Col\n- Item\n"
    );
    expect(board.archive).toHaveLength(0);
  });

  test("handles empty lanes", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Empty\n\n## Also Empty\n"
    );
    expect(board.lanes).toHaveLength(2);
    expect(board.lanes[0].items).toHaveLength(0);
    expect(board.lanes[1].items).toHaveLength(0);
  });

  test("items before any heading become preamble text, not cards", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n- Orphan\n\n## Col\n- Real\n"
    );
    expect(board.lanes).toHaveLength(1);
    expect(board.lanes[0].items).toHaveLength(1);
    expect(board.lanes[0].items[0].title).toBe("Real");
    expect(board.preamble).toEqual(["- Orphan"]);
  });

  test("assigns unique ids", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## A\n- One\n- Two\n## B\n- Three\n"
    );
    const ids = [
      board.lanes[0].id,
      board.lanes[1].id,
      ...board.lanes[0].items.map((i) => i.id),
      ...board.lanes[1].items.map((i) => i.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("handles * bullet character", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Col\n* Star bullet\n"
    );
    expect(board.lanes[0].items[0].title).toBe("Star bullet");
  });
});

// ── serializeBoard ───────────────────────────────────────

describe("serializeBoard", () => {
  function makeBoard(overrides?: Partial<Board>): Board {
    return {
      lanes: [
        {
          id: "l1",
          title: "To Do",
          items: [
            { id: "i1", title: "Task A", checked: false },
            { id: "i2", title: "Task B", checked: false },
          ],
        },
      ],
      archive: [],
      ...overrides,
    };
  }

  test("serializes basic board with frontmatter", () => {
    const md = serializeBoard(makeBoard());
    expect(md).toContain("---\nkanban-plugin: board\n---");
    expect(md).toContain("## To Do");
    expect(md).toContain("- [ ] Task A");
    expect(md).toContain("- [ ] Task B");
  });

  test("serializes checkbox items", () => {
    const board = makeBoard({
      lanes: [
        {
          id: "l1",
          title: "Col",
          items: [
            { id: "i1", title: "Open", checked: false },
            { id: "i2", title: "Done", checked: true },
          ],
        },
      ],
    });
    const md = serializeBoard(board);
    expect(md).toContain("- [ ] Open");
    expect(md).toContain("- [x] Done");
  });

  test("serializes multi-line items with indentation", () => {
    const board = makeBoard({
      lanes: [
        {
          id: "l1",
          title: "Col",
          items: [
            {
              id: "i1",
              title: "First\nSecond\nThird",
              checked: false,
            },
          ],
        },
      ],
    });
    const md = serializeBoard(board);
    expect(md).toContain("- [ ] First\n  Second\n  Third");
  });

  test("serializes archive section when present", () => {
    const board = makeBoard({
      archive: [
        { id: "a1", title: "Archived", checked: false },
      ],
    });
    const md = serializeBoard(board);
    expect(md).toContain("---\n\n## Archive\n- [ ] Archived");
  });

  test("omits archive section when empty", () => {
    const md = serializeBoard(makeBoard());
    expect(md).not.toContain("Archive");
    // Should not contain the --- separator for archive
    const lines = md.split("\n");
    const dashLines = lines.filter((l) => l === "---");
    // Only the frontmatter delimiters
    expect(dashLines).toHaveLength(2);
  });
});

// ── Round-trip ───────────────────────────────────────────

describe("round-trip (parse → serialize → parse)", () => {
  test("preserves basic board", () => {
    const original =
      "---\nkanban-plugin: board\n---\n\n## To Do\n- Task one\n- Task two\n\n## Done\n- Finished\n";
    const board = parseBoard(original);
    const serialized = serializeBoard(board);
    const reparsed = parseBoard(serialized);

    expect(reparsed.lanes.map((l) => l.title)).toEqual(
      board.lanes.map((l) => l.title)
    );
    expect(reparsed.lanes[0].items.map((i) => i.title)).toEqual(
      board.lanes[0].items.map((i) => i.title)
    );
  });

  test("preserves multi-line items", () => {
    const original = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- Line 1",
      "  Line 2",
      "",
    ].join("\n");
    const reparsed = parseBoard(serializeBoard(parseBoard(original)));
    expect(reparsed.lanes[0].items[0].title).toBe("Line 1\nLine 2");
  });

  test("preserves checkbox state", () => {
    const original =
      "---\nkanban-plugin: board\n---\n\n## Col\n- [ ] Open\n- [x] Done\n- Plain\n";
    const reparsed = parseBoard(serializeBoard(parseBoard(original)));
    const items = reparsed.lanes[0].items;
    expect(items[0]).toMatchObject({ checked: false, title: "Open" });
    expect(items[1]).toMatchObject({ checked: true, title: "Done" });
    // Plain bullets are normalized to (unchecked) tasks on save
    expect(items[2]).toMatchObject({ checked: false, title: "Plain" });
  });

  test("preserves archive section", () => {
    const original = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Active",
      "- Task",
      "",
      "---",
      "",
      "## Archive",
      "- Old",
      "",
    ].join("\n");
    const reparsed = parseBoard(serializeBoard(parseBoard(original)));
    expect(reparsed.lanes).toHaveLength(1);
    expect(reparsed.archive).toHaveLength(1);
    expect(reparsed.archive[0].title).toBe("Old");
  });
});

// ── Structure injection via card text ────────────────────

describe("card text containing structural markers", () => {
  test("card text with a --- line survives round-trip without corrupting the board", () => {
    const board: Board = {
      lanes: [
        {
          id: "l1",
          title: "Col",
          items: [{ id: "i1", title: "progress\n---\nstill here", checked: false }],
        },
        { id: "l2", title: "Other", items: [{ id: "i2", title: "two", checked: false }] },
      ],
      archive: [],
    };
    const reparsed = parseBoard(serializeBoard(board));
    expect(reparsed.lanes).toHaveLength(2);
    expect(reparsed.archive).toHaveLength(0);
    expect(reparsed.lanes[0].items[0].title).toBe("progress\n---\nstill here");
    expect(reparsed.lanes[1].items[0].title).toBe("two");
  });

  test("card text with a ## line does not create a phantom lane", () => {
    const board: Board = {
      lanes: [
        {
          id: "l1",
          title: "Col",
          items: [{ id: "i1", title: "note\n## Not A Lane", checked: false }],
        },
      ],
      archive: [],
    };
    const reparsed = parseBoard(serializeBoard(board));
    expect(reparsed.lanes).toHaveLength(1);
    expect(reparsed.lanes[0].items[0].title).toBe("note\n## Not A Lane");
  });

  test("card text with ## Archive does not start the archive section", () => {
    const board: Board = {
      lanes: [
        {
          id: "l1",
          title: "Col",
          items: [
            { id: "i1", title: "tricky\n---\n## Archive", checked: false },
            { id: "i2", title: "after", checked: false },
          ],
        },
      ],
      archive: [],
    };
    const reparsed = parseBoard(serializeBoard(board));
    expect(reparsed.archive).toHaveLength(0);
    expect(reparsed.lanes[0].items).toHaveLength(2);
    expect(reparsed.lanes[0].items[0].title).toBe("tricky\n---\n## Archive");
  });
});

// ── Content preservation ─────────────────────────────────

describe("content preservation", () => {
  test("preserves extra frontmatter keys", () => {
    const md =
      "---\nkanban-plugin: board\ntags: [project, q2]\naliases: [Sprint Board]\n---\n\n## To Do\n- task\n";
    const out = serializeBoard(parseBoard(md));
    expect(out).toContain("tags: [project, q2]");
    expect(out).toContain("aliases: [Sprint Board]");
    expect(out).toContain("kanban-plugin: board");
  });

  test("adds default frontmatter when the file has none", () => {
    const board = parseBoard("## A\n- x\n");
    expect(board.lanes).toHaveLength(1);
    expect(serializeBoard(board)).toMatch(/^---\nkanban-plugin: board\n---\n/);
  });

  test("frontmatter is only recognized at the start of the document", () => {
    const md = "\n---\nkanban-plugin: board\n---\n\n## A\n- x\n";
    const board = parseBoard(md);
    expect(board.frontmatter).toBeUndefined();
    expect(board.lanes.map((l) => l.title)).toEqual(["A"]);
    // The stray --- block is kept as preamble text
    expect(board.preamble).toContain("kanban-plugin: board");
  });

  test("a --- not followed by ## Archive is a thematic break, not the archive separator", () => {
    const md =
      "---\nkanban-plugin: board\n---\n\n## A\n- one\n\n---\n\n## B\n- two\n";
    const board = parseBoard(md);
    expect(board.lanes.map((l) => l.title)).toEqual(["A", "B"]);
    expect(board.archive).toHaveLength(0);
    // ...and it survives the round-trip
    const out = serializeBoard(board);
    expect(out).toContain("---");
    const reparsed = parseBoard(out);
    expect(reparsed.lanes.map((l) => l.title)).toEqual(["A", "B"]);
  });

  test("code fence content is not parsed as cards or lanes", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- real card",
      "",
      "```js",
      "- not a card",
      "## not a lane",
      "```",
      "",
    ].join("\n");
    const board = parseBoard(md);
    expect(board.lanes).toHaveLength(1);
    expect(board.lanes[0].items).toHaveLength(1);
    const out = serializeBoard(board);
    expect(out).toContain("- not a card");
    expect(out).toContain("## not a lane");
    const reparsed = parseBoard(out);
    expect(reparsed.lanes).toHaveLength(1);
    expect(reparsed.lanes[0].items).toHaveLength(1);
  });

  test("text before the first lane is preserved as preamble", () => {
    const md =
      "---\nkanban-plugin: board\n---\n\nSome intro the user wrote.\n\n## To Do\n- task\n";
    const out = serializeBoard(parseBoard(md));
    expect(out).toContain("Some intro the user wrote.");
    // Stable across a second round-trip
    expect(serializeBoard(parseBoard(out))).toBe(out);
  });

  test("unrecognized lines under a lane are preserved", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- card",
      "",
      "### Subheading note",
      "Free paragraph here.",
      "",
    ].join("\n");
    const out = serializeBoard(parseBoard(md));
    expect(out).toContain("### Subheading note");
    expect(out).toContain("Free paragraph here.");
    const reparsed = parseBoard(out);
    expect(reparsed.lanes[0].items).toHaveLength(1);
    expect(serializeBoard(reparsed)).toBe(out);
  });

  test("keeps unrecognized content between the cards it originally separated", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- first",
      "> Supporting callout for first",
      "- second",
    ].join("\n");
    const out = serializeBoard(parseBoard(md));
    expect(out.indexOf("- [ ] first")).toBeLessThan(out.indexOf("> Supporting callout"));
    expect(out.indexOf("> Supporting callout")).toBeLessThan(out.indexOf("- [ ] second"));
  });

  test("preserves blank lines and indentation inside a card", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- first",
      "    indented code",
      "",
      "- second",
    ].join("\n");
    const out = serializeBoard(parseBoard(md));
    expect(out).toContain("- [ ] first\n    indented code\n\n- [ ] second");
  });

  test("preserves headings written after the archive marker", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- active",
      "---",
      "## Archive",
      "- old",
      "## Archive notes",
      "Retain this text.",
    ].join("\n");
    const out = serializeBoard(parseBoard(md));
    expect(out).toContain("## Archive notes");
    expect(out).toContain("Retain this text.");
  });

  test("a card with an interior blank line survives a save/reload cycle", () => {
    // A user can type a blank line between paragraphs while editing a card;
    // the blank continuation must not split the card on re-parse.
    const board = parseBoard("---\nkanban-plugin: board\n---\n\n## Col\n- seed\n");
    board.lanes[0].items[0].title = "para one\n\npara two";
    const out = serializeBoard(board);
    const reparsed = parseBoard(out);
    expect(reparsed.lanes[0].items).toHaveLength(1);
    expect(reparsed.lanes[0].items[0].title).toBe("para one\n\npara two");
    expect(serializeBoard(reparsed)).toBe(out);
  });

  test("a whitespace-only indented line stays inside the card", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- first",
      "  ",
      "  more",
      "- second",
      "",
    ].join("\n");
    const board = parseBoard(md);
    expect(board.lanes[0].items.map((i) => i.title)).toEqual([
      "first\n\nmore",
      "second",
    ]);
    const out = serializeBoard(board);
    expect(out).toContain("- [ ] first\n  \n  more\n- [ ] second");
    expect(serializeBoard(parseBoard(out))).toBe(out);
  });

  test("tab-indented continuation lines belong to the card", () => {
    const md = "---\nkanban-plugin: board\n---\n\n## Col\n- first\n\tmore\n";
    const board = parseBoard(md);
    expect(board.lanes[0].items[0].title).toBe("first\nmore");
    // Tab indentation normalizes to two spaces on the first save, then stable.
    const out = serializeBoard(board);
    expect(out).toContain("- [ ] first\n  more");
    expect(serializeBoard(parseBoard(out))).toBe(out);
  });

  test("CRLF input parses cleanly and normalizes to LF on save", () => {
    const md =
      "---\r\nkanban-plugin: board\r\n---\r\n\r\n## Col\r\n- first\r\n  second\r\n\r\n> note\r\n";
    const board = parseBoard(md);
    expect(board.lanes[0].items[0].title).toBe("first\nsecond");
    const out = serializeBoard(board);
    expect(out).not.toContain("\r");
    expect(out).toContain("- [ ] first\n  second\n\n> note");
    expect(serializeBoard(parseBoard(out))).toBe(out);
  });

  test("blank lines between preamble paragraphs survive a save", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "Intro paragraph one.",
      "",
      "Intro paragraph two.",
      "",
      "## Col",
      "- a",
      "",
    ].join("\n");
    const out = serializeBoard(parseBoard(md));
    expect(out).toContain("Intro paragraph one.\n\nIntro paragraph two.");
    expect(serializeBoard(parseBoard(out))).toBe(out);
  });

  test("empty checkbox lines are preserved rather than dropped", () => {
    const md = "---\nkanban-plugin: board\n---\n\n## Col\n- [ ]\n";
    const board = parseBoard(md);
    expect(board.lanes[0].items).toHaveLength(0);
    expect(serializeBoard(board)).toContain("- [ ]");
  });

  test("extra lines in the archive section are preserved", () => {
    const md = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## Col",
      "- card",
      "",
      "---",
      "",
      "## Archive",
      "- old",
      "",
      "a note about the archive",
      "",
    ].join("\n");
    const board = parseBoard(md);
    expect(board.archive).toHaveLength(1);
    expect(board.archiveExtra?.flatMap((block) => block.lines)).toContain(
      "a note about the archive"
    );
    const out = serializeBoard(board);
    expect(out).toContain("a note about the archive");
    expect(serializeBoard(parseBoard(out))).toBe(out);
  });
});
