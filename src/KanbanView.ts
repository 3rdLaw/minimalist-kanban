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

const CLOSED_BEFORE_ADDED = "The board was closed before this was added.";

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
    // `clear` is a file being opened in this view: Obsidian only calls
    // clear() first when the previous file had unsaved changes.
    this.rescueDrafts(
      drafts,
      clear ? CLOSED_BEFORE_ADDED : "This board changed on disk while you were typing."
    );
  }

  /** Obsidian calls this when the view moves to another file, after saving. */
  clear(): void {
    this.teardown();
    this.board = { lanes: [], archive: [] };
  }

  onClose(): Promise<void> {
    this.teardown();
    return Promise.resolve();
  }

  /**
   * Unmounts outside the normal render cycle. The save has already run, so
   * any text still in an input is handed back rather than lost.
   */
  private teardown() {
    const drafts = this.collectDrafts();
    this.destroyComponent();
    this.rescueDrafts(drafts, CLOSED_BEFORE_ADDED);
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

    const props: BoardProps = reactive<BoardProps>({
      board: this.board,
      settings: this.plugin.settings,
      app: this.app,
      viewComponent: this,
      filePath: this.file?.path || "",
      onChange: (updatedBoard: Board) => {
        // A component being torn down can still fire: removing a focused
        // input blurs it, which commits an inline edit. Its board is the one
        // being replaced, so accepting it would put the old board back on
        // disk over the change that caused the remount.
        if (this.props !== props) return;
        this.board = updatedBoard;
        this.requestSave();
      },
    });
    this.props = props;

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

  /**
   * Shows any draft whose input no longer exists, in a Notice that only its
   * own Dismiss button closes: it holds the only copy of the text.
   */
  private rescueDrafts(drafts: Draft[], intro: string) {
    const lost = drafts.filter((d) => !this.contentEl.contains(d.el));
    if (lost.length === 0) return;

    const notice = new Notice("", 0);
    // `messageEl` only exists from Obsidian 1.8.7; minAppVersion is older.
    const el = notice.noticeEl;
    el.replaceChildren();
    el.classList.add("kb-draft-notice");
    // Obsidian hides a notice on any click inside it; this one must survive
    // selecting its text or a stray tap. (Swipe-to-dismiss on phones remains.)
    el.addEventListener("click", (e) => e.stopPropagation());
    el.createDiv().textContent = `${intro} Unsaved text:`;
    for (const draft of lost) {
      const row = el.createDiv({ cls: "kb-draft-row" });
      row.createSpan().textContent = `${draft.label}: ${draft.text}`;
      const btn = row.createEl("button", { cls: "kb-draft-copy" });
      btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(draft.text).then(
          () => { btn.textContent = "Copied"; },
          () => { btn.textContent = "Copy failed — select the text"; }
        );
      });
    }
    const dismiss = el.createEl("button", { cls: "kb-draft-dismiss" });
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => notice.hide());
  }

  private destroyComponent() {
    if (this.component) {
      // Cleared first, so the dying component's onChange is ignored.
      this.props = null;
      const component = this.component;
      this.component = null;
      void unmount(component);
    }
  }
}
