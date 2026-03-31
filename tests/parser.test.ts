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
    expect(board.lanes[0].items[0].hasCheckbox).toBe(false);
    expect(board.lanes[0].items[0].checked).toBe(false);
  });

  test("parses unchecked checkbox items", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n## Col\n- [ ] Task\n"
    );
    const item = board.lanes[0].items[0];
    expect(item.title).toBe("Task");
    expect(item.hasCheckbox).toBe(true);
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
    expect(items[0].hasCheckbox).toBe(false);
    expect(items[1].hasCheckbox).toBe(true);
    expect(items[1].checked).toBe(false);
    expect(items[2].hasCheckbox).toBe(true);
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

  test("ignores items before any heading", () => {
    const board = parseBoard(
      "---\nkanban-plugin: board\n---\n\n- Orphan\n\n## Col\n- Real\n"
    );
    expect(board.lanes).toHaveLength(1);
    expect(board.lanes[0].items).toHaveLength(1);
    expect(board.lanes[0].items[0].title).toBe("Real");
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
            { id: "i1", title: "Task A", checked: false, hasCheckbox: false },
            { id: "i2", title: "Task B", checked: false, hasCheckbox: false },
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
            { id: "i1", title: "Open", checked: false, hasCheckbox: true },
            { id: "i2", title: "Done", checked: true, hasCheckbox: true },
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
              hasCheckbox: false,
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
        { id: "a1", title: "Archived", checked: false, hasCheckbox: false },
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
    expect(items[0]).toMatchObject({
      hasCheckbox: true,
      checked: false,
      title: "Open",
    });
    expect(items[1]).toMatchObject({
      hasCheckbox: true,
      checked: true,
      title: "Done",
    });
    expect(items[2]).toMatchObject({
      hasCheckbox: true,
      checked: false,
      title: "Plain",
    });
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
