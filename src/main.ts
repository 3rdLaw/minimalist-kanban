import { Plugin, WorkspaceLeaf, TFile, MarkdownView, setIcon, ViewState } from "obsidian";
import { KanbanView, KANBAN_VIEW_TYPE } from "./KanbanView";
import { KBSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { KBSettings } from "./settings";

export default class KanbanBoardPlugin extends Plugin {
  settings: KBSettings = { ...DEFAULT_SETTINGS };
  private bypassRedirect = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new KBSettingTab(this.app, this));

    this.registerView(KANBAN_VIEW_TYPE, (leaf) => new KanbanView(leaf, this));

    this.addCommand({
      id: "create-kanban-board",
      name: "Create new kanban board",
      callback: () => { void this.createNewBoard(); },
    });

    this.addCommand({
      id: "toggle-kanban-view",
      name: "Toggle kanban/Markdown view",
      checkCallback: (checking) => {
        const kanbanView = this.app.workspace.getActiveViewOfType(KanbanView);
        if (kanbanView) {
          if (!checking) void this.toggleView(kanbanView.leaf);
          return true;
        }

        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView) {
          const file = mdView.file;
          if (file && this.isKanbanFileSync(file.path)) {
            if (!checking) void this.toggleView(mdView.leaf);
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
    const saved = (await this.loadData()) as Partial<KBSettings> | undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof KanbanView) {
        leaf.view.onSettingsChanged();
      }
    });
  }

  private patchSetViewState() {
    const isBypassed = () => this.bypassRedirect;
    const checkIsKanban = (path: string) => this.checkIsKanban(path);

    type SetViewStateFn = (viewState: ViewState, eState?: unknown) => Promise<void>;
    const proto = WorkspaceLeaf.prototype as unknown as { setViewState: SetViewStateFn };
    const original = proto.setViewState;

    proto.setViewState = async function (
      this: WorkspaceLeaf,
      state: ViewState,
      eState?: unknown
    ): Promise<void> {
      if (
        !isBypassed() &&
        state.type === "markdown" &&
        state.state?.file
      ) {
        // Don't redirect if already viewing this file as markdown
        // (e.g. toggling source/reading mode)
        const currentFile =
          this.view instanceof MarkdownView ? this.view.file?.path : undefined;
        const alreadyMarkdown =
          this.view instanceof MarkdownView &&
          currentFile === state.state.file;

        if (!alreadyMarkdown) {
          const isKanban = await checkIsKanban(state.state.file as string);
          if (isKanban) {
            const newState: ViewState = { ...state, type: KANBAN_VIEW_TYPE };
            return original.call(this, newState, eState);
          }
        }
      }
      return original.call(this, state, eState);
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
      const actions = (leaf.view as unknown as { actionsEl?: HTMLElement }).actionsEl;
      if (!actions || actions.querySelector("[data-kb-toggle]")) return;

      const btn = actions.createEl("a", {
        cls: "view-action",
        attr: { "aria-label": "Switch to kanban view", "data-kb-toggle": "1" },
      });
      setIcon(btn, "columns-3");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        void this.toggleView(leaf);
      });
    });
  }

  async toggleViewFromView(view: KanbanView) {
    await this.toggleView(view.leaf);
  }

  private async toggleView(leaf: WorkspaceLeaf) {
    const view = leaf.view;
    const file = view instanceof KanbanView ? view.file
      : view instanceof MarkdownView ? view.file
      : undefined;
    if (!file) return;

    const isKanban = view instanceof KanbanView;

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
