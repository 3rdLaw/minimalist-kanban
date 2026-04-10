import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Item from "../src/Item.svelte";

const defaultSettings = {
  showCheckboxes: false,
  enterNewline: false,
  prependCards: false,
  showArchive: false,
};

const mockApp = {};
const mockFilePath = "test.md";

function makeItem(overrides = {}) {
  return {
    id: "item-1",
    title: "Test card",
    checked: false,
    hasCheckbox: false,
    ...overrides,
  };
}

function renderItem(itemOverrides = {}, settingsOverrides = {}) {
  return render(Item, {
    props: {
      item: makeItem(itemOverrides),
      settings: { ...defaultSettings, ...settingsOverrides },
      app: mockApp,
      viewComponent: null,
      filePath: mockFilePath,
    },
  });
}

describe("Item", () => {
  test("renders item title", () => {
    const { container } = renderItem();
    expect(container.querySelector(".kb-item-title")!.textContent).toBe(
      "Test card"
    );
  });

  test("renders multi-line title with whitespace preserved", () => {
    const { container } = renderItem({ title: "Line 1\nLine 2" });
    const el = container.querySelector(".kb-item-title")!;
    expect(el.textContent).toBe("Line 1\nLine 2");
  });

  test("shows checkbox when setting enabled and item has checkbox", () => {
    const { container } = renderItem(
      { hasCheckbox: true, checked: true },
      { showCheckboxes: true }
    );
    const checkbox = container.querySelector(
      ".kb-item-checkbox"
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(true);
  });

  test("hides checkbox when setting disabled", () => {
    const { container } = renderItem(
      { hasCheckbox: true },
      { showCheckboxes: false }
    );
    expect(container.querySelector(".kb-item-checkbox")).toBeNull();
  });

  test("hides checkbox when item has no checkbox", () => {
    const { container } = renderItem(
      { hasCheckbox: false },
      { showCheckboxes: true }
    );
    expect(container.querySelector(".kb-item-checkbox")).toBeNull();
  });

  test("enters edit mode on title click", async () => {
    const { container } = renderItem();
    await fireEvent.click(container.querySelector(".kb-item-title")!);
    expect(container.querySelector(".kb-item-edit")).toBeTruthy();
  });

  test("dispatches edit event on Enter (default settings)", async () => {
    const { container, component } = renderItem();
    const handler = vi.fn();
    component.$on("edit", handler);

    await fireEvent.click(container.querySelector(".kb-item-title")!);
    const textarea = container.querySelector(".kb-item-edit")! as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "Updated" } });
    await fireEvent.keyDown(textarea, { key: "Enter" });
    await fireEvent.blur(textarea);

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail.title).toBe("Updated");
  });

  test("Enter inserts newline when enterNewline is true", async () => {
    const { container } = renderItem({}, { enterNewline: true });
    await fireEvent.click(container.querySelector(".kb-item-title")!);
    const textarea = container.querySelector(".kb-item-edit")! as HTMLTextAreaElement;

    const prevented = await fireEvent.keyDown(textarea, { key: "Enter" });
    expect(container.querySelector(".kb-item-edit")).toBeTruthy();
  });

  test("Shift+Enter submits when enterNewline is true", async () => {
    const { container, component } = renderItem({}, { enterNewline: true });
    const handler = vi.fn();
    component.$on("edit", handler);

    await fireEvent.click(container.querySelector(".kb-item-title")!);
    const textarea = container.querySelector(".kb-item-edit")! as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "New value" } });
    await fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    await fireEvent.blur(textarea);

    expect(handler).toHaveBeenCalled();
  });

  test("cancels edit on Escape", async () => {
    const { container, component } = renderItem();
    const handler = vi.fn();
    component.$on("edit", handler);

    await fireEvent.click(container.querySelector(".kb-item-title")!);
    const textarea = container.querySelector(".kb-item-edit")!;
    await fireEvent.keyDown(textarea, { key: "Escape" });

    expect(container.querySelector(".kb-item-edit")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  test("ignores Enter during IME composition", async () => {
    const { container, component } = renderItem();

    await fireEvent.click(container.querySelector(".kb-item-title")!);
    const textarea = container.querySelector(".kb-item-edit")!;

    await fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(container.querySelector(".kb-item-edit")).toBeTruthy();
  });

  test("renders menu button", () => {
    const { container } = renderItem();
    expect(container.querySelector(".kb-menu-btn")).toBeTruthy();
  });

  test("dispatches showmenu event on menu button click", async () => {
    const { container, component } = renderItem();
    const handler = vi.fn();
    component.$on("showmenu", handler);

    await fireEvent.click(container.querySelector(".kb-menu-btn")!);
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail.itemId).toBe("item-1");
  });

  // ── Ctrl+Click link navigation ────────────────────────

  test("Ctrl+Click on card with wikilink opens link in new tab", async () => {
    const openLinkText = vi.fn();
    const { container } = render(Item, {
      props: {
        item: makeItem({ title: "Check [[My Note]]" }),
        settings: defaultSettings,
        app: { workspace: { openLinkText } },
        viewComponent: null,
        filePath: mockFilePath,
      },
    });

    // Wait for async renderMarkdown
    await new Promise((r) => setTimeout(r, 10));

    const link = container.querySelector("a.internal-link")!;
    expect(link).toBeTruthy();

    // Ctrl+Click on the link itself
    await fireEvent.click(link, { ctrlKey: true });

    expect(openLinkText).toHaveBeenCalledWith("My Note", mockFilePath, "tab");
  });

  test("plain click on link opens in same pane", async () => {
    const openLinkText = vi.fn();
    const { container } = render(Item, {
      props: {
        item: makeItem({ title: "Check [[My Note]]" }),
        settings: defaultSettings,
        app: { workspace: { openLinkText } },
        viewComponent: null,
        filePath: mockFilePath,
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    const link = container.querySelector("a.internal-link")!;
    await fireEvent.click(link);

    expect(openLinkText).toHaveBeenCalledWith("My Note", mockFilePath, false);
  });

  test("Ctrl+Click on card without links enters edit mode", async () => {
    const { container } = renderItem({ title: "No links here" });
    await new Promise((r) => setTimeout(r, 10));

    await fireEvent.click(container.querySelector(".kb-item-title")!, { ctrlKey: true });
    expect(container.querySelector(".kb-item-edit")).toBeTruthy();
  });

  test("does not dispatch edit when title unchanged", async () => {
    const { container, component } = renderItem();
    const handler = vi.fn();
    component.$on("edit", handler);

    await fireEvent.click(container.querySelector(".kb-item-title")!);
    const textarea = container.querySelector(".kb-item-edit")!;
    await fireEvent.blur(textarea);

    expect(handler).not.toHaveBeenCalled();
  });
});
