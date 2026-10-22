import { afterEach, describe, test, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import { KanbanView, KANBAN_VIEW_TYPE } from "../src/KanbanView";
import { DEFAULT_SETTINGS } from "../src/settings";
import { Notice, TFile } from "obsidian";
import SortableMock from "./mocks/sortablejs";

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

  describe("external changes (clear = false)", () => {
    const REMOTE_CARD = MD.replace("- [x] Task B\n", "- [x] Task B\n- [ ] Task C\n");

    // Focus only works on an element in the document.
    function makeAttachedView() {
      const made = makeView();
      document.body.appendChild(made.view.contentEl);
      return made;
    }

    afterEach(() => {
      document.body.replaceChildren();
    });

    function addCardInput(view: KanbanView, lane = 0) {
      return view.contentEl.querySelectorAll<HTMLTextAreaElement>(".kb-add-item-input")[lane];
    }

    test("updates the mounted board in place when the lanes are unchanged", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const input = addCardInput(view);
      input.focus();
      await fireEvent.input(input, { target: { value: "half-typed card" } });

      view.setViewData(REMOTE_CARD, false);

      expect(addCardInput(view)).toBe(input);
      expect(input.value).toBe("half-typed card");
      expect(document.activeElement).toBe(input);
      const titles = Array.from(view.contentEl.querySelectorAll(".kb-item")).map(
        (el) => el.getAttribute("data-id")
      );
      expect(titles).toHaveLength(3);
      expect(view.getViewData()).toBe(REMOTE_CARD);
      expect(Notice.instances).toHaveLength(0);
    });

    test("a card submitted after the update lands in the new board", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const input = addCardInput(view, 0);
      await fireEvent.input(input, { target: { value: "mine" } });

      view.setViewData(REMOTE_CARD, false);
      await fireEvent.keyDown(input, { key: "Enter" });

      const saved = view.getViewData();
      expect(saved).toContain("- [ ] mine");
      expect(saved).toContain("- [ ] Task C");
    });

    test("keeps an inline card edit when that lane's cards are unchanged", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const title = view.contentEl.querySelector<HTMLElement>(".kb-item-title")!;
      await fireEvent.click(title);
      const edit = view.contentEl.querySelector<HTMLTextAreaElement>(".kb-item-edit")!;
      await fireEvent.input(edit, { target: { value: "Task A, edited" } });

      view.setViewData(REMOTE_CARD, false);

      expect(view.contentEl.querySelector(".kb-item-edit")).toBe(edit);
      expect(Notice.instances).toHaveLength(0);
    });

    test("hands back an inline card edit whose lane changed remotely", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const title = view.contentEl.querySelectorAll<HTMLElement>(".kb-item-title")[1];
      await fireEvent.click(title);
      const edit = view.contentEl.querySelector<HTMLTextAreaElement>(".kb-item-edit")!;
      await fireEvent.input(edit, { target: { value: "Task B, edited" } });

      view.setViewData(REMOTE_CARD, false);

      expect(edit.isConnected).toBe(false);
      expect(Notice.instances).toHaveLength(1);
      expect(Notice.instances[0].noticeEl.textContent).toContain("Task B, edited");
    });

    test("remounts when the lanes changed, and hands back unsent text", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const input = addCardInput(view, 1);
      await fireEvent.input(input, { target: { value: "half-typed card" } });

      view.setViewData(MD.replace("## Done", "## Finished"), false);

      expect(input.isConnected).toBe(false);
      expect(Notice.instances).toHaveLength(1);
      const text = Notice.instances[0].noticeEl.textContent;
      expect(text).toContain("New card in Done: half-typed card");
    });

    test("does not report inputs that hold nothing new", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      await fireEvent.click(view.contentEl.querySelector<HTMLElement>(".kb-item-title")!);

      view.setViewData(MD.replace("## Done", "## Finished"), false);

      expect(Notice.instances).toHaveLength(0);
    });

    test("remounts while a drag is in progress", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const input = addCardInput(view);
      (SortableMock as any).dragged = document.createElement("div");
      try {
        view.setViewData(REMOTE_CARD, false);
      } finally {
        (SortableMock as any).dragged = null;
      }
      expect(input.isConnected).toBe(false);
    });

    test("clear = true always remounts", () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const input = addCardInput(view);
      view.setViewData(MD, true);
      expect(input.isConnected).toBe(false);
    });

    test("an in-place update retires a pending undo toast", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const menuBtn = view.contentEl.querySelector<HTMLElement>(".kb-item .kb-menu-btn")!;
      await fireEvent.click(menuBtn);
      const { Menu } = await import("obsidian");
      (Menu as any).instances
        .map((m: any) => m.findItem("Archive card"))
        .find(Boolean)
        ._onClick();
      const undo = Notice.instances[Notice.instances.length - 1];
      expect(undo.hidden).toBe(false);

      view.setViewData(view.getViewData().replace("- [x] Task B\n", "- [x] Task B\n- [ ] Task C\n"), false);

      expect(undo.hidden).toBe(true);
    });
  });
});
