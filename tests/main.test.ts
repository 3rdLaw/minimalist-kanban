import { describe, test, expect, vi, afterEach } from "vitest";
import KanbanBoardPlugin from "../src/main";
import { KanbanView, KANBAN_VIEW_TYPE } from "../src/KanbanView";
import { WorkspaceLeaf, TFile, MarkdownView, setIcon } from "obsidian";

function tfile(path: string): TFile {
  return Object.assign(new TFile(), {
    path,
    basename: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  });
}

const KANBAN_CACHE = { frontmatter: { "kanban-plugin": "board" } };

function makeApp() {
  return {
    metadataCache: {
      getCache: vi.fn().mockReturnValue(null),
    },
    vault: {
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      cachedRead: vi.fn().mockResolvedValue(""),
      create: vi.fn(async (path: string, _content?: string) => tfile(path)),
    },
    workspace: {
      on: vi.fn().mockReturnValue({}),
      getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) }),
      getActiveViewOfType: vi.fn().mockReturnValue(null),
      getLeavesOfType: vi.fn().mockReturnValue([]),
      iterateAllLeaves: vi.fn(),
    },
    fileManager: {
      getNewFileParent: vi.fn().mockReturnValue({ path: "/" }),
    },
  };
}

const loadedPlugins: KanbanBoardPlugin[] = [];

async function makePlugin(app = makeApp(), { load = false } = {}) {
  const plugin = new (KanbanBoardPlugin as any)() as KanbanBoardPlugin;
  (plugin as any).app = app;
  if (load) {
    await plugin.onload();
    loadedPlugins.push(plugin);
  }
  return { plugin, app };
}

afterEach(() => {
  // Undo the monkey-around patch on the shared WorkspaceLeaf.prototype
  for (const plugin of loadedPlugins.splice(0)) {
    for (const [uninstall] of ((plugin as any).register as ReturnType<typeof vi.fn>).mock.calls) {
      uninstall();
    }
  }
});

describe("onload", () => {
  test("registers the view, commands, and settings tab", async () => {
    const { plugin } = await makePlugin(makeApp(), { load: true });
    expect((plugin as any).registerView).toHaveBeenCalledWith(
      KANBAN_VIEW_TYPE,
      expect.any(Function)
    );
    expect((plugin as any).addCommand).toHaveBeenCalledTimes(2);
    expect((plugin as any).addSettingTab).toHaveBeenCalled();
  });

  test("merges saved settings over defaults", async () => {
    const { plugin } = await makePlugin();
    ((plugin as any).loadData as ReturnType<typeof vi.fn>).mockResolvedValue({
      showCheckboxes: true,
    });
    await plugin.loadSettings();
    expect(plugin.settings.showCheckboxes).toBe(true);
    expect(plugin.settings.enterNewline).toBe(false);
    expect(plugin.settings.prependCards).toBe(false);
  });
});

describe("checkIsKanban", () => {
  test("true when the metadata cache has the frontmatter key", async () => {
    const { plugin, app } = await makePlugin();
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);
    await expect((plugin as any).checkIsKanban("Board.md")).resolves.toBe(true);
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
  });

  test("falls back to reading file content on cache miss", async () => {
    const { plugin, app } = await makePlugin();
    app.vault.getAbstractFileByPath.mockReturnValue(tfile("Board.md"));
    app.vault.cachedRead.mockResolvedValue(
      "---\nkanban-plugin: board\n---\n\n## A\n"
    );
    await expect((plugin as any).checkIsKanban("Board.md")).resolves.toBe(true);
  });

  test("false when content has no kanban frontmatter", async () => {
    const { plugin, app } = await makePlugin();
    app.vault.getAbstractFileByPath.mockReturnValue(tfile("Note.md"));
    app.vault.cachedRead.mockResolvedValue("---\ntags: [x]\n---\nJust a note\n");
    await expect((plugin as any).checkIsKanban("Note.md")).resolves.toBe(false);
  });

  test("false when the path does not resolve to a file", async () => {
    const { plugin } = await makePlugin();
    await expect((plugin as any).checkIsKanban("Missing.md")).resolves.toBe(false);
  });
});

describe("setViewState redirect", () => {
  test("redirects markdown view state to the kanban view for board files", async () => {
    const { app } = await makePlugin(makeApp(), { load: true });
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);

    const leaf = new WorkspaceLeaf();
    await leaf.setViewState({ type: "markdown", state: { file: "Board.md" } });

    expect(leaf.lastViewState.type).toBe(KANBAN_VIEW_TYPE);
    expect(leaf.lastViewState.state.file).toBe("Board.md");
  });

  test("leaves non-board markdown files alone", async () => {
    await makePlugin(makeApp(), { load: true });

    const leaf = new WorkspaceLeaf();
    await leaf.setViewState({ type: "markdown", state: { file: "Note.md" } });

    expect(leaf.lastViewState.type).toBe("markdown");
  });

  test("leaves non-markdown view states alone", async () => {
    const { app } = await makePlugin(makeApp(), { load: true });
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);

    const leaf = new WorkspaceLeaf();
    await leaf.setViewState({ type: "graph", state: { file: "Board.md" } });

    expect(leaf.lastViewState.type).toBe("graph");
  });

  test("does not redirect when the file is already open as markdown (mode toggle)", async () => {
    const { app } = await makePlugin(makeApp(), { load: true });
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);

    const leaf = new WorkspaceLeaf();
    const mdView = new MarkdownView();
    mdView.file = tfile("Board.md");
    leaf.view = mdView;
    await leaf.setViewState({ type: "markdown", state: { file: "Board.md" } });

    expect(leaf.lastViewState.type).toBe("markdown");
  });

  test("unloading restores the original setViewState", async () => {
    const { plugin, app } = await makePlugin(makeApp(), { load: true });
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);

    for (const [uninstall] of ((plugin as any).register as ReturnType<typeof vi.fn>).mock.calls) {
      uninstall();
    }
    loadedPlugins.length = 0;

    const leaf = new WorkspaceLeaf();
    await leaf.setViewState({ type: "markdown", state: { file: "Board.md" } });
    expect(leaf.lastViewState.type).toBe("markdown");
  });
});

