import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { Menu } from "obsidian";
import SortableMock from "./mocks/sortablejs";

// Inject mock before any Svelte component loads
(globalThis as any).__TEST_SORTABLE__ = SortableMock;

beforeEach(() => {
  SortableMock.instances.length = 0;
  Menu.instances.length = 0;
});
