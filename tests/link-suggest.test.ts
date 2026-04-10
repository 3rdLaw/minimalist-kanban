import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { LinkSuggest } from "../src/LinkSuggest";
import { TFile } from "obsidian";

function makeTFile(basename: string, path?: string, parentPath?: string): TFile {
  const f = new TFile();
  f.basename = basename;
  f.path = path ?? `${basename}.md`;
  f.parent = { path: parentPath ?? "" };
  f.stat = { ctime: 0, mtime: Date.now(), size: 100 };
  return f;
}

const files = [
  makeTFile("Meeting Notes", "work/Meeting Notes.md", "work"),
  makeTFile("Daily Log", "journal/Daily Log.md", "journal"),
  makeTFile("Project Plan", "Project Plan.md"),
  makeTFile("README", "README.md"),
];

function makeApp(extraFiles: TFile[] = []) {
  const allFiles = [...files, ...extraFiles];
  return {
    vault: {
      getMarkdownFiles: vi.fn(() => allFiles),
    },
    metadataCache: {
      fileToLinktext: vi.fn((file: TFile) => file.basename),
      getFirstLinkpathDest: vi.fn((linkpath: string) => {
        return allFiles.find((f) => f.basename === linkpath) ?? null;
      }),
      getFileCache: vi.fn((file: TFile) => {
        if (file.basename === "Meeting Notes") {
          return {
            headings: [
              { heading: "Agenda", level: 1 },
              { heading: "Action Items", level: 2 },
              { heading: "Follow-up", level: 2 },
            ],
          };
        }
        return null;
      }),
    },
  };
}

function setup(app = makeApp()) {
  const textarea = document.createElement("textarea");
  document.body.appendChild(textarea);
  const suggest = new LinkSuggest(app as any, "test.md");
  suggest.attach(textarea);
  return { textarea, suggest, app };
}

