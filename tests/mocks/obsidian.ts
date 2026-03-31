import { vi } from "vitest";

// ── Menu ──────────────────────────────────────────────────

export class MenuItem {
  _title = "";
  _icon = "";
  _checked = false;
  _onClick: (() => void) | null = null;
  _submenu: Menu | null = null;

  setTitle(t: string) { this._title = t; return this; }
  setIcon(i: string) { this._icon = i; return this; }
  setChecked(c: boolean) { this._checked = c; return this; }
  onClick(cb: () => void) { this._onClick = cb; return this; }
  setSubmenu() { this._submenu = new Menu(); return this._submenu; }
}

export class Menu {
  static instances: Menu[] = [];
  items: (MenuItem | { type: "separator" })[] = [];

  constructor() {
    Menu.instances.push(this);
  }

  addItem(cb: (item: MenuItem) => void) {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }

  addSeparator() {
    this.items.push({ type: "separator" });
    return this;
  }

  showAtMouseEvent = vi.fn();

  /** Test helper: find a menu item by title */
  findItem(title: string): MenuItem | undefined {
    return this.items.find(
      (i): i is MenuItem => i instanceof MenuItem && i._title === title
    );
  }
}

// ── Platform ──────────────────────────────────────────────

export const Platform = {
  isPhone: false,
  isMobile: false,
};

// ── Minimal stubs for types used in imports ───────────────

export class TFile {
  path = "";
  basename = "";
  extension = "md";
  parent: { path: string } | null = null;
}

export class TextFileView {
  leaf: any;
  file: TFile | null = null;
  data = "";
  contentEl: HTMLElement;

  constructor(leaf: any) {
    this.leaf = leaf;
    this.contentEl = document.createElement("div");
  }

  requestSave() {}
}

export class Plugin {
  app: any = {};
  loadData = vi.fn().mockResolvedValue({});
  saveData = vi.fn().mockResolvedValue(undefined);
  register = vi.fn();
  registerView = vi.fn();
  addCommand = vi.fn();
  addSettingTab = vi.fn();
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl = document.createElement("div");
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
}

export class Setting {
  constructor(_el: HTMLElement) {}
  setName(_n: string) { return this; }
  setDesc(_d: string) { return this; }
  addToggle(cb: any) {
    const toggle = {
      setValue: (_v: boolean) => toggle,
      onChange: (_cb: (v: boolean) => void) => toggle,
    };
    cb(toggle);
    return this;
  }
}

export class WorkspaceLeaf {
  view: any = {};
}

export class MarkdownView {
  file: TFile | null = null;
}

export class MarkdownRenderer {
  static render(
    app: any,
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    component: any
  ) {
    // Simple mock: convert [[wikilinks]] to <a> tags, wrap in <p>
    const html = markdown.replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, href, display) =>
        `<a data-href="${href}" href="${href}" class="internal-link">${display || href}</a>`
    );
    const p = document.createElement("p");
    p.innerHTML = html;
    el.appendChild(p);
  }
}
