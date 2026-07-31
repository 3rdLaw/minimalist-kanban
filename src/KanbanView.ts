import { TextFileView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Board } from "./types";
import type KanbanBoardPlugin from "./main";
import { parseBoard, serializeBoard } from "./parser";
import { reactive } from "./reactive.svelte";
import BoardComponent from "./Board.svelte";

export const KANBAN_VIEW_TYPE = "kanban-board";

interface BoardProps {
  // `mount()` types its props bag as an index-signature record, and Board.svelte
  // has a plain-JS script so it contributes no prop types of its own.
  [key: string]: unknown;
  board: Board;
  settings: KanbanBoardPlugin["settings"];
  app: KanbanView["app"];
  viewComponent: KanbanView;
  filePath: string;
  onChange: (updatedBoard: Board) => void;
}

export class KanbanView extends TextFileView {
  board: Board = { lanes: [], archive: [] };
  private plugin: KanbanBoardPlugin;
  private component: Record<string, unknown> | null = null;
  private props: BoardProps | null = null;

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
    if (this.props) {
      this.props.settings = this.plugin.settings;
    }
  }

  private renderBoard() {
    this.destroyComponent();
    this.contentEl.empty();
    this.contentEl.addClass("kb-view");

    this.props = reactive<BoardProps>({
      board: this.board,
      settings: this.plugin.settings,
      app: this.app,
      viewComponent: this,
      filePath: this.file?.path || "",
      onChange: (updatedBoard: Board) => {
        this.board = updatedBoard;
        this.requestSave();
      },
    });

    this.component = mount(BoardComponent, {
      target: this.contentEl,
      props: this.props,
    });
  }

  private destroyComponent() {
    if (this.component) {
      void unmount(this.component);
      this.component = null;
      this.props = null;
    }
  }
}
