<script>
  import { MarkdownRenderer, Platform } from "obsidian";
  import { createEventDispatcher, afterUpdate, onDestroy, onMount } from "svelte";
  import { LinkSuggest } from "./LinkSuggest";

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
  let renderVersion = 0;
  let linkSuggest;

  function renderMarkdown(el) {
    if (!el || !app) return;
    if (lastRenderedTitle === item.title) return;
    const version = ++renderVersion;
    lastRenderedTitle = item.title;
    const title = item.title;
    // Render off-DOM: an older asynchronous render must never be able to
    // append stale content into the visible card while a newer one is pending.
    const renderedEl = document.createElement("div");
    const applyRender = () => {
      if (version !== renderVersion || title !== item.title) return;
      el.replaceChildren(...renderedEl.childNodes);
      // Unwrap <p> tags for inline display — join with <br> to preserve line
      // breaks. Only when every top-level block is a <p>: mixed output (a
      // paragraph followed by a list, say) must keep its other blocks.
      const blocks = Array.from(el.children);
      if (blocks.length > 0 && blocks.every((b) => b.tagName === "P")) {
        const fragment = document.createDocumentFragment();
        blocks.forEach((p, i) => {
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
    };
    const rendered = MarkdownRenderer.render(app, title, renderedEl, filePath, viewComponent);
    if (rendered && typeof rendered.then === "function") {
      rendered.then(applyRender, () => {
        // Failed render: clear the memo (unless a newer render superseded
        // this one) so the next update retries instead of staying blank.
        if (version === renderVersion) lastRenderedTitle = "";
      });
    } else {
      applyRender();
    }
  }

  onMount(() => {
    if (titleEl) renderMarkdown(titleEl);
  });

  // If the card unmounts mid-edit (board re-render, lane deleted), the
  // suggestion popup lives in document.body and must be removed here.
  onDestroy(() => {
    linkSuggest?.destroy();
    linkSuggest = null;
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
        if (Platform.isMobile) {
          const end = editInput.value.length;
          editInput.setSelectionRange(end, end);
        } else {
          editInput.select();
        }
        linkSuggest = new LinkSuggest(app, filePath);
        linkSuggest.attach(editInput);
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
    linkSuggest?.destroy();
    linkSuggest = null;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== item.title) {
      dispatch("edit", { itemId: item.id, title: trimmed });
    }
  }

  function handleKeydown(e) {
    if (e.isComposing) return;
    if (linkSuggest?.handleKeydown(e)) return;

    const isSubmit = settings.enterNewline
      ? e.key === "Enter" && e.shiftKey
      : e.key === "Enter" && !e.shiftKey;

    if (isSubmit) {
      e.preventDefault();
      editInput?.blur();
    } else if (e.key === "Escape") {
      linkSuggest?.destroy();
      linkSuggest = null;
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
  {#if settings.showCheckboxes}
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
