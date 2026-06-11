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

// ── Notice ────────────────────────────────────────────────

export class Notice {
  static instances: Notice[] = [];
  noticeEl: HTMLElement;
  hidden = false;

  constructor(message: string, _timeout?: number) {
    this.noticeEl = document.createElement("div");
    if (message) this.noticeEl.textContent = message;
    Notice.instances.push(this);
  }

  setMessage(message: string) {
    this.noticeEl.textContent = message;
    return this;
  }

  hide() {
    this.hidden = true;
  }
}

// ── Minimal stubs for types used in imports ───────────────

export class TFile {
  path = "";
  basename = "";
  extension = "md";
  parent: { path: string } | null = null;
  stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TextFileView {
  leaf: any;
  app: any = {};
  file: TFile | null = null;
  data = "";
  contentEl: HTMLElement;
  addAction = vi.fn();

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
  registerEvent = vi.fn();
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
  static instances: Setting[] = [];
  name = "";
  desc = "";
  toggle: {
    value: boolean;
    changeHandler: ((v: boolean) => unknown) | null;
    setValue(v: boolean): unknown;
    onChange(handler: (v: boolean) => unknown): unknown;
  } | null = null;

  constructor(_el: HTMLElement) {
    Setting.instances.push(this);
  }
  setName(n: string) { this.name = n; return this; }
  setDesc(d: string) { this.desc = d; return this; }
  addToggle(cb: any) {
    const toggle = {
      value: false,
      changeHandler: null as ((v: boolean) => unknown) | null,
      setValue(v: boolean) { toggle.value = v; return toggle; },
      onChange(handler: (v: boolean) => unknown) { toggle.changeHandler = handler; return toggle; },
    };
    this.toggle = toggle;
    cb(toggle);
    return this;
  }
}

export class WorkspaceLeaf {
  view: any = {};
  lastViewState: any = null;
  openFile = vi.fn().mockResolvedValue(undefined);

  async setViewState(state: any, _eState?: unknown): Promise<void> {
    this.lastViewState = state;
  }
}

export class MarkdownView {
  file: TFile | null = null;
}

export const setIcon = vi.fn();

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
