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

    async function openCardMenu(view: KanbanView, index: number) {
      const { Menu } = await import("obsidian");
      const before = (Menu as any).instances.length;
      const btns = view.contentEl.querySelectorAll<HTMLElement>(".kb-item .kb-menu-btn");
      await fireEvent.click(btns[index]);
      return (Menu as any).instances[before];
    }

    test("an in-place update closes a card menu opened on the old board", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const menu = await openCardMenu(view, 0);
      expect(menu.hidden).toBe(false);

      view.setViewData(REMOTE_CARD, false);

      expect(menu.hidden).toBe(true);
    });

    test("an in-place update closes an archive card menu", async () => {
      const { view, plugin } = makeAttachedView();
      plugin.settings.showArchive = true;
      const withArchive = MD + "\n---\n\n## Archive\n\n- [x] Old\n";
      view.setViewData(withArchive, true);
      const { Menu } = await import("obsidian");
      const before = (Menu as any).instances.length;
      await fireEvent.click(view.contentEl.querySelector<HTMLElement>(".kb-archive-item .kb-menu-btn")!);
      const menu = (Menu as any).instances[before];

      view.setViewData(withArchive.replace("- [ ] Task A\n", "- [ ] Task A\n- [ ] Remote\n"), false);

      expect(menu.hidden).toBe(true);
    });

    test("a remount closes menus too", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const menu = await openCardMenu(view, 0);
      view.setViewData(MD.replace("## Done", "## Finished"), false);
      expect(menu.hidden).toBe(true);
    });

    // Removing a focused input blurs it, and a blur commits an inline edit.
    // That commit comes from the component being replaced, carrying its board.
    test("a change from the replaced component cannot overwrite the new board", () => {
      const { view } = makeAttachedView();
      const spy = vi.spyOn(view, "requestSave");
      view.setViewData(MD, true);
      const stale = (view as any).props;

      view.setViewData(MD.replace("## Done", "## Finished"), false);
      stale.onChange(stale.board);

      expect(view.getViewData()).toContain("## Finished");
      expect(spy).not.toHaveBeenCalled();
    });

    test("a change from a component torn down by clear() is ignored", () => {
      const { view } = makeAttachedView();
      const spy = vi.spyOn(view, "requestSave");
      view.setViewData(MD, true);
      const stale = (view as any).props;
      view.clear();
      stale.onChange(stale.board);
      expect(spy).not.toHaveBeenCalled();
    });

    test("clear() hands back unsent text", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      await fireEvent.input(addCardInput(view, 0), { target: { value: "unsent" } });

      view.clear();

      expect(Notice.instances).toHaveLength(1);
      expect(Notice.instances[0].noticeEl.textContent).toContain("New card in To Do: unsent");
    });

    test("the rescue notice survives clicks on its text and closes only via Dismiss", async () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      await fireEvent.input(addCardInput(view, 0), { target: { value: "unsent" } });
      view.setViewData(MD.replace("## Done", "## Finished"), false);

      const notice = Notice.instances[0];
      // Obsidian's own hide-on-click listener sits on the notice's container.
      const container = document.createElement("div");
      container.appendChild(notice.noticeEl);
      const hide = vi.spyOn(notice, "hide");
      container.addEventListener("click", () => notice.hide());

      await fireEvent.click(notice.noticeEl.querySelector("span")!);
      expect(hide).not.toHaveBeenCalled();

      await fireEvent.click(notice.noticeEl.querySelector(".kb-draft-dismiss")!);
      expect(hide).toHaveBeenCalledTimes(1);
    });

    test("remounts while a drag has started (Sortable.active)", () => {
      const { view } = makeAttachedView();
      view.setViewData(MD, true);
      const input = addCardInput(view);
      (SortableMock as any).active = {};
      try {
        view.setViewData(REMOTE_CARD, false);
      } finally {
        (SortableMock as any).active = null;
      }
      expect(input.isConnected).toBe(false);
    });

    test("new note from card does not link a card replaced while the note was created", async () => {
      const { view } = makeAttachedView();
      let resolveCreate!: (f: { path: string }) => void;
      (view as any).app = {
        vault: {
          create: vi.fn(() => new Promise((r) => { resolveCreate = r; })),
          getAbstractFileByPath: vi.fn().mockReturnValue(null),
        },
        workspace: { getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) }) },
        fileManager: { generateMarkdownLink: vi.fn().mockReturnValue("[[Task B]]") },
      };
      view.setViewData(MD, true);
      const menu = await openCardMenu(view, 1);
      const pending = menu.findItem("New note from card")._onClick();

      view.setViewData(MD.replace("- [x] Task B", "- [x] Task B, edited remotely"), false);
      resolveCreate({ path: "Task B.md" });
      await pending;

      expect(view.getViewData()).toContain("- [x] Task B, edited remotely");
      expect(view.getViewData()).not.toContain("[[Task B]]");
      expect(Notice.instances[Notice.instances.length - 1].noticeEl.textContent).toContain("card changed before it could be linked");
    });

    test("new note from card still links a card whose lane was untouched", async () => {
      const { view } = makeAttachedView();
      (view as any).app = {
        vault: {
          create: vi.fn().mockResolvedValue({ path: "Task A.md" }),
          getAbstractFileByPath: vi.fn().mockReturnValue(null),
        },
        workspace: { getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) }) },
        fileManager: { generateMarkdownLink: vi.fn().mockReturnValue("[[Task A]]") },
      };
      view.setViewData(MD, true);
      const menu = await openCardMenu(view, 0);
      const pending = menu.findItem("New note from card")._onClick();
      view.setViewData(REMOTE_CARD, false);
      await pending;

      expect(view.getViewData()).toContain("- [ ] [[Task A]]");
      expect(view.getViewData()).toContain("- [ ] Task C");
    });
  });
});
