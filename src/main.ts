import { Plugin, WorkspaceLeaf, TFile, MarkdownView } from "obsidian";
import { KanbanView, KANBAN_VIEW_TYPE } from "./KanbanView";
import { KBSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { KBSettings } from "./settings";

export default class KanbanBoardPlugin extends Plugin {
  settings: KBSettings = { ...DEFAULT_SETTINGS };
  private bypassRedirect = false;
  private views = new Set<KanbanView>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new KBSettingTab(this.app, this));

    this.registerView(KANBAN_VIEW_TYPE, (leaf) => new KanbanView(leaf, this));

    this.addCommand({
      id: "create-kanban-board",
      name: "Create new Kanban board",
      callback: () => this.createNewBoard(),
    });

    this.addCommand({
      id: "toggle-kanban-view",
      name: "Toggle Kanban/Markdown view",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;

        if (leaf.view instanceof KanbanView) {
          if (!checking) this.toggleView(leaf);
          return true;
        }

        if (leaf.view instanceof MarkdownView) {
          const file = leaf.view.file;
          if (file && this.isKanbanFileSync(file.path)) {
            if (!checking) this.toggleView(leaf);
            return true;
          }
        }

        return false;
      },
    });

    this.patchSetViewState();
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.injectToggleButtons())
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.views.forEach((v) => v.onSettingsChanged());
  }

  registerKanbanView(view: KanbanView) {
    this.views.add(view);
  }

  unregisterKanbanView(view: KanbanView) {
    this.views.delete(view);
  }

  private patchSetViewState() {
    const plugin = this;
    const proto = WorkspaceLeaf.prototype as any;
    const original = proto.setViewState;

    proto.setViewState = async function (
      this: WorkspaceLeaf,
      state: any,
      ...rest: any[]
    ) {
      if (
        !plugin.bypassRedirect &&
        state.type === "markdown" &&
        state.state?.file
      ) {
        // Don't redirect if already viewing this file as markdown
        // (e.g. toggling source/reading mode)
        const currentFile = (this.view as any)?.file?.path;
        const alreadyMarkdown =
          this.view instanceof MarkdownView &&
          currentFile === state.state.file;

        if (!alreadyMarkdown) {
          const isKanban = await plugin.checkIsKanban(state.state.file);
          if (isKanban) {
            const newState = { ...state, type: KANBAN_VIEW_TYPE };
            return original.call(this, newState, ...rest);
          }
        }
      }
      return original.call(this, state, ...rest);
    };

    this.register(() => {
      proto.setViewState = original;
    });
  }

  private isKanbanFileSync(path: string): boolean {
    const cache = this.app.metadataCache.getCache(path);
    return cache?.frontmatter?.["kanban-plugin"] === "board";
  }

  private async checkIsKanban(path: string): Promise<boolean> {
    if (this.isKanbanFileSync(path)) return true;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;

    try {
      const content = await this.app.vault.cachedRead(file);
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      return fm?.[1]?.includes("kanban-plugin: board") ?? false;
    } catch {
      return false;
    }
  }

  private injectToggleButtons() {
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const file = leaf.view.file;
      if (!file || !this.isKanbanFileSync(file.path)) return;

      // Don't add if already present
      const actions = (leaf.view as any).actionsEl as HTMLElement | undefined;
      if (!actions || actions.querySelector("[data-kb-toggle]")) return;

      const btn = actions.createEl("a", {
        cls: "view-action",
        attr: { "aria-label": "Switch to Kanban view", "data-kb-toggle": "1" },
      });
      // columns-3 icon (same as kanban view icon)
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="6" height="18" rx="1"/><rect x="9" y="3" width="6" height="12" rx="1"/><rect x="16" y="3" width="6" height="8" rx="1"/></svg>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.toggleView(leaf);
      });
    });
  }

  async toggleViewFromView(view: KanbanView) {
    await this.toggleView(view.leaf);
  }

  private async toggleView(leaf: WorkspaceLeaf) {
    const file = (leaf.view as any).file as TFile | undefined;
    if (!file) return;

    const isKanban = leaf.view instanceof KanbanView;

    this.bypassRedirect = true;
    try {
      if (isKanban) {
        await leaf.setViewState({
          type: "markdown",
          state: { file: file.path },
        });
      } else {
        await leaf.setViewState({
          type: KANBAN_VIEW_TYPE,
          state: { file: file.path },
        });
      }
    } finally {
      this.bypassRedirect = false;
    }
  }

  async createNewBoard() {
    const content =
      "---\nkanban-plugin: board\n---\n\n## To Do\n\n## In Progress\n\n## Done\n";

    let name = "Kanban Board.md";
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(name)) {
      name = `Kanban Board ${counter}.md`;
      counter++;
    }

    const file = await this.app.vault.create(name, content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }
}
