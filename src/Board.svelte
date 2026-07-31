<script>
  import Lane from "./Lane.svelte";
  import { getSortable } from "./sortable";
  const Sortable = getSortable();
  import { Menu, Notice, Platform } from "obsidian";
  import { onDestroy, onMount } from "svelte";
  import { generateId } from "./types";

  export let board;
  export let settings;
  export let app;
  export let viewComponent;
  export let filePath;
  export let onChange;

  let boardEl;
  let laneSortable;
  let undoNotice = null;
  let undoSubjectId = null;

  onMount(() => {
    laneSortable = new Sortable(boardEl, {
      animation: 150,
      handle: ".kb-lane-drag-handle",
      // Exclude the archive lane so it neither drags nor shifts the
      // index space that maps drop positions onto board.lanes
      draggable: ".kb-lane:not(.kb-archive-lane)",
      direction: "horizontal",
      onEnd(evt) {
        const { oldIndex, newIndex, item: el } = evt;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

        if (oldIndex < newIndex) {
          boardEl.insertBefore(el, boardEl.children[oldIndex]);
        } else {
          boardEl.insertBefore(el, boardEl.children[oldIndex + 1]);
        }

        const [lane] = board.lanes.splice(oldIndex, 1);
        board.lanes.splice(newIndex, 0, lane);
        board = board;
        save();
      },
    });

    // On mobile, the browser auto-scrolls ancestor elements when an input
    // gets focus (to keep it visible above the virtual keyboard).  We can't
    // control Obsidian's containers via CSS, so we walk up from .kb-view
    // and reset any unwanted scrollTop after the browser finishes scrolling.
    let cleanupMobile;
    if (Platform.isMobile) {
      const viewEl = boardEl.closest(".kb-view");

      function resetAncestorScroll() {
        let el = viewEl;
        while (el) {
          if (el.scrollTop !== 0) el.scrollTop = 0;
          el = el.parentElement;
        }
      }

      function onFocusIn() {
        requestAnimationFrame(resetAncestorScroll);
        setTimeout(resetAncestorScroll, 120);
      }

      boardEl.addEventListener("focusin", onFocusIn);
      cleanupMobile = () => boardEl.removeEventListener("focusin", onFocusIn);
    }

    return () => {
      laneSortable?.destroy();
      cleanupMobile?.();
    };
  });

  // The undo closures reference this component's board; if the component
  // is torn down (file closed, external re-render) the toast must go too.
  onDestroy(() => {
    undoNotice?.hide();
    undoNotice = null;
    undoSubjectId = null;
  });

  function save() {
    onChange(board);
  }

  /**
   * Retires a pending undo whose subject has since been acted on. Without
   * this the "Card archived" toast stays clickable after the card has been
   * restored by hand, and clicking it would do nothing.
   */
  function invalidateUndo(subjectId) {
    if (undoSubjectId !== null && undoSubjectId === subjectId) {
      undoNotice?.hide();
      undoNotice = null;
      undoSubjectId = null;
    }
  }

  // `undo` reverses just the action that triggered the toast, so other
  // changes made while the toast is visible are kept. `subjectId` is the
  // card or list the undo would restore; see invalidateUndo.
  function showUndoToast(message, undo, subjectId = null) {
    undoNotice?.hide();
    undoSubjectId = subjectId;
    const notice = new Notice("", 7000);
    undoNotice = notice;
    const el = notice.noticeEl;
    el.replaceChildren();
    el.classList.add("kb-undo-notice");
    const span = document.createElement("span");
    span.textContent = message;
    el.appendChild(span);
    const btn = document.createElement("button");
    btn.className = "kb-undo-btn";
    btn.textContent = "Undo";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      undo();
      board = board;
      save();
      notice.hide();
      if (undoNotice === notice) {
        undoNotice = null;
        undoSubjectId = null;
      }
    });
    el.appendChild(btn);
  }

  /**
   * `MenuItem.setSubmenu()` is absent from Obsidian's published typings, so
   * it can change or disappear without a deprecation. Feature-detect it and
   * fall back to the flat list phones already use.
   */
  function submenuFor(item, fallback) {
    /** @type {{ setSubmenu?: () => import("obsidian").Menu }} */
    const maybeNested = item;
    if (Platform.isPhone || typeof maybeNested.setSubmenu !== "function") return fallback;
    return maybeNested.setSubmenu();
  }

  function addLane() {
    board.lanes.push({ id: generateId(), title: "New List", items: [] });
    board = board;
    save();
  }

  // ── Lane events ────────────────────────────────────────

  function handleItemMove(detail) {
    const { fromLaneId, toLaneId, oldIndex, newIndex } = detail;
    const fromLane = board.lanes.find((l) => l.id === fromLaneId);
    const toLane = board.lanes.find((l) => l.id === toLaneId);
    if (!fromLane || !toLane) return;
    const [item] = fromLane.items.splice(oldIndex, 1);
    toLane.items.splice(newIndex, 0, item);
    board = board;
    save();
  }

  function handleLaneDelete(detail) {
    const idx = board.lanes.findIndex((l) => l.id === detail.laneId);
    if (idx < 0) return;
    const [lane] = board.lanes.splice(idx, 1);
    board = board;
    save();
    showUndoToast(
      `List "${lane.title}" deleted`,
      () => {
        if (board.lanes.includes(lane)) return;
        board.lanes.splice(Math.min(idx, board.lanes.length), 0, lane);
      },
      lane.id
    );
  }

  function handleLaneRename(detail) {
    const lane = board.lanes.find((l) => l.id === detail.laneId);
    if (lane) {
      lane.title = detail.title;
      board = board;
      save();
    }
  }

  function handleLaneMove(detail) {
    const { laneId, direction } = detail;
    const idx = board.lanes.findIndex((l) => l.id === laneId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= board.lanes.length) return;
    const [lane] = board.lanes.splice(idx, 1);
    board.lanes.splice(newIdx, 0, lane);
    board = board;
    save();
  }

  function handleItemAdd(detail) {
    const lane = board.lanes.find((l) => l.id === detail.laneId);
    if (lane) {
      const newItem = {
        id: generateId(),
        title: detail.title,
        checked: false,
      };
      if (settings.prependCards) {
        lane.items.unshift(newItem);
      } else {
        lane.items.push(newItem);
      }
      board = board;
      save();
    }
  }

  function handleItemEdit(detail) {
    const lane = board.lanes.find((l) => l.id === detail.laneId);
    if (lane) {
      const item = lane.items.find((i) => i.id === detail.itemId);
      if (item) {
        item.title = detail.title;
        if (detail.checked !== undefined) item.checked = detail.checked;
        board = board;
        save();
      }
    }
  }

  // ── Item context menu ──────────────────────────────────

  function handleItemShowMenu(detail) {
    const { laneId, itemId, event } = detail;
    const lane = board.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    const item = lane.items.find((i) => i.id === itemId);
    if (!item) return;

    const menu = new Menu();

    menu.addItem((i) =>
      i
        .setTitle("Edit card")
        .setIcon("pencil")
        .onClick(() => {
          setTimeout(() => {
            const el = boardEl.querySelector(
              `[data-id="${itemId}"] .kb-item-title`
            );
            el?.click();
          }, 0);
        })
    );

    menu.addItem((i) =>
      i
        .setTitle("New note from card")
        .setIcon("file-plus")
        .onClick(() => newNoteFromCard(lane, item))
    );

    menu.addSeparator();

    menu.addItem((i) =>
      i
        .setTitle("Duplicate card")
        .setIcon("copy")
        .onClick(() => {
          const idx = lane.items.indexOf(item);
          const clone = { ...item, id: generateId() };
          lane.items.splice(idx + 1, 0, clone);
          board = board;
          save();
        })
    );

    menu.addItem((i) =>
      i
        .setTitle("Move to top")
        .setIcon("arrow-up-to-line")
        .onClick(() => {
          const idx = lane.items.indexOf(item);
          if (idx > 0) {
            lane.items.splice(idx, 1);
            lane.items.unshift(item);
            board = board;
            save();
          }
        })
    );

    menu.addItem((i) =>
      i
        .setTitle("Move to bottom")
        .setIcon("arrow-down-to-line")
        .onClick(() => {
          const idx = lane.items.indexOf(item);
          if (idx < lane.items.length - 1) {
            lane.items.splice(idx, 1);
            lane.items.push(item);
            board = board;
            save();
          }
        })
    );

    // Move to list submenu
    if (board.lanes.length > 1) {
      menu.addItem((i) => {
        i.setTitle("Move to list").setIcon("arrow-right");
        const addLaneItems = (target) => {
          for (const targetLane of board.lanes) {
            target.addItem((si) => {
              si.setTitle(targetLane.title)
                .setIcon("columns-3")
                .setChecked(targetLane.id === laneId)
                .onClick(() => {
                  if (targetLane.id === laneId) return;
                  const idx = lane.items.indexOf(item);
                  lane.items.splice(idx, 1);
                  if (settings.prependCards) {
                    targetLane.items.unshift(item);
                  } else {
                    targetLane.items.push(item);
                  }
                  board = board;
                  save();
                });
            });
          }
        };

        addLaneItems(submenuFor(i, menu));
      });
    }

    menu.addSeparator();

    menu.addItem((i) =>
      i
        .setTitle("Archive card")
        .setIcon("archive")
        .onClick(() => {
          const idx = lane.items.indexOf(item);
          lane.items.splice(idx, 1);
          board.archive.push(item);
          board = board;
          save();
          showUndoToast(
            "Card archived",
            () => {
              // The card may have been restored or deleted from the archive
              // while the toast was up. Re-inserting it then would put the
              // same id into two keyed lists — Svelte throws, and a
              // multi-lane board would persist the card twice.
              if (!board.archive.some((a) => a.id === item.id)) return;
              if (!board.lanes.includes(lane)) return;
              board.archive = board.archive.filter((a) => a.id !== item.id);
              lane.items.splice(Math.min(idx, lane.items.length), 0, item);
            },
            item.id
          );
        })
    );

    menu.addItem((i) =>
      i
        .setTitle("Delete card")
        .setIcon("trash-2")
        .onClick(() => {
          const idx = lane.items.findIndex((it) => it.id === itemId);
          if (idx < 0) return;
          const [removed] = lane.items.splice(idx, 1);
          board = board;
          save();
          showUndoToast(
            "Card deleted",
            () => {
              if (!board.lanes.includes(lane)) return;
              lane.items.splice(Math.min(idx, lane.items.length), 0, removed);
            },
            removed.id
          );
        })
    );

    menu.showAtMouseEvent(event);
  }

  // ── Archive lane actions ───────────────────────────────

  function handleArchiveItemMenu(detail) {
    const { itemId, event } = detail;
    const item = board.archive.find((i) => i.id === itemId);
    if (!item) return;

    const menu = new Menu();

    if (board.lanes.length > 0) {
      menu.addItem((i) =>
        i
          .setTitle("Restore card")
          .setIcon("archive-restore")
          .onClick(() => {
            invalidateUndo(itemId);
            board.archive = board.archive.filter((i) => i.id !== itemId);
            const target = board.lanes[board.lanes.length - 1];
            if (settings.prependCards) {
              target.items.unshift(item);
            } else {
              target.items.push(item);
            }
            board = board;
            save();
          })
      );
    }

    if (board.lanes.length > 1) {
      menu.addItem((i) => {
        i.setTitle("Restore to list").setIcon("arrow-right");
        const addLaneItems = (target) => {
          for (const targetLane of board.lanes) {
            target.addItem((si) => {
              si.setTitle(targetLane.title)
                .setIcon("columns-3")
                .onClick(() => {
                  invalidateUndo(itemId);
                  board.archive = board.archive.filter((i) => i.id !== itemId);
                  if (settings.prependCards) {
                    targetLane.items.unshift(item);
                  } else {
                    targetLane.items.push(item);
                  }
                  board = board;
                  save();
                });
            });
          }
        };

        addLaneItems(submenuFor(i, menu));
      });
    }

    menu.addSeparator();

    menu.addItem((i) =>
      i
        .setTitle("Delete card")
        .setIcon("trash-2")
        .onClick(() => {
          const idx = board.archive.findIndex((i) => i.id === itemId);
          if (idx < 0) return;
          const [removed] = board.archive.splice(idx, 1);
          board = board;
          save();
          showUndoToast(
            "Card deleted",
            () => {
              if (board.archive.some((a) => a.id === removed.id)) return;
              board.archive.splice(Math.min(idx, board.archive.length), 0, removed);
            },
            removed.id
          );
        })
    );

    menu.showAtMouseEvent(event);
  }

  // ── New note from card ─────────────────────────────────

  async function newNoteFromCard(lane, item) {
    // Sanitize title for filename
    let name = item.title
      .split("\n")[0]
      .replace(/!\[\[([^\]]+)\]\]/g, "$1") // embeds
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1") // wikilinks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // md links
      .replace(/#(\w+)/g, "$1") // tags
      .replace(/[\\/:*?"<>|]/g, "") // illegal chars
      .replace(/\s+/g, " ")
      .trim();
    if (!name) name = "Untitled";

    // Determine folder (same as kanban file)
    const folder = filePath.includes("/")
      ? filePath.substring(0, filePath.lastIndexOf("/"))
      : "";
    let fullPath = folder ? `${folder}/${name}.md` : `${name}.md`;
    let n = 1;
    while (app.vault.getAbstractFileByPath(fullPath)) {
      fullPath = folder ? `${folder}/${name} ${n}.md` : `${name} ${n}.md`;
      n++;
    }

    const newFile = await app.vault.create(fullPath, "");

    // Open in new pane
    const leaf = app.workspace.getLeaf("split");
    await leaf.openFile(newFile);

    // Update card title to link
    const link = app.fileManager.generateMarkdownLink(newFile, filePath);
    item.title = link;
    board = board;
    save();
  }
</script>

<div class="kb-board" bind:this={boardEl}>
  {#each board.lanes as lane, i (lane.id)}
    <Lane
      {lane}
      {settings}
      {app}
      {viewComponent}
      {filePath}
      laneIndex={i}
      laneCount={board.lanes.length}
      onItemMove={handleItemMove}
      onLaneDelete={handleLaneDelete}
      onLaneRename={handleLaneRename}
      onLaneMove={handleLaneMove}
      onItemAdd={handleItemAdd}
      onItemEdit={handleItemEdit}
      onItemShowMenu={handleItemShowMenu}
    />
  {/each}
  {#if settings.showArchive && board.archive.length > 0}
    <div class="kb-lane kb-archive-lane">
      <div class="kb-lane-header">
        <svg class="kb-archive-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
        <h3 class="kb-lane-title" style="cursor: default;">Archive</h3>
        <span class="kb-lane-count">{board.archive.length}</span>
      </div>
      <div class="kb-lane-items">
        {#each board.archive as item (item.id)}
          <div class="kb-item kb-archive-item" data-id={item.id}>
            <span class="kb-item-title">{item.title}</span>
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <button
              class="kb-menu-btn"
              on:click={(e) => handleArchiveItemMenu({ itemId: item.id, event: e })}
              on:mousedown|stopPropagation
              on:touchstart|stopPropagation
              aria-label="Card menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
  <div class="kb-add-lane">
    <button class="kb-add-lane-btn" on:click={addLane}>+ Add List</button>
  </div>
</div>
