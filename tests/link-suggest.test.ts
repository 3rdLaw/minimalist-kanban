import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { LinkSuggest } from "../src/LinkSuggest";
import { TFile, TFolder } from "obsidian";

function makeTFile(basename: string, path?: string, parentPath?: string): TFile {
  const f = new TFile();
  f.basename = basename;
  f.path = path ?? `${basename}.md`;
  // LinkSuggest only ever reads `parent.path`, so a stub stands in rather than
  // building the children/vault/isRoot a real TFolder carries and this never
  // touches. The mock's own TFile types `parent` this loosely too.
  f.parent = { path: parentPath ?? "" } as TFolder;
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

// ── Pop-out windows ───────────────────────────────────────

/**
 * Obsidian boards can be moved into a pop-out window, where the textarea
 * belongs to a different document and window. The popup used to be created
 * with, attached to and measured against the main window regardless, so it
 * appeared in the wrong window at the wrong coordinates.
 */
describe("LinkSuggest in a secondary window", () => {
  let frame: HTMLIFrameElement;
  let suggest: LinkSuggest;

  function setupPopout(innerHeight: number, rect: Partial<DOMRect> = {}) {
    frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;

    // Obsidian applies its DOM extensions to pop-out windows; mirror that.
    (doc.defaultView!.HTMLElement.prototype as unknown as {
      setCssProps: (p: Record<string, string>) => void;
    }).setCssProps = function (props: Record<string, string>) {
      for (const [k, v] of Object.entries(props)) {
        (this as HTMLElement).style.setProperty(k, v);
      }
    };
    Object.defineProperty(win, "innerHeight", { value: innerHeight, configurable: true });

    const textarea = doc.createElement("textarea");
    textarea.getBoundingClientRect = () =>
      ({ top: 100, bottom: 120, left: 40, width: 300, height: 20, right: 340 }) as DOMRect;
    Object.assign(textarea.getBoundingClientRect, rect);
    doc.body.appendChild(textarea);

    suggest = new LinkSuggest(makeApp() as any, "test.md");
    suggest.attach(textarea);
    return { doc, win, textarea };
  }

  afterEach(() => {
    suggest?.destroy();
    frame?.remove();
  });

  test("creates and attaches the popup in the textarea's document", () => {
    const { doc, textarea } = setupPopout(800);
    typeInto(textarea, "[[");

    const popup = doc.querySelector(".kb-link-suggest");
    expect(popup).toBeTruthy();
    expect(popup!.ownerDocument).toBe(doc);
    expect(popup!.parentElement).toBe(doc.body);
    // ...and nothing landed in the main window
    expect(document.querySelector(".kb-link-suggest")).toBeNull();
  });

  test("builds suggestion items in the textarea's document", () => {
    const { doc, textarea } = setupPopout(800);
    typeInto(textarea, "[[");

    const items = doc.querySelectorAll(".kb-link-suggest .suggestion-item");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.ownerDocument).toBe(doc);
  });

  test("measures against the pop-out viewport, not the main window", () => {
    // The textarea sits at y=100..120. In a 800px-tall window there is room
    // below; in a 130px-tall one there is not, so the popup flips upward.
    const roomy = setupPopout(800);
    typeInto(roomy.textarea, "[[");
    let popup = roomy.doc.querySelector(".kb-link-suggest") as HTMLElement;
    expect(popup.style.getPropertyValue("--kb-suggest-top")).toBe("122px");
    expect(popup.style.getPropertyValue("--kb-suggest-bottom")).toBe("auto");

    suggest.destroy();
    frame.remove();

    const cramped = setupPopout(130);
    typeInto(cramped.textarea, "[[");
    popup = cramped.doc.querySelector(".kb-link-suggest") as HTMLElement;
    expect(popup.style.getPropertyValue("--kb-suggest-top")).toBe("auto");
    // 130 (pop-out height) - 100 (textarea top) + 2 — the main window is
    // 768px tall, so a main-window measurement would give 670px here.
    expect(popup.style.getPropertyValue("--kb-suggest-bottom")).toBe("32px");
  });
});
