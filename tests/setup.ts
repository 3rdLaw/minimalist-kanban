import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { Menu, Notice } from "obsidian";
import SortableMock from "./mocks/sortablejs";

// Inject mock before any Svelte component loads
(globalThis as any).__TEST_SORTABLE__ = SortableMock;

// Obsidian extends HTMLElement with setCssProps/setCssStyles — stub for jsdom
if (!HTMLElement.prototype.setCssProps) {
  HTMLElement.prototype.setCssProps = function (props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
}

beforeEach(() => {
  SortableMock.instances.length = 0;
  Menu.instances.length = 0;
  Notice.instances.length = 0;
});
