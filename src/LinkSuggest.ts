import type { App, TFile } from "obsidian";

export interface LinkSuggestion {
  file: TFile;
  heading?: string;
}

/**
 * Attaches [[wikilink]] autocomplete to a plain <textarea>.
 *
 * Supports:
 *   [[query       → file search
 *   [[file#query  → heading search within file
 *   [[file|       → suggest closes (user types display text)
 */
export class LinkSuggest {
  private app: App;
  private sourcePath: string;
  private textarea: HTMLTextAreaElement | null = null;
  private containerEl: HTMLDivElement;
  private suggestions: LinkSuggestion[] = [];
  private selectedIndex = 0;
  isShowing = false;

  private boundOnInput: () => void;

  constructor(app: App, sourcePath: string) {
    this.app = app;
    this.sourcePath = sourcePath;

    this.containerEl = document.createElement("div");
    this.containerEl.className = "suggestion-container kb-link-suggest";
    this.containerEl.style.display = "none";

    this.boundOnInput = () => this.onInput();
  }

  attach(textarea: HTMLTextAreaElement): void {
    this.textarea = textarea;
    textarea.addEventListener("input", this.boundOnInput);
    document.body.appendChild(this.containerEl);
  }

  detach(): void {
    if (this.textarea) {
      this.textarea.removeEventListener("input", this.boundOnInput);
      this.textarea = null;
    }
    this.close();
  }

  destroy(): void {
    this.detach();
    this.containerEl.remove();
  }