describe("toggleView", () => {
  test("switches a markdown view of a board file to the kanban view", async () => {
    const { plugin, app } = await makePlugin(makeApp(), { load: true });
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);

    const leaf = new WorkspaceLeaf();
    const mdView = new MarkdownView();
    mdView.file = tfile("Board.md");
    leaf.view = mdView;

    await (plugin as any).toggleView(leaf);

    expect(leaf.lastViewState).toEqual({
      type: KANBAN_VIEW_TYPE,
      state: { file: "Board.md" },
    });
  });

  test("switches a kanban view back to markdown, bypassing the redirect", async () => {
    const { plugin, app } = await makePlugin(makeApp(), { load: true });
    // Redirect would normally bounce this straight back to kanban
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);

    const leaf = new WorkspaceLeaf();
    const kanbanView = new KanbanView(leaf as any, plugin);
    (kanbanView as any).file = tfile("Board.md");
    leaf.view = kanbanView;

    await (plugin as any).toggleView(leaf);

    expect(leaf.lastViewState).toEqual({
      type: "markdown",
      state: { file: "Board.md" },
    });
  });
});

describe("createNewBoard", () => {
  test("creates a board with default lanes and opens it", async () => {
    const { plugin, app } = await makePlugin();
    const leaf = app.workspace.getLeaf();

    await plugin.createNewBoard();

    expect(app.vault.create).toHaveBeenCalledTimes(1);
    const [path, content] = app.vault.create.mock.calls[0];
    expect(path).toBe("Kanban Board.md");
    expect(content).toContain("kanban-plugin: board");
    expect(content).toContain("## To Do");
    expect(content).toContain("## In Progress");
    expect(content).toContain("## Done");
    expect(leaf.openFile).toHaveBeenCalled();
  });

  test("appends a counter when the filename is taken", async () => {
    const { plugin, app } = await makePlugin();
    app.vault.getAbstractFileByPath.mockImplementation((path: string) =>
      path === "Kanban Board.md" || path === "Kanban Board 1.md" ? tfile(path) : null
    );

    await plugin.createNewBoard();

    expect(app.vault.create.mock.calls[0][0]).toBe("Kanban Board 2.md");
  });

  test("respects the user's default new-file folder", async () => {
    const { plugin, app } = await makePlugin();
    app.fileManager.getNewFileParent.mockReturnValue({ path: "Projects/Boards" });

    await plugin.createNewBoard();

    expect(app.vault.create.mock.calls[0][0]).toBe("Projects/Boards/Kanban Board.md");
  });
});

describe("saveSettings", () => {
  test("persists settings and notifies open kanban views", async () => {
    const { plugin, app } = await makePlugin();
    const leaf = new WorkspaceLeaf();
    const view = new KanbanView(leaf as any, plugin);
    const spy = vi.spyOn(view, "onSettingsChanged");
    leaf.view = view;
    app.workspace.getLeavesOfType.mockReturnValue([leaf]);

    await plugin.saveSettings();

    expect((plugin as any).saveData).toHaveBeenCalledWith(plugin.settings);
    expect(spy).toHaveBeenCalled();
  });
});

describe("injectToggleButtons", () => {
  test("adds a toggle button to markdown views of board files, exactly once", async () => {
    const { plugin, app } = await makePlugin();
    app.metadataCache.getCache.mockReturnValue(KANBAN_CACHE);

    const mdView = new MarkdownView();
    mdView.file = tfile("Board.md");
    const actionsEl = document.createElement("div");
    (mdView as any).actionsEl = actionsEl;
    const leaf = new WorkspaceLeaf();
    leaf.view = mdView;
    app.workspace.iterateAllLeaves.mockImplementation((cb: (l: WorkspaceLeaf) => void) =>
      cb(leaf)
    );

    (plugin as any).injectToggleButtons();
    (plugin as any).injectToggleButtons();

    expect(actionsEl.querySelectorAll("[data-kb-toggle]")).toHaveLength(1);
    expect(setIcon).toHaveBeenCalled();
  });

  test("skips markdown views of non-board files", async () => {
    const { plugin, app } = await makePlugin();

    const mdView = new MarkdownView();
    mdView.file = tfile("Note.md");
    const actionsEl = document.createElement("div");
    (mdView as any).actionsEl = actionsEl;
    const leaf = new WorkspaceLeaf();
    leaf.view = mdView;
    app.workspace.iterateAllLeaves.mockImplementation((cb: (l: WorkspaceLeaf) => void) =>
      cb(leaf)
    );

    (plugin as any).injectToggleButtons();

    expect(actionsEl.querySelector("[data-kb-toggle]")).toBeNull();
  });
});
