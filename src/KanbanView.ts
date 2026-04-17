import { TextFileView, WorkspaceLeaf } from "obsidian";
import type { Board } from "./types";
import type KanbanBoardPlugin from "./main";
import { parseBoard, serializeBoard } from "./parser";
import BoardComponent from "./Board.svelte";

export const KANBAN_VIEW_TYPE = "kanban-board";

export class KanbanView extends TextFileView {
  board: Board = { lanes: [], archive: [] };
  private plugin: KanbanBoardPlugin;
  private component: BoardComponent | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: KanbanBoardPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.addAction("file-text", "Toggle markdown view", () => {
      void this.plugin.toggleViewFromView(this);
    });
  }

  getViewType(): string {
    return KANBAN_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Kanban Board";
  }

  getIcon(): string {
    return "columns-3";
  }

  getViewData(): string {
    return serializeBoard(this.board);
  }

  setViewData(data: string, clear: boolean): void {
    this.board = parseBoard(data);
    this.renderBoard();
  }

  clear(): void {
    this.board = { lanes: [], archive: [] };
    this.destroyComponent();
  }

  onClose(): Promise<void> {
    this.destroyComponent();
    return Promise.resolve();
  }

  onSettingsChanged() {
    if (this.component) {
      this.component.$set({ settings: this.plugin.settings });
    }
  }

  private renderBoard() {
    this.destroyComponent();
    this.contentEl.empty();
    this.contentEl.addClass("kb-view");

    this.component = new BoardComponent({
      target: this.contentEl,
      props: {
        board: this.board,
        settings: this.plugin.settings,
        app: this.app,
        viewComponent: this,
        filePath: this.file?.path || "",
        onChange: (updatedBoard: Board) => {
          this.board = updatedBoard;
          this.requestSave();
        },
      },
    });
  }

  private destroyComponent() {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
  }
}
