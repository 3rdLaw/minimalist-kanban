import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { Menu, Notice, Setting } from "obsidian";
import SortableMock from "./mocks/sortablejs";

// Inject mock before any Svelte component loads
(globalThis as any).__TEST_SORTABLE__ = SortableMock;

// Obsidian extends HTMLElement with helpers — stub them for jsdom
if (!HTMLElement.prototype.setCssProps) {
  HTMLElement.prototype.setCssProps = function (props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
}
if (!HTMLElement.prototype.empty) {
  HTMLElement.prototype.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}
if (!HTMLElement.prototype.addClass) {
  HTMLElement.prototype.addClass = function (...classes: string[]) {
    this.classList.add(...classes);
  };
}
if (!(HTMLElement.prototype as any).createEl) {
  (HTMLElement.prototype as any).createEl = function (
    tag: string,
    options?: { cls?: string; attr?: Record<string, string | number> }
  ) {
    const el = document.createElement(tag);
    if (options?.cls) el.className = options.cls;
    if (options?.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        el.setAttribute(key, String(value));
      }
    }
    this.appendChild(el);
    return el;
  };
}

beforeEach(() => {
  SortableMock.instances.length = 0;
  Menu.instances.length = 0;
  Notice.instances.length = 0;
  Setting.instances.length = 0;
});