function typeInto(textarea: HTMLTextAreaElement, value: string, cursorPos?: number) {
  textarea.value = value;
  textarea.selectionStart = cursorPos ?? value.length;
  textarea.selectionEnd = cursorPos ?? value.length;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LinkSuggest", () => {
  let textarea: HTMLTextAreaElement;
  let suggest: LinkSuggest;

  afterEach(() => {
    suggest?.destroy();
    textarea?.remove();
  });

  // ── Trigger detection ─────────────────────────────────

  describe("trigger detection", () => {
    test("opens on [[ input", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "hello [[");
      expect(suggest.isShowing).toBe(true);
    });

    test("does not open without [[", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "hello world");
      expect(suggest.isShowing).toBe(false);
    });

    test("closes when [[ is completed with ]]", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "hello [[note");
      expect(suggest.isShowing).toBe(true);

      typeInto(textarea, "hello [[note]]");
      expect(suggest.isShowing).toBe(false);
    });

    test("closes when | is typed (alias mode)", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "hello [[Meeting Notes");
      expect(suggest.isShowing).toBe(true);

      typeInto(textarea, "hello [[Meeting Notes|");
      expect(suggest.isShowing).toBe(false);
    });

    test("handles multiple [[ — uses the last unclosed one", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "see [[README]] and [[Meet");
      expect(suggest.isShowing).toBe(true);
    });
  });

  // ── File search ───────────────────────────────────────

  describe("file search", () => {
    test("shows all files on empty query", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[");

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items.length).toBe(files.length);
    });

    test("filters files by query", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[meet");

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items.length).toBe(1);
      expect(items[0].querySelector(".suggestion-title")!.textContent).toBe("Meeting Notes");
    });

    test("shows parent path for files in folders", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[meet");

      const note = document.querySelector(".kb-link-suggest .suggestion-note");
      expect(note).toBeTruthy();
      expect(note!.textContent).toBe("work");
    });

    test("does not show path for root-level files", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[README");

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items.length).toBe(1);
      expect(items[0].querySelector(".suggestion-note")).toBeNull();
    });

    test("exact match scores highest", () => {
      const extraFile = makeTFile("Meetings Overview", "Meetings Overview.md");
      ({ textarea, suggest } = setup(makeApp([extraFile])));
      typeInto(textarea, "[[Meeting Notes");

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-title");
      expect(items[0].textContent).toBe("Meeting Notes");
    });
  });

  // ── Heading search ────────────────────────────────────

  describe("heading search", () => {
    test("shows headings after # for a known file", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[Meeting Notes#");

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items.length).toBe(3);
      expect(items[0].querySelector(".suggestion-title")!.textContent).toBe("Agenda");
    });

    test("filters headings by query", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[Meeting Notes#act");

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items.length).toBe(1);
      expect(items[0].querySelector(".suggestion-title")!.textContent).toBe("Action Items");
    });

    test("closes if file has no headings", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[README#");
      expect(suggest.isShowing).toBe(false);
    });

    test("closes if file is not found", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[Nonexistent#");
      expect(suggest.isShowing).toBe(false);
    });
  });

  // ── Keyboard navigation ───────────────────────────────

  describe("keyboard navigation", () => {
    test("ArrowDown moves selection", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[");

      const handled = suggest.handleKeydown(
        new KeyboardEvent("keydown", { key: "ArrowDown" })
      );
      expect(handled).toBe(true);

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items[0].className).toBe("suggestion-item");
      expect(items[1].className).toBe("suggestion-item is-selected");
    });

    test("ArrowUp moves selection up", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[");

      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowUp" }));

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items[0].className).toBe("suggestion-item is-selected");
    });

    test("ArrowUp does not go below 0", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[");

      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items[0].className).toBe("suggestion-item is-selected");
    });

    test("ArrowDown does not exceed list length", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[meet");
      // Only 1 item — ArrowDown should not change selection
      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));

      const items = document.querySelectorAll(".kb-link-suggest .suggestion-item");
      expect(items[0].className).toBe("suggestion-item is-selected");
    });

    test("Escape closes the suggest", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[");
      expect(suggest.isShowing).toBe(true);

      const handled = suggest.handleKeydown(
        new KeyboardEvent("keydown", { key: "Escape" })
      );
      expect(handled).toBe(true);
      expect(suggest.isShowing).toBe(false);
    });

    test("returns false when suggest is not showing", () => {
      ({ textarea, suggest } = setup());
      const handled = suggest.handleKeydown(
        new KeyboardEvent("keydown", { key: "Enter" })
      );
      expect(handled).toBe(false);
    });

    test("Tab accepts selection", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "hello [[meet");

      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "Tab" }));

      expect(suggest.isShowing).toBe(false);
      expect(textarea.value).toBe("hello [[Meeting Notes]]");
    });
  });

  // ── Selection / acceptance ────────────────────────────

  describe("acceptance", () => {
    test("Enter inserts file link", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "see [[meet");

      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(textarea.value).toBe("see [[Meeting Notes]]");
      expect(textarea.selectionStart).toBe("see [[Meeting Notes]]".length);
      expect(suggest.isShowing).toBe(false);
    });

    test("Enter inserts heading link", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "see [[Meeting Notes#Ag");

      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(textarea.value).toBe("see [[Meeting Notes#Agenda]]");
    });

    test("consumes trailing ]] when editing existing link", () => {
      ({ textarea, suggest } = setup());
      // Simulate cursor inside [[README]], before the closing ]]
      textarea.value = "see [[README]] more";
      textarea.selectionStart = 12; // after "README", before ]]
      textarea.selectionEnd = 12;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      expect(suggest.isShowing).toBe(true);

      // Select "Meeting Notes" to replace the existing link
      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));

      // Should not produce double ]]
      expect(textarea.value).not.toContain("]]]]");
      expect(textarea.value).toContain("]] more");
    });

    test("text after link is preserved", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "before [[meet");
      // Manually set value with text after cursor
      textarea.value = "before [[meet after";
      textarea.selectionStart = 13; // after "meet"
      textarea.selectionEnd = 13;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(textarea.value).toBe("before [[Meeting Notes]] after");
    });

    test("mousedown on suggestion item accepts it", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[meet");

      const item = document.querySelector(".kb-link-suggest .suggestion-item")!;
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(textarea.value).toBe("[[Meeting Notes]]");
      expect(suggest.isShowing).toBe(false);
    });

    test("uses fileToLinktext for inserted text", () => {
      const app = makeApp();
      app.metadataCache.fileToLinktext.mockImplementation(
        (file: TFile) => `folder/${file.basename}`
      );
      ({ textarea, suggest } = setup(app));
      typeInto(textarea, "[[meet");

      suggest.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(textarea.value).toBe("[[folder/Meeting Notes]]");
    });
  });

  // ── Lifecycle ─────────────────────────────────────────

  describe("lifecycle", () => {
    test("destroy removes popup from DOM", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[");
      expect(document.querySelector(".kb-link-suggest")).toBeTruthy();

      suggest.destroy();
      expect(document.querySelector(".kb-link-suggest")).toBeNull();
    });

    test("detach stops responding to input", () => {
      ({ textarea, suggest } = setup());
      suggest.detach();

      typeInto(textarea, "[[");
      expect(suggest.isShowing).toBe(false);
    });

    test("close hides popup but keeps DOM element", () => {
      ({ textarea, suggest } = setup());
      typeInto(textarea, "[[");
      expect(suggest.isShowing).toBe(true);

      suggest.close();
      expect(suggest.isShowing).toBe(false);
      expect(document.querySelector(".kb-link-suggest")).toBeTruthy();
    });
  });
});
