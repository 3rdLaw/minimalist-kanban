import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Board from "../src/Board.svelte";
import { Menu, Platform } from "obsidian";
import SortableMock from "./mocks/sortablejs";
import type { Board as BoardType } from "../src/types";

const defaultSettings = {
  showCheckboxes: false,
  enterNewline: false,
  prependCards: false,
};

function makeApp() {
  return {
    vault: {
      create: vi.fn().mockResolvedValue({ path: "New Note.md" }),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
    },
    workspace: {
      getLeaf: vi.fn().mockReturnValue({
        openFile: vi.fn().mockResolvedValue(undefined),
      }),
    },
    fileManager: {
      generateMarkdownLink: vi.fn().mockReturnValue("[[New Note]]"),
    },
  };
}

function makeBoard(overrides?: Partial<BoardType>): BoardType {
  return {
    lanes: [
      {
        id: "lane-1",
        title: "To Do",
        items: [
          { id: "i1", title: "Task A", checked: false, hasCheckbox: false },
          { id: "i2", title: "Task B", checked: false, hasCheckbox: false },
        ],
      },
      {
        id: "lane-2",
        title: "Done",
        items: [
          { id: "i3", title: "Task C", checked: false, hasCheckbox: false },
        ],
      },
    ],
    archive: [],
    ...overrides,
  };
}

function renderBoard(boardOverrides?: Partial<BoardType>, settingsOverrides = {}) {
  const onChange = vi.fn();
  const result = render(Board, {
    props: {
      board: makeBoard(boardOverrides),
      settings: { ...defaultSettings, ...settingsOverrides },
      app: makeApp(),
      viewComponent: null,
      filePath: "boards/test.md",
      onChange,
    },
  });
  return { ...result, onChange };
}

// ── Rendering ────────────────────────────────────────────

describe("Board rendering", () => {
  test("renders all lanes", () => {
    const { container } = renderBoard();
    expect(container.querySelectorAll(".kb-lane")).toHaveLength(2);
  });

  test("renders lane titles", () => {
    const { container } = renderBoard();
    const titles = container.querySelectorAll(".kb-lane-title");
    expect(titles[0].textContent).toBe("To Do");
    expect(titles[1].textContent).toBe("Done");
  });

  test("renders add-lane button", () => {
    const { container } = renderBoard();
    expect(container.querySelector(".kb-add-lane-btn")).toBeTruthy();
  });

  test("renders items in each lane", () => {
    const { container } = renderBoard();
    const lanes = container.querySelectorAll(".kb-lane");
    expect(lanes[0].querySelectorAll(".kb-item")).toHaveLength(2);
    expect(lanes[1].querySelectorAll(".kb-item")).toHaveLength(1);
  });
});

// ── Lane management ──────────────────────────────────────

describe("Board lane management", () => {
  test("adds a lane on button click", async () => {
    const { container, onChange } = renderBoard();
    await fireEvent.click(container.querySelector(".kb-add-lane-btn")!);

    expect(onChange).toHaveBeenCalled();
    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes).toHaveLength(3);
    expect(updatedBoard.lanes[2].title).toBe("New List");
  });

  test("deletes a lane via menu", async () => {
    const { container, onChange } = renderBoard();

    // Click the first lane's menu
    const menuBtns = container.querySelectorAll(".kb-lane-header .kb-menu-btn");
    await fireEvent.click(menuBtns[0]);

    const menu = Menu.instances[Menu.instances.length - 1];
    menu.findItem("Delete list")!._onClick!();

    expect(onChange).toHaveBeenCalled();
    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes).toHaveLength(1);
    expect(updatedBoard.lanes[0].title).toBe("Done");
  });
});

// ── Item add with settings ───────────────────────────────

describe("Board item addition", () => {
  test("appends new item by default", async () => {
    const { container, onChange } = renderBoard();
    const textareas = container.querySelectorAll(".kb-add-item-input");
    const firstLaneInput = textareas[0] as HTMLTextAreaElement;

    await fireEvent.input(firstLaneInput, { target: { value: "New task" } });
    await fireEvent.keyDown(firstLaneInput, { key: "Enter" });

    expect(onChange).toHaveBeenCalled();
    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    const items = updatedBoard.lanes[0].items;
    expect(items[items.length - 1].title).toBe("New task");
  });

  test("prepends new item when prependCards is true", async () => {
    const { container, onChange } = renderBoard(undefined, {
      prependCards: true,
    });
    const textareas = container.querySelectorAll(".kb-add-item-input");
    const firstLaneInput = textareas[0] as HTMLTextAreaElement;

    await fireEvent.input(firstLaneInput, { target: { value: "Prepended" } });
    await fireEvent.keyDown(firstLaneInput, { key: "Enter" });

    expect(onChange).toHaveBeenCalled();
    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items[0].title).toBe("Prepended");
  });
});

// ── Card context menu actions ────────────────────────────