  /** Returns true if the suggest consumed the key event. */
  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.isShowing) return false;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.setSelected(
          Math.min(this.suggestions.length - 1, this.selectedIndex + 1)
        );
        return true;
      case "ArrowUp":
        e.preventDefault();
        this.setSelected(Math.max(0, this.selectedIndex - 1));
        return true;
      case "Enter":
      case "Tab":
        e.preventDefault();
        if (this.suggestions[this.selectedIndex]) {
          this.accept(this.suggestions[this.selectedIndex]);
        }
        return true;
      case "Escape":
        e.preventDefault();
        this.close();
        return true;
    }
    return false;
  }

  // ── Internals ──────────────────────────────────────────

  private getContext(): {
    start: number;
    fileQuery: string;
    headerQuery: string | null;
  } | null {
    if (!this.textarea) return null;
    const pos = this.textarea.selectionStart;
    const text = this.textarea.value.substring(0, pos);

    const openIdx = text.lastIndexOf("[[");
    if (openIdx === -1) return null;

    const between = text.substring(openIdx + 2);
    if (between.includes("]]")) return null;
    if (between.includes("|")) return null;

    const hashIdx = between.indexOf("#");
    if (hashIdx >= 0) {
      return {
        start: openIdx,
        fileQuery: between.substring(0, hashIdx),
        headerQuery: between.substring(hashIdx + 1),
      };
    }
    return { start: openIdx, fileQuery: between, headerQuery: null };
  }

  private onInput(): void {
    const ctx = this.getContext();
    if (!ctx) {
      this.close();
      return;
    }

    if (ctx.headerQuery !== null) {
      this.searchHeadings(ctx.fileQuery, ctx.headerQuery);
    } else {
      this.searchFiles(ctx.fileQuery);
    }
  }

  private searchFiles(query: string): void {
    const files = this.app.vault.getMarkdownFiles();
    const lower = query.toLowerCase();

    const scored: { s: LinkSuggestion; score: number; mtime: number }[] = [];

    for (const file of files) {
      const basename = file.basename.toLowerCase();
      const path = file.path.toLowerCase();

      let score: number;
      if (!lower) {
        score = 0; // empty query — rank by recency
      } else if (basename === lower) {
        score = 4;
      } else if (basename.startsWith(lower)) {
        score = 3;
      } else if (basename.includes(lower)) {
        score = 2;
      } else if (path.includes(lower)) {
        score = 1;
      } else {
        continue;
      }

      scored.push({
        s: { file },
        score,
        mtime: file.stat?.mtime ?? 0,
      });
    }

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // For equal scores, prefer recently modified
      return b.mtime - a.mtime;
    });

    this.show(scored.slice(0, 30).map((r) => r.s));
  }

  private searchHeadings(fileQuery: string, headerQuery: string): void {
    const file = this.app.metadataCache.getFirstLinkpathDest(
      fileQuery,
      this.sourcePath
    );
    if (!file) {
      this.close();
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache?.headings;
    if (!headings || headings.length === 0) {
      this.close();
      return;
    }

    const lower = headerQuery.toLowerCase();
    const results: LinkSuggestion[] = headings
      .filter((h) => !lower || h.heading.toLowerCase().includes(lower))
      .slice(0, 30)
      .map((h) => ({ file, heading: h.heading }));

    this.show(results);
  }

  private show(suggestions: LinkSuggestion[]): void {
    if (suggestions.length === 0) {
      this.close();
      return;
    }

    this.suggestions = suggestions;
    this.selectedIndex = 0;
    this.isShowing = true;

    // Rebuild list
    const list = this.containerEl;
    while (list.firstChild) list.removeChild(list.firstChild);

    suggestions.forEach((s, i) => {
      const el = document.createElement("div");
      el.className = "suggestion-item" + (i === 0 ? " is-selected" : "");

      const titleEl = document.createElement("div");
      titleEl.className = "suggestion-title";
      titleEl.textContent = s.heading ?? s.file.basename;
      el.appendChild(titleEl);

      if (!s.heading) {
        const parentPath = s.file.parent?.path;
        if (parentPath && parentPath !== "/" && parentPath !== "") {
          const noteEl = document.createElement("div");
          noteEl.className = "suggestion-note";
          noteEl.textContent = parentPath;
          el.appendChild(noteEl);
        }
      }

      el.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent textarea blur
        this.accept(s);
      });
      el.addEventListener("mouseenter", () => this.setSelected(i));

      list.appendChild(el);
    });

    this.position();
    this.containerEl.style.display = "";
  }

  private position(): void {
    if (!this.textarea) return;
    const rect = this.textarea.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;

    this.containerEl.style.position = "fixed";
    this.containerEl.style.left = rect.left + "px";
    this.containerEl.style.width = Math.max(rect.width, 220) + "px";

    if (spaceBelow >= 200 || spaceBelow >= rect.top) {
      this.containerEl.style.top = rect.bottom + 2 + "px";
      this.containerEl.style.bottom = "";
    } else {
      this.containerEl.style.bottom =
        window.innerHeight - rect.top + 2 + "px";
      this.containerEl.style.top = "";
    }
  }

  private setSelected(index: number): void {
    const items = this.containerEl.children;
    if (items[this.selectedIndex]) {
      items[this.selectedIndex].className = "suggestion-item";
    }
    this.selectedIndex = index;
    if (items[this.selectedIndex]) {
      items[this.selectedIndex].className = "suggestion-item is-selected";
      const el = items[this.selectedIndex] as HTMLElement;
      el.scrollIntoView?.({ block: "nearest" });
    }
  }

  private accept(suggestion: LinkSuggestion): void {
    const ctx = this.getContext();
    if (!ctx || !this.textarea) return;

    const linkText = this.app.metadataCache.fileToLinktext(
      suggestion.file,
      this.sourcePath
    );

    let insert: string;
    if (suggestion.heading) {
      insert = `[[${linkText}#${suggestion.heading}]]`;
    } else {
      insert = `[[${linkText}]]`;
    }

    const before = this.textarea.value.substring(0, ctx.start);
    let afterPos = this.textarea.selectionStart;

    // Consume trailing ]] if editing an existing link
    if (this.textarea.value.substring(afterPos, afterPos + 2) === "]]") {
      afterPos += 2;
    }
    const after = this.textarea.value.substring(afterPos);

    this.textarea.value = before + insert + after;
    const newPos = before.length + insert.length;
    this.textarea.setSelectionRange(newPos, newPos);

    // Notify Svelte's bind:value
    this.textarea.dispatchEvent(new Event("input", { bubbles: true }));

    this.close();
  }

  close(): void {
    this.isShowing = false;
    this.containerEl.style.display = "none";
    this.suggestions = [];
  }
}
