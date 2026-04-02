<script>
  import { MarkdownRenderer, Platform } from "obsidian";
  import { createEventDispatcher, afterUpdate, onMount, tick } from "svelte";

  export let item;
  export let settings;
  export let app;
  export let viewComponent;
  export let filePath;

  const dispatch = createEventDispatcher();

  let editing = false;
  let editValue = "";
  let editInput;
  let titleEl;
  let lastRenderedTitle = "";

  async function renderMarkdown(el) {
    if (!el || !app) return;
    if (lastRenderedTitle === item.title) return;
    lastRenderedTitle = item.title;
    while (el.firstChild) el.removeChild(el.firstChild);
    await MarkdownRenderer.render(app, item.title, el, filePath, viewComponent);
    // Unwrap <p> tags for inline display — join with <br> to preserve line breaks
    const paragraphs = el.querySelectorAll("p");
    if (paragraphs.length > 0) {
      const fragment = document.createDocumentFragment();
      paragraphs.forEach((p, i) => {
        if (i > 0) fragment.appendChild(document.createElement("br"));
        fragment.append(...p.childNodes);
      });
      el.replaceChildren(fragment);
    }
    // Strip leading newlines from text nodes after <br> to avoid double breaks with pre-wrap
    el.querySelectorAll("br").forEach((br) => {
      const next = br.nextSibling;
      if (next && next.nodeType === 3 && next.textContent) {
        next.textContent = next.textContent.replace(/^\n/, "");
      }
    });
    // Make internal links clickable (Ctrl/Cmd+Click opens in new tab)
    el.querySelectorAll("a.internal-link").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const href = a.dataset.href || a.getAttribute("href");
        const newTab = e.ctrlKey || e.metaKey;
        app.workspace.openLinkText(href, filePath, newTab ? "tab" : false);
      });
    });
    // Make external links open in browser
    el.querySelectorAll("a.external-link").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    });
  }

  onMount(() => {
    if (titleEl) renderMarkdown(titleEl);
  });

  afterUpdate(() => {
    if (!editing && titleEl) {
      renderMarkdown(titleEl);
    }
  });

  function autoResize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function handleTitleClick(e) {
    // Ctrl/Cmd+Click: if the click didn't land on a rendered link,
    // try to extract a wikilink from the raw title and open it
    if ((e.ctrlKey || e.metaKey) && titleEl) {
      const wikiMatch = item.title.match(/\[\[([^\]|]+)/);
      if (wikiMatch) {
        e.preventDefault();
        app.workspace.openLinkText(wikiMatch[1], filePath, "tab");
        return;
      }
    }
    startEdit();
  }

  function startEdit() {
    editing = true;
    editValue = item.title;
    lastRenderedTitle = "";
    setTimeout(() => {
      if (editInput) {
        autoResize(editInput);
        editInput.focus();
        editInput.select();
        if (Platform.isMobile) {
          // On mobile, the keyboard triggers a delayed container resize.
          // Wait for it to settle, then scroll the card into view.
          // Fire twice — the resize timing varies by device.
          const card = editInput.closest(".kb-item");
          setTimeout(() => card?.scrollIntoView({ block: "nearest" }), 500);
          setTimeout(() => card?.scrollIntoView({ block: "nearest" }), 1000);
        }
      }
    }, 0);
  }

  function finishEdit() {
    if (!editing) return;
    editing = false;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== item.title) {
      dispatch("edit", { itemId: item.id, title: trimmed });
    }
  }

  function handleKeydown(e) {
    if (e.isComposing) return;
    const isSubmit = settings.enterNewline
      ? e.key === "Enter" && e.shiftKey
      : e.key === "Enter" && !e.shiftKey;

    if (isSubmit) {
      e.preventDefault();
      editInput?.blur();
    } else if (e.key === "Escape") {
      editing = false;
    }
  }

  function toggleChecked(e) {
    e.stopPropagation();
    dispatch("edit", {
      itemId: item.id,
      title: item.title,
      checked: !item.checked,
    });
  }

  function showMenu(e) {
    e.stopPropagation();
    dispatch("showmenu", { itemId: item.id, event: e });
  }
</script>

<div class="kb-item" data-id={item.id}>
  {#if settings.showCheckboxes && item.hasCheckbox}
    <input
      type="checkbox"
      checked={item.checked}
      on:change={toggleChecked}
      class="kb-item-checkbox"
    />
  {/if}
  {#if editing}
    <textarea
      bind:this={editInput}
      bind:value={editValue}
      on:blur={finishEdit}
      on:keydown={handleKeydown}
      on:input={() => autoResize(editInput)}
      class="kb-item-edit"
      rows="1"
    ></textarea>
  {:else}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <span class="kb-item-title" bind:this={titleEl} on:click={handleTitleClick}></span>
  {/if}
  <button
    class="kb-menu-btn"
    on:click={showMenu}
    on:mousedown|stopPropagation
    on:touchstart|stopPropagation
    aria-label="Card menu"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
  </button>
</div>