describe("Board card menu", () => {
  async function openCardMenu(container: HTMLElement, itemIndex = 0) {
    const menuBtns = container.querySelectorAll(".kb-item .kb-menu-btn");
    const before = Menu.instances.length;
    await fireEvent.click(menuBtns[itemIndex]);
    return Menu.instances[before]; // main menu (submenu is created after)
  }

  test("shows card menu with all options", async () => {
    const { container } = renderBoard();
    const menu = await openCardMenu(container);

    expect(menu.findItem("Edit card")).toBeTruthy();
    expect(menu.findItem("New note from card")).toBeTruthy();
    expect(menu.findItem("Duplicate card")).toBeTruthy();
    expect(menu.findItem("Move to top")).toBeTruthy();
    expect(menu.findItem("Move to bottom")).toBeTruthy();
    expect(menu.findItem("Move to list")).toBeTruthy();
    expect(menu.findItem("Archive card")).toBeTruthy();
    expect(menu.findItem("Delete card")).toBeTruthy();
  });

  test("duplicate card clones item after original", async () => {
    const { container, onChange } = renderBoard();
    const menu = await openCardMenu(container, 0);
    menu.findItem("Duplicate card")!._onClick!();

    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items).toHaveLength(3);
    expect(updatedBoard.lanes[0].items[0].title).toBe("Task A");
    expect(updatedBoard.lanes[0].items[1].title).toBe("Task A"); // clone
    expect(updatedBoard.lanes[0].items[1].id).not.toBe("i1"); // new id
  });

  test("move to top moves item to first position", async () => {
    const { container, onChange } = renderBoard();
    // Click menu on second item (index 1 = "Task B")
    const menu = await openCardMenu(container, 1);
    menu.findItem("Move to top")!._onClick!();

    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items[0].title).toBe("Task B");
    expect(updatedBoard.lanes[0].items[1].title).toBe("Task A");
  });

  test("move to bottom moves item to last position", async () => {
    const { container, onChange } = renderBoard();
    // Click menu on first item (index 0 = "Task A")
    const menu = await openCardMenu(container, 0);
    menu.findItem("Move to bottom")!._onClick!();

    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items[0].title).toBe("Task B");
    expect(updatedBoard.lanes[0].items[1].title).toBe("Task A");
  });

  test("archive card moves item to archive", async () => {
    const { container, onChange } = renderBoard();
    const menu = await openCardMenu(container, 0);
    menu.findItem("Archive card")!._onClick!();

    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items).toHaveLength(1);
    expect(updatedBoard.archive).toHaveLength(1);
    expect(updatedBoard.archive[0].title).toBe("Task A");
  });

  test("delete card removes item", async () => {
    const { container, onChange } = renderBoard();
    const menu = await openCardMenu(container, 0);
    menu.findItem("Delete card")!._onClick!();

    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items).toHaveLength(1);
    expect(updatedBoard.lanes[0].items[0].title).toBe("Task B");
  });

  test("move to list submenu lists all lanes", async () => {
    const { container } = renderBoard();
    const menu = await openCardMenu(container, 0);
    const moveItem = menu.findItem("Move to list")!;
    expect(moveItem._submenu).toBeTruthy();

    const subItems = moveItem._submenu!.items.filter(
      (i): i is InstanceType<typeof import("./mocks/obsidian").MenuItem> =>
        "_title" in i
    );
    expect(subItems.map((i) => i._title)).toEqual(["To Do", "Done"]);
    // Current lane is checked
    expect(subItems[0]._checked).toBe(true);
    expect(subItems[1]._checked).toBe(false);
  });

  test("move to list transfers item between lanes", async () => {
    const { container, onChange } = renderBoard();
    const menu = await openCardMenu(container, 0);
    const moveItem = menu.findItem("Move to list")!;
    const subItems = moveItem._submenu!.items.filter(
      (i): i is InstanceType<typeof import("./mocks/obsidian").MenuItem> =>
        "_title" in i
    );
    // Click "Done" lane
    subItems[1]._onClick!();

    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items).toHaveLength(1); // removed from To Do
    expect(updatedBoard.lanes[1].items).toHaveLength(2); // added to Done
    expect(updatedBoard.lanes[1].items[1].title).toBe("Task A");
  });

  test("new note from card creates file and updates title", async () => {
    const app = makeApp();
    const onChange = vi.fn();
    const { container } = render(Board, {
      props: {
        board: makeBoard(),
        settings: defaultSettings,
        app,
        viewComponent: null,
        filePath: "boards/test.md",
        onChange,
      },
    });

    const menu = await (async () => {
      const menuBtns = container.querySelectorAll(".kb-item .kb-menu-btn");
      const before = Menu.instances.length;
      await fireEvent.click(menuBtns[0]);
      return Menu.instances[before]; // main menu, not submenu
    })();

    await menu.findItem("New note from card")!._onClick!();
    // Wait for async operations
    await new Promise((r) => setTimeout(r, 10));

    expect(app.vault.create).toHaveBeenCalled();
    const createPath = app.vault.create.mock.calls[0][0] as string;
    expect(createPath).toMatch(/^boards\/Task A\.md$/);
    expect(app.workspace.getLeaf).toHaveBeenCalledWith("split");
  });
});

