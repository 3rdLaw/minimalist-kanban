import { describe, test, expect } from "vitest";
import { parseBoard, serializeBoard } from "../src/parser";
import { reconcileIds } from "../src/reconcile";

const FM = ["---", "kanban-plugin: board", "---", ""];

function doc(...body: string[]): string {
  return [...FM, ...body, ""].join("\n");
}

const BASE = doc(
  "## To Do",
  "- [ ] Task A",
  "> note under A",
  "- [ ] Task B",
  "",
  "## Doing",
  "- [ ] Task C",
  "",
  "## Done",
  "- [x] Task D",
  "",
  "---",
  "",
  "## Archive",
  "",
  "- [x] Old",
  "> note under Old"
);

function reconcile(currentMd: string, nextMd: string) {
  const current = parseBoard(currentMd);
  const next = parseBoard(nextMd);
  const before = serializeBoard(next);
  const matched = reconcileIds(current, next);
  return { current, next, matched, before };
}

describe("reconcileIds", () => {
  test("an unchanged board keeps every id", () => {
    const { current, next, matched } = reconcile(BASE, BASE);
    expect(matched).toBe(true);
    expect(next.lanes.map((l) => l.id)).toEqual(current.lanes.map((l) => l.id));
    expect(next.lanes.flatMap((l) => l.items.map((i) => i.id))).toEqual(
      current.lanes.flatMap((l) => l.items.map((i) => i.id))
    );
    expect(next.archive.map((i) => i.id)).toEqual(current.archive.map((i) => i.id));
  });

  test("a card added in one lane re-ids only that lane's cards", () => {
    const changed = BASE.replace("- [ ] Task C\n", "- [ ] Task C\n- [ ] Task C2\n");
    const { current, next, matched } = reconcile(BASE, changed);
    expect(matched).toBe(true);
    expect(next.lanes.map((l) => l.id)).toEqual(current.lanes.map((l) => l.id));
    expect(next.lanes[0].items.map((i) => i.id)).toEqual(current.lanes[0].items.map((i) => i.id));
    expect(next.lanes[2].items.map((i) => i.id)).toEqual(current.lanes[2].items.map((i) => i.id));
    const oldIds = new Set(current.lanes[1].items.map((i) => i.id));
    expect(next.lanes[1].items.some((i) => oldIds.has(i.id))).toBe(false);
  });

  test("a checkbox toggled remotely re-ids that lane's cards", () => {
    const changed = BASE.replace("- [ ] Task B", "- [x] Task B");
    const { current, next, matched } = reconcile(BASE, changed);
    expect(matched).toBe(true);
    const oldIds = new Set(current.lanes[0].items.map((i) => i.id));
    expect(next.lanes[0].items.some((i) => oldIds.has(i.id))).toBe(false);
  });

  test.each([
    ["inserted", BASE.replace("## Doing", "## New\n\n## Doing")],
    ["deleted", BASE.replace("## Doing\n- [ ] Task C\n\n", "")],
    ["renamed", BASE.replace("## Doing", "## In progress")],
    [
      "reordered",
      BASE.replace("## To Do\n- [ ] Task A\n> note under A\n- [ ] Task B\n\n## Doing\n- [ ] Task C\n",
        "## Doing\n- [ ] Task C\n\n## To Do\n- [ ] Task A\n> note under A\n- [ ] Task B\n"),
    ],
  ])("a lane %s remotely matches nothing and leaves the board untouched", (_label, changed) => {
    const { current, next, matched } = reconcile(BASE, changed);
    expect(changed).not.toBe(BASE);
    expect(matched).toBe(false);
    const oldIds = new Set([
      ...current.lanes.map((l) => l.id),
      ...current.lanes.flatMap((l) => l.items.map((i) => i.id)),
      ...current.archive.map((i) => i.id),
    ]);
    const nextIds = [
      ...next.lanes.map((l) => l.id),
      ...next.lanes.flatMap((l) => l.items.map((i) => i.id)),
      ...next.archive.map((i) => i.id),
    ];
    expect(nextIds.some((id) => oldIds.has(id))).toBe(false);
  });

  test("extra blocks stay anchored to the card they follow", () => {
    const { current, next } = reconcile(BASE, BASE);
    const note = (blocks: typeof next.archiveExtra, text: string) =>
      blocks?.find((b) => b.lines.includes(text))?.afterItemId;
    expect(note(next.lanes[0].extra, "> note under A")).toBe(current.lanes[0].items[0].id);
    expect(note(next.archiveExtra, "> note under Old")).toBe(current.archive[0].id);
  });

  test("duplicate card titles keep their positions", () => {
    const dup = doc("## L", "- [ ] Same", "> after first", "- [ ] Same", "> after second");
    const { current, next } = reconcile(dup, dup);
    expect(next.lanes[0].items.map((i) => i.id)).toEqual(current.lanes[0].items.map((i) => i.id));
    expect(next.lanes[0].extra?.map((b) => b.afterItemId)).toEqual(
      current.lanes[0].items.map((i) => i.id)
    );
  });

  // The guarantee that makes reconciling safe: ids decide which components
  // Svelte keeps, never what is written to disk.
  test.each([
    ["unchanged", BASE],
    ["card added", BASE.replace("- [ ] Task C\n", "- [ ] Task C\n- [ ] Task C2\n")],
    ["card edited", BASE.replace("Task A", "Task A edited")],
    ["note edited", BASE.replace("note under A", "note under A, edited")],
    ["archive changed", BASE.replace("- [x] Old", "- [x] Older")],
    ["lane renamed", BASE.replace("## Doing", "## In progress")],
    ["lane added", BASE + "\n## Later\n- [ ] Task E\n"],
    ["emptied", doc("## To Do", "", "## Doing", "", "## Done")],
  ])("reconciling never changes the serialized board (%s)", (_label, changed) => {
    const { next, before } = reconcile(BASE, changed);
    expect(serializeBoard(next)).toBe(before);
  });
});
