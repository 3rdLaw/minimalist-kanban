import { describe, test, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import { KanbanView, KANBAN_VIEW_TYPE } from "../src/KanbanView";
import { DEFAULT_SETTINGS } from "../src/settings";
import { TFile } from "obsidian";

const MD =
  "---\nkanban-plugin: board\n---\n\n## To Do\n- [ ] Task A\n\n## Done\n- [x] Task B\n";

function makeView() {
  const plugin: any = { settings: { ...DEFAULT_SETTINGS } };
  const view = new KanbanView({} as any, plugin);
  (view as any).file = Object.assign(new TFile(), {
    path: "Board.md",
    basename: "Board",
  });
  return { view, plugin };
}

describe("KanbanView", () => {
  test("reports view type, icon, and display text", () => {
    const { view } = makeView();
    expect(view.getViewType()).toBe(KANBAN_VIEW_TYPE);
    expect(view.getIcon()).toBe("columns-3");
    expect(view.getDisplayText()).toBe("Board");
  });

  test("falls back to a generic display text without a file", () => {
    const { view } = makeView();
    (view as any).file = null;
    expect(view.getDisplayText()).toBe("Kanban Board");
  });

  test("setViewData parses the markdown and renders the board", () => {
    const { view } = makeView();
    view.setViewData(MD, true);

    const lanes = view.contentEl.querySelectorAll(".kb-lane");
    expect(lanes).toHaveLength(2);
    const titles = Array.from(
      view.contentEl.querySelectorAll(".kb-lane-title")
    ).map((el) => el.textContent);
    expect(titles).toEqual(["To Do", "Done"]);
  });

  test("getViewData round-trips the document", () => {
    const { view } = makeView();
    view.setViewData(MD, true);
    expect(view.getViewData()).toBe(MD);
  });

  test("preserves custom frontmatter through the view", () => {
    const { view } = makeView();
    const md =
      "---\nkanban-plugin: board\ntags: [project]\n---\n\n## To Do\n- [ ] Task\n";
    view.setViewData(md, true);
    expect(view.getViewData()).toContain("tags: [project]");
  });

  test("UI changes flow back through onChange and requestSave", async () => {
    const { view } = makeView();
    const spy = vi.spyOn(view, "requestSave");
    view.setViewData(MD, true);

    const addBtn = view.contentEl.querySelector(".kb-add-lane-btn")!;
    await fireEvent.click(addBtn);

    expect(spy).toHaveBeenCalled();
    expect(view.getViewData()).toContain("## New List");
  });

  test("clear resets the board", () => {
    const { view } = makeView();
    view.setViewData(MD, true);
    view.clear();
    expect(view.board.lanes).toHaveLength(0);
    expect(view.getViewData()).not.toContain("## To Do");
  });

  test("onClose tears down the component and is idempotent", async () => {
    const { view } = makeView();
    view.setViewData(MD, true);
    await view.onClose();
    await view.onClose();
    expect(view.contentEl.querySelector(".kb-board")).toBeNull();
  });

  test("onSettingsChanged pushes new settings into the mounted board", async () => {
    const { view, plugin } = makeView();
    view.setViewData(MD, true);
    expect(view.contentEl.querySelector(".kb-item-checkbox")).toBeNull();

    plugin.settings = { ...plugin.settings, showCheckboxes: true };
    view.onSettingsChanged();
    await new Promise((r) => setTimeout(r, 0));

    expect(view.contentEl.querySelector(".kb-item-checkbox")).toBeTruthy();
  });
});