// ── Mobile behavior ──────────────────────────────────────

describe("Board mobile behavior", () => {
  test("flattens Move to list on mobile (Platform.isPhone)", async () => {
    Platform.isPhone = true;
    const { container } = renderBoard();

    const menuBtns = container.querySelectorAll(".kb-item .kb-menu-btn");
    await fireEvent.click(menuBtns[0]);
    const menu = Menu.instances[Menu.instances.length - 1];

    // On phone, "Move to list" should NOT create a submenu
    const moveItem = menu.findItem("Move to list")!;
    expect(moveItem._submenu).toBeNull();

    // Lane titles should be added directly to the main menu
    const mainItems = menu.items.filter(
      (i): i is InstanceType<typeof import("./mocks/obsidian").MenuItem> =>
        "_title" in i
    );
    const laneItems = mainItems.filter(
      (i) => i._title === "To Do" || i._title === "Done"
    );
    expect(laneItems).toHaveLength(2);

    Platform.isPhone = false; // reset
  });
});

// ── Drag and drop ────────────────────────────────────────

describe("Board drag and drop", () => {
  test("reorders items within a lane via SortableJS", async () => {
    const { container, onChange } = renderBoard();

    const laneItemsEl = container.querySelectorAll(".kb-lane-items")[0];
    const sortable = SortableMock.instances.find(
      (s) => s.el === laneItemsEl
    )!;
    expect(sortable).toBeTruthy();

    // Simulate SortableJS having reordered: moved item at 0 to 1
    const children = Array.from(laneItemsEl.children) as HTMLElement[];
    const draggedItem = children[0];
    laneItemsEl.removeChild(draggedItem);
    laneItemsEl.appendChild(draggedItem);

    sortable.options.onEnd({
      from: laneItemsEl,
      to: laneItemsEl,
      oldIndex: 0,
      newIndex: 1,
      item: draggedItem,
    });

    expect(onChange).toHaveBeenCalled();
    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items.map((i) => i.title)).toEqual([
      "Task B",
      "Task A",
    ]);
  });

  test("moves item between lanes via SortableJS", async () => {
    const { container, onChange } = renderBoard();

    const laneItemsEls = container.querySelectorAll(".kb-lane-items");
    const fromEl = laneItemsEls[0];
    const toEl = laneItemsEls[1];
    const sortable = SortableMock.instances.find((s) => s.el === fromEl)!;

    // Simulate SortableJS moving first item from lane-1 to lane-2 at position 0
    const draggedItem = fromEl.children[0] as HTMLElement;
    fromEl.removeChild(draggedItem);
    toEl.insertBefore(draggedItem, toEl.children[0]);

    sortable.options.onEnd({
      from: fromEl,
      to: toEl,
      oldIndex: 0,
      newIndex: 0,
      item: draggedItem,
    });

    expect(onChange).toHaveBeenCalled();
    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes[0].items.map((i) => i.title)).toEqual([
      "Task B",
    ]);
    expect(updatedBoard.lanes[1].items.map((i) => i.title)).toEqual([
      "Task A",
      "Task C",
    ]);
  });

  test("reorders lanes via board-level SortableJS", async () => {
    const { container, onChange } = renderBoard();

    const boardEl = container.querySelector(".kb-board")!;
    const boardSortable = SortableMock.instances.find(
      (s) => s.el === boardEl
    )!;
    expect(boardSortable).toBeTruthy();
    expect(boardSortable.options.handle).toBe(".kb-lane-drag-handle");

    // Simulate moving lane at index 0 to index 1
    const lanes = Array.from(boardEl.querySelectorAll(".kb-lane"));
    const draggedLane = lanes[0];
    boardEl.removeChild(draggedLane);
    boardEl.insertBefore(draggedLane, boardEl.querySelector(".kb-add-lane"));

    boardSortable.options.onEnd({
      oldIndex: 0,
      newIndex: 1,
      item: draggedLane,
    });

    expect(onChange).toHaveBeenCalled();
    const updatedBoard = onChange.mock.calls[0][0] as BoardType;
    expect(updatedBoard.lanes.map((l) => l.title)).toEqual(["Done", "To Do"]);
  });

  test("SortableJS filter prevents drag on menu buttons", () => {
    renderBoard();

    const itemSortables = SortableMock.instances.filter(
      (s) => s.options.group === "kb-items"
    );
    expect(itemSortables.length).toBeGreaterThan(0);
    itemSortables.forEach((s) => {
      expect(s.options.filter).toBe(".kb-menu-btn");
      expect(s.options.preventOnFilter).toBe(false);
    });
  });

  test("SortableJS has touch delay for mobile", () => {
    renderBoard();

    const itemSortables = SortableMock.instances.filter(
      (s) => s.options.group === "kb-items"
    );
    itemSortables.forEach((s) => {
      expect(s.options.delay).toBe(150);
      expect(s.options.delayOnTouchOnly).toBe(true);
    });
  });
});
