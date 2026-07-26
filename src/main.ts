import { Plugin, WorkspaceLeaf, TFile, MarkdownView, setIcon, ViewState } from "obsidian";
import { around } from "monkey-around";
import { KanbanView, KANBAN_VIEW_TYPE } from "./KanbanView";
import { KBSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { KBSettings } from "./settings";

export default class KanbanBoardPlugin extends Plugin {
  settings: KBSettings = { ...DEFAULT_SETTINGS };
  private bypassRedirectLeaves = new WeakSet<WorkspaceLeaf>();
  /** Most recent intercepted setViewState request per leaf; see patchSetViewState. */
  private redirectSeq = new WeakMap<WorkspaceLeaf, number>();

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
    const isBypassed = (leaf: WorkspaceLeaf) => this.bypassRedirectLeaves.has(leaf);
    const checkIsKanban = (path: string) => this.checkIsKanban(path);

    // Deciding whether to redirect can require reading the file, so two view
    // state changes for the same leaf can finish out of order and let an
    // older navigation land on top of a newer one. Each interception takes a
    // token; a request that is no longer the leaf's latest is abandoned.
    const claimLeaf = (leaf: WorkspaceLeaf) => {
      const token = (this.redirectSeq.get(leaf) ?? 0) + 1;
      this.redirectSeq.set(leaf, token);
      return token;
    };
    const stillCurrent = (leaf: WorkspaceLeaf, token: number) =>
      this.redirectSeq.get(leaf) === token;

    type SetViewStateFn = (viewState: ViewState, eState?: unknown) => Promise<void>;

    // monkey-around chains correctly if other plugins patch the same
    // method, regardless of install/uninstall order
    this.register(
      around(WorkspaceLeaf.prototype as unknown as { setViewState: SetViewStateFn }, {
        setViewState(original: SetViewStateFn): SetViewStateFn {
          return async function (
            this: WorkspaceLeaf,
            state: ViewState,
            eState?: unknown
          ): Promise<void> {
            const token = claimLeaf(this);
            if (
              !isBypassed(this) &&
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
                // A newer request for this leaf started while we were
                // deciding; applying ours now would undo it.
                if (!stillCurrent(this, token)) return;
                if (isKanban) {
                  const newState: ViewState = { ...state, type: KANBAN_VIEW_TYPE };
                  return original.call(this, newState, eState);
                }
              }
            }
            return original.call(this, state, eState);
          };
        },
      })
    );
  }

  private isKanbanFileSync(path: string): boolean {
    const cache = this.app.metadataCache.getCache(path);
    return cache?.frontmatter?.["kanban-plugin"] === "board";
  }

  private async checkIsKanban(path: string): Promise<boolean> {
    if (this.isKanbanFileSync(path)) return true;

    // A file the vault has indexed has known frontmatter, so the answer is
    // already no. Only unindexed files — just created, or opened before the
    // vault finished loading — need the read below. That matters because
    // this sits in front of every markdown navigation: without it, opening
    // any ordinary note awaits a full read of its contents.
    if (this.app.metadataCache.getCache(path)) return false;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;

    try {
      const content = await this.app.vault.cachedRead(file);
      // Delimiters tolerate trailing spaces; otherwise the lazy match could
      // run past an unrecognized closer and capture body text as frontmatter.
      const fm = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
      return /(?:^|\r?\n)kanban-plugin\s*:\s*(?:board|"board"|'board')\s*(?=\r?$|\r?\n)/.test(
        fm?.[1] ?? ""
      );
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

    this.bypassRedirectLeaves.add(leaf);
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
      this.bypassRedirectLeaves.delete(leaf);
    }
  }

  async createNewBoard() {
    const content =
      "---\nkanban-plugin: board\n---\n\n## To Do\n\n## In Progress\n\n## Done\n";

    // Respect the user's "default location for new notes" setting
    const folder = this.app.fileManager.getNewFileParent("");
    const prefix =
      folder.path === "/" || folder.path === "" ? "" : `${folder.path}/`;

    let name = `${prefix}Kanban Board.md`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(name)) {
      name = `${prefix}Kanban Board ${counter}.md`;
      counter++;
    }

    const file = await this.app.vault.create(name, content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }
}
