<script>
  import Item from "./Item.svelte";
  import { getSortable } from "./sortable";
  const Sortable = getSortable();
  import { Menu } from "obsidian";
  import { createEventDispatcher, onMount } from "svelte";

  export let lane;
  export let settings;
  export let app;
  export let viewComponent;
  export let filePath;
  export let laneIndex;
  export let laneCount;

  const dispatch = createEventDispatcher();

  let itemsEl;
  let sortableInstance;
  let editingTitle = false;
  let titleInput;
  let newItemTitle = "";

  onMount(() => {
    sortableInstance = new Sortable(itemsEl, {
      group: "kb-items",
      animation: 150,
      draggable: ".kb-item",
      filter: ".kb-menu-btn",
      preventOnFilter: false,
      delay: 150,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      onEnd(evt) {
        const { from, to, oldIndex, newIndex, item: el } = evt;

        // Undo SortableJS DOM manipulation so Svelte stays in control
        if (from !== to) {
          to.removeChild(el);
          from.insertBefore(el, from.children[oldIndex] || null);
        } else if (oldIndex !== newIndex) {
          if (oldIndex < newIndex) {
            from.insertBefore(el, from.children[oldIndex]);
          } else {
            from.insertBefore(el, from.children[oldIndex + 1]);
          }
        }

        dispatch("itemmove", {
          fromLaneId: from.dataset.laneId,
          toLaneId: to.dataset.laneId,
          oldIndex,
          newIndex,
        });
      },
    });

    return () => sortableInstance?.destroy();
  });

  function startEditTitle() {
    editingTitle = true;
    setTimeout(() => titleInput?.focus(), 0);
  }

  function finishEditTitle() {
    if (!editingTitle) return;
    editingTitle = false;
    const trimmed = lane.title.trim();
    if (trimmed) {
      dispatch("lanerename", { laneId: lane.id, title: trimmed });
    }
  }

  function handleTitleKeydown(e) {
    if (e.key === "Enter") titleInput?.blur();
    else if (e.key === "Escape") editingTitle = false;
  }

  function deleteLane() {
    dispatch("lanedelete", { laneId: lane.id });
  }

  function showLaneMenu(e) {
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle("Edit list name")
        .setIcon("pencil")
        .onClick(() => startEditTitle())
    );
    if (laneCount > 1) {
      menu.addSeparator();
      if (laneIndex > 0) {
        menu.addItem((i) =>
          i
            .setTitle("Move list left")
            .setIcon("arrow-left")
            .onClick(() => dispatch("lanemove", { laneId: lane.id, direction: -1 }))
        );
      }
      if (laneIndex < laneCount - 1) {
        menu.addItem((i) =>
          i
            .setTitle("Move list right")
            .setIcon("arrow-right")
            .onClick(() => dispatch("lanemove", { laneId: lane.id, direction: 1 }))
        );
      }
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Delete list")
        .setIcon("trash-2")
        .onClick(() => deleteLane())
    );
    menu.showAtMouseEvent(e);
  }

  function submitNewItem() {
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    dispatch("itemadd", { laneId: lane.id, title: trimmed });
    newItemTitle = "";
  }

  function handleAddKeydown(e) {
    if (e.isComposing) return;
    const isSubmit = settings.enterNewline
      ? e.key === "Enter" && e.shiftKey
      : e.key === "Enter" && !e.shiftKey;

    if (isSubmit) {
      e.preventDefault();
      submitNewItem();
    }
  }

  function handleItemDelete(e) {
    dispatch("itemdelete", { laneId: lane.id, itemId: e.detail.itemId });
  }

  function handleItemEdit(e) {
    dispatch("itemedit", { laneId: lane.id, ...e.detail });
  }

  function handleItemShowMenu(e) {
    dispatch("itemshowmenu", { laneId: lane.id, ...e.detail });
  }
</script>

<div class="kb-lane">
  <div class="kb-lane-header">
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="kb-lane-drag-handle" on:mousedown|stopPropagation on:touchstart|stopPropagation>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>
    </div>
    {#if editingTitle}
      <input
        bind:this={titleInput}
        bind:value={lane.title}
        on:blur={finishEditTitle}
        on:keydown={handleTitleKeydown}
        class="kb-lane-title-input"
      />
    {:else}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <h3 class="kb-lane-title" on:click={startEditTitle}>{lane.title}</h3>
    {/if}
    <span class="kb-lane-count">{lane.items.length}</span>
    <button class="kb-menu-btn" on:click={showLaneMenu} aria-label="List menu">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </button>
  </div>

  <div class="kb-lane-items" data-lane-id={lane.id} bind:this={itemsEl}>
    {#each lane.items as item (item.id)}
      <Item
        {item}
        {settings}
        {app}
        {viewComponent}
        {filePath}
        on:delete={handleItemDelete}
        on:edit={handleItemEdit}
        on:showmenu={handleItemShowMenu}
      />
    {/each}
  </div>

  <div class="kb-lane-footer">
    <textarea
      bind:value={newItemTitle}
      on:keydown={handleAddKeydown}
      placeholder="+ Add a card"
      class="kb-add-item-input"
      rows="1"
    ></textarea>
  </div>
</div>
