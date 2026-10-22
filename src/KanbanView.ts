import { Notice, TextFileView, WorkspaceLeaf } from "obsidian";
import { flushSync, mount, unmount } from "svelte";
import type { Board } from "./types";
import type KanbanBoardPlugin from "./main";
import { parseBoard, serializeBoard } from "./parser";
import { reactive } from "./reactive.svelte";
import { reconcileIds } from "./reconcile";
import { getSortable } from "./sortable";
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

interface BoardExports {
  externalUpdate: () => void;
}

/** Text the user has typed into the board but not yet committed. */
interface Draft {
  el: HTMLTextAreaElement | HTMLInputElement;
  label: string;
  text: string;
}

export class KanbanView extends TextFileView {
  board: Board = { lanes: [], archive: [] };
  private plugin: KanbanBoardPlugin;
  private component: BoardExports | null = null;
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

  /**
   * Obsidian calls this on open (`clear` true) and whenever the file changes
   * underneath the view (`clear` false) — an external edit or a Sync pull.
   * For the latter, if the lanes are unchanged the new board is swapped into
   * the mounted component so the inputs the user is typing in, their focus
   * and the mobile keyboard all survive. Otherwise it remounts, and any
   * uncommitted text whose input was destroyed is handed back in a Notice.
   */
  setViewData(data: string, clear: boolean): void {
    const next = parseBoard(data);
    const drafts = this.collectDrafts();
    const Sortable = getSortable();
    const dragging = Sortable.dragged != null || Sortable.active != null;

    if (!clear && this.component && this.props && !dragging && reconcileIds(this.board, next)) {
      this.props.board = next;
      this.board = this.props.board;
      this.component.externalUpdate();
    } else {
      this.board = next;
      this.renderBoard();
    }
    flushSync();
    this.rescueDrafts(drafts);
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
    }) as unknown as BoardExports;
  }

  private collectDrafts(): Draft[] {
    const drafts: Draft[] = [];
    this.contentEl
      .querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("[data-draft-label]")
      .forEach((el) => {
        const text = el.value.trim();
        if (text && text !== (el.dataset.draftOriginal ?? "").trim()) {
          drafts.push({ el, label: el.dataset.draftLabel ?? "", text });
        }
      });
    return drafts;
  }

  /** Shows, until dismissed, any draft whose input no longer exists. */
  private rescueDrafts(drafts: Draft[]) {
    const lost = drafts.filter((d) => !this.contentEl.contains(d.el));
    if (lost.length === 0) return;

    const notice = new Notice("", 0);
    // `messageEl` only exists from Obsidian 1.8.7; minAppVersion is older.
    const el = notice.noticeEl;
    el.replaceChildren();
    el.classList.add("kb-draft-notice");
    el.createDiv().textContent =
      "This board changed on disk while you were typing. Unsaved text:";
    for (const draft of lost) {
      const row = el.createDiv({ cls: "kb-draft-row" });
      row.createSpan().textContent = `${draft.label}: ${draft.text}`;
      const btn = row.createEl("button", { cls: "kb-draft-copy" });
      btn.textContent = "Copy";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(draft.text);
      });
    }
  }

  private destroyComponent() {
    if (this.component) {
      void unmount(this.component);
      this.component = null;
      this.props = null;
    }
  }
}
