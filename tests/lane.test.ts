import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Lane from "../src/Lane.svelte";
import { Menu } from "obsidian";
import SortableMock from "./mocks/sortablejs";

const defaultSettings = {
  showCheckboxes: false,
  enterNewline: false,
  prependCards: false,
};

function makeLane(overrides = {}) {
  return {
    id: "lane-1",
    title: "To Do",
    items: [
      { id: "i1", title: "First", checked: false, hasCheckbox: false },
      { id: "i2", title: "Second", checked: false, hasCheckbox: false },
    ],
    ...overrides,
  };
}

describe("Lane", () => {
  test("renders lane title", () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    expect(container.querySelector(".kb-lane-title")!.textContent).toBe(
      "To Do"
    );
  });

  test("renders item count", () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    expect(container.querySelector(".kb-lane-count")!.textContent).toBe("2");
  });

  test("renders all items", () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    const items = container.querySelectorAll(".kb-item");
    expect(items).toHaveLength(2);
  });

  test("dispatches itemadd on Enter in add-card input", async () => {
    const { container, component } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    const handler = vi.fn();
    component.$on("itemadd", handler);

    const textarea = container.querySelector(
      ".kb-add-item-input"
    )! as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "New card" } });
    await fireEvent.keyDown(textarea, { key: "Enter" });

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail).toEqual({
      laneId: "lane-1",
      title: "New card",
    });
  });

  test("clears input after adding item", async () => {
    const { container, component } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    component.$on("itemadd", vi.fn());

    const textarea = container.querySelector(
      ".kb-add-item-input"
    )! as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "New card" } });
    await fireEvent.keyDown(textarea, { key: "Enter" });

    expect(textarea.value).toBe("");
  });

  test("does not add empty items", async () => {
    const { container, component } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    const handler = vi.fn();
    component.$on("itemadd", handler);

    const textarea = container.querySelector(".kb-add-item-input")!;
    await fireEvent.input(textarea, { target: { value: "   " } });
    await fireEvent.keyDown(textarea, { key: "Enter" });

    expect(handler).not.toHaveBeenCalled();
  });

  test("ignores Enter during IME composition in add-card input", async () => {
    const { container, component } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    const handler = vi.fn();
    component.$on("itemadd", handler);

    const textarea = container.querySelector(".kb-add-item-input")!;
    await fireEvent.input(textarea, { target: { value: "日本語" } });
    await fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });

    expect(handler).not.toHaveBeenCalled();
  });

  test("Shift+Enter adds card when enterNewline is true", async () => {
    const { container, component } = render(Lane, {
      props: {
        lane: makeLane(),
        settings: { ...defaultSettings, enterNewline: true },
        app: {}, viewComponent: null, filePath: "test.md",
        laneIndex: 0,
        laneCount: 1,
      },
    });
    const handler = vi.fn();
    component.$on("itemadd", handler);

    const textarea = container.querySelector(".kb-add-item-input")!;
    await fireEvent.input(textarea, { target: { value: "Card text" } });
    await fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(handler).toHaveBeenCalled();
  });

  test("plain Enter does NOT add card when enterNewline is true", async () => {
    const { container, component } = render(Lane, {
      props: {
        lane: makeLane(),
        settings: { ...defaultSettings, enterNewline: true },
        app: {}, viewComponent: null, filePath: "test.md",
        laneIndex: 0,
        laneCount: 1,
      },
    });
    const handler = vi.fn();
    component.$on("itemadd", handler);

    const textarea = container.querySelector(".kb-add-item-input")!;
    await fireEvent.input(textarea, { target: { value: "Card text" } });
    await fireEvent.keyDown(textarea, { key: "Enter" });

    expect(handler).not.toHaveBeenCalled();
  });

  // ── Lane menu ──────────────────────────────────────────

  test("shows lane menu on triple-dot click", async () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });

    await fireEvent.click(
      container.querySelector(".kb-lane-header .kb-menu-btn")!
    );

    expect(Menu.instances).toHaveLength(1);
    const menu = Menu.instances[0];
    expect(menu.findItem("Edit list name")).toBeTruthy();
    expect(menu.findItem("Delete list")).toBeTruthy();
    expect(menu.showAtMouseEvent).toHaveBeenCalled();
  });

  test("Edit list name menu item triggers title editing", async () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });

    await fireEvent.click(
      container.querySelector(".kb-lane-header .kb-menu-btn")!
    );
    const menu = Menu.instances[0];
    menu.findItem("Edit list name")!._onClick!();

    // Wait for the timeout in startEditTitle
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector(".kb-lane-title-input")).toBeTruthy();
  });

  test("Delete list menu item dispatches lanedelete", async () => {
    const { container, component } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    const handler = vi.fn();
    component.$on("lanedelete", handler);

    await fireEvent.click(
      container.querySelector(".kb-lane-header .kb-menu-btn")!
    );
    Menu.instances[0].findItem("Delete list")!._onClick!();

    expect(handler).toHaveBeenCalled();
  });

  test("lane menu shows move options when multiple lanes exist", async () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 1, laneCount: 3 },
    });

    await fireEvent.click(
      container.querySelector(".kb-lane-header .kb-menu-btn")!
    );
    const menu = Menu.instances[0];
    expect(menu.findItem("Move list left")).toBeTruthy();
    expect(menu.findItem("Move list right")).toBeTruthy();
  });

  test("first lane has no Move left option", async () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 2 },
    });

    await fireEvent.click(
      container.querySelector(".kb-lane-header .kb-menu-btn")!
    );
    const menu = Menu.instances[0];
    expect(menu.findItem("Move list left")).toBeFalsy();
    expect(menu.findItem("Move list right")).toBeTruthy();
  });

  test("last lane has no Move right option", async () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 1, laneCount: 2 },
    });

    await fireEvent.click(
      container.querySelector(".kb-lane-header .kb-menu-btn")!
    );
    const menu = Menu.instances[0];
    expect(menu.findItem("Move list left")).toBeTruthy();
    expect(menu.findItem("Move list right")).toBeFalsy();
  });

  test("single lane has no move options", async () => {
    const { container } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });

    await fireEvent.click(
      container.querySelector(".kb-lane-header .kb-menu-btn")!
    );
    const menu = Menu.instances[0];
    expect(menu.findItem("Move list left")).toBeFalsy();
    expect(menu.findItem("Move list right")).toBeFalsy();
  });

  // ── SortableJS integration ─────────────────────────────

  test("creates SortableJS instance on mount", () => {
    const initialCount = SortableMock.instances.length;

    render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });

    expect(SortableMock.instances.length).toBeGreaterThan(initialCount);
    const instance = SortableMock.instances[SortableMock.instances.length - 1];
    expect(instance.options.group).toBe("kb-items");
    expect(instance.options.filter).toBe(".kb-menu-btn");
  });

  test("dispatches itemmove on SortableJS onEnd (same lane)", async () => {
    const { container, component } = render(Lane, {
      props: { lane: makeLane(), settings: defaultSettings, app: {}, viewComponent: null, filePath: "test.md", laneIndex: 0, laneCount: 1 },
    });
    const handler = vi.fn();
    component.$on("itemmove", handler);

    const itemsEl = container.querySelector(".kb-lane-items")! as HTMLElement;
    const instance = SortableMock.instances[SortableMock.instances.length - 1];

    // Simulate SortableJS onEnd: moved item at index 0 to index 1
    const children = Array.from(itemsEl.children) as HTMLElement[];
    const draggedItem = children[0];
    itemsEl.removeChild(draggedItem);
    itemsEl.appendChild(draggedItem);

    instance.options.onEnd({
      from: itemsEl,
      to: itemsEl,
      oldIndex: 0,
      newIndex: 1,
      item: draggedItem,
    });

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail).toEqual({
      fromLaneId: "lane-1",
      toLaneId: "lane-1",
      oldIndex: 0,
      newIndex: 1,
    });
  });
});
