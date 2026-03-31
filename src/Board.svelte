<script>
  import Lane from "./Lane.svelte";
  import { getSortable } from "./sortable";
  const Sortable = getSortable();
  import { Menu, Platform, TFile } from "obsidian";
  import { onMount } from "svelte";

  export let board;
  export let settings;
  export let app;
  export let viewComponent;
  export let filePath;
  export let onChange;

  let boardEl;
  let laneSortable;

  let counter = 0;
  function genId() {
    return "kb-" + Date.now().toString(36) + "-" + (counter++).toString(36);
  }

  onMount(() => {
    laneSortable = new Sortable(boardEl, {
      animation: 150,
      handle: ".kb-lane-drag-handle",
      draggable: ".kb-lane",
      direction: "horizontal",
      onEnd(evt) {
        const { oldIndex, newIndex, item: el } = evt;
        if (oldIndex === newIndex) return;

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

    return () => laneSortable?.destroy();
  });

  function save() {
    onChange(board);
  }

  function addLane() {
    board.lanes.push({ id: genId(), title: "New List", items: [] });
    board = board;
    save();
  }

  // ── Lane events ────────────────────────────────────────

  function handleItemMove(e) {
    const { fromLaneId, toLaneId, oldIndex, newIndex } = e.detail;
    const fromLane = board.lanes.find((l) => l.id === fromLaneId);
    const toLane = board.lanes.find((l) => l.id === toLaneId);
    if (!fromLane || !toLane) return;
    const [item] = fromLane.items.splice(oldIndex, 1);
    toLane.items.splice(newIndex, 0, item);
    board = board;
    save();
  }

  function handleLaneDelete(e) {
    board.lanes = board.lanes.filter((l) => l.id !== e.detail.laneId);
    save();
  }

  function handleLaneRename(e) {
    const lane = board.lanes.find((l) => l.id === e.detail.laneId);
    if (lane) {
      lane.title = e.detail.title;
      board = board;
      save();
    }
  }

  function handleLaneMove(e) {
    const { laneId, direction } = e.detail;
    const idx = board.lanes.findIndex((l) => l.id === laneId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= board.lanes.length) return;
    const [lane] = board.lanes.splice(idx, 1);
    board.lanes.splice(newIdx, 0, lane);
    board = board;
    save();
  }

  function handleItemAdd(e) {
    const lane = board.lanes.find((l) => l.id === e.detail.laneId);
    if (lane) {
      const newItem = {
        id: genId(),
        title: e.detail.title,
        checked: false,
        hasCheckbox: true,
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

  function handleItemDelete(e) {
    const lane = board.lanes.find((l) => l.id === e.detail.laneId);
    if (lane) {
      lane.items = lane.items.filter((i) => i.id !== e.detail.itemId);
      board = board;
      save();
    }
  }

  function handleItemEdit(e) {
    const lane = board.lanes.find((l) => l.id === e.detail.laneId);
    if (lane) {
      const item = lane.items.find((i) => i.id === e.detail.itemId);
      if (item) {
        item.title = e.detail.title;
        if (e.detail.checked !== undefined) item.checked = e.detail.checked;
        board = board;
        save();
      }
    }
  }

  // ── Item context menu ──────────────────────────────────

  function handleItemShowMenu(e) {
    const { laneId, itemId, event } = e.detail;
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
          const clone = { ...item, id: genId() };
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

        if (Platform.isPhone) {
          addLaneItems(menu);
        } else {
          addLaneItems(i.setSubmenu());
        }
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
        })
    );

    menu.addItem((i) =>
      i
        .setTitle("Delete card")
        .setIcon("trash-2")
        .onClick(() => {
          lane.items = lane.items.filter((it) => it.id !== itemId);
          board = board;
          save();
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
      on:itemmove={handleItemMove}
      on:lanedelete={handleLaneDelete}
      on:lanerename={handleLaneRename}
      on:lanemove={handleLaneMove}
      on:itemadd={handleItemAdd}
      on:itemdelete={handleItemDelete}
      on:itemedit={handleItemEdit}
      on:itemshowmenu={handleItemShowMenu}
    />
  {/each}
  <div class="kb-add-lane">
    <button class="kb-add-lane-btn" on:click={addLane}>+ Add List</button>
  </div>
</div>
