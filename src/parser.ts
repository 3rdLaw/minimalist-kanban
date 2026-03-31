import { Board, Lane, Item, generateId } from "./types";

export function parseBoard(markdown: string): Board {
  const lines = markdown.split("\n");
  const lanes: Lane[] = [];
  const archive: Item[] = [];
  let currentLane: Lane | null = null;
  let currentItem: Item | null = null;
  let inFrontmatter = false;
  let frontmatterSeen = false;
  let inArchive = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Frontmatter handling
    if (trimmed === "---") {
      if (!frontmatterSeen) {
        inFrontmatter = !inFrontmatter;
        if (!inFrontmatter) frontmatterSeen = true;
        continue;
      }
      // `---` after frontmatter is the archive separator
      if (!inArchive) {
        inArchive = true;
        currentLane = null;
        currentItem = null;
        continue;
      }
    }
    if (inFrontmatter) continue;

    // Headings
    if (trimmed.startsWith("## ")) {
      currentItem = null;
      const title = trimmed.substring(3).trim();

      if (inArchive) {
        // Skip the "Archive" heading itself; items below go to archive[]
        continue;
      }

      currentLane = { id: generateId(), title, items: [] };
      lanes.push(currentLane);
      continue;
    }

    // List item: "- text", "- [ ] text", "- [x] text"
    const match = trimmed.match(/^[-*]\s+(?:\[([ xX])\]\s+)?(.+)/);
    if (match) {
      const hasCheckbox = match[1] !== undefined;
      const checked = match[1] === "x" || match[1] === "X";
      const newItem: Item = {
        id: generateId(),
        title: match[2],
        checked,
        hasCheckbox,
      };

      if (inArchive) {
        archive.push(newItem);
        currentItem = newItem;
      } else if (currentLane) {
        currentLane.items.push(newItem);
        currentItem = newItem;
      }
      continue;
    }

    // Continuation line (indented, part of current item)
    if (currentItem && line.match(/^\s{2,}/) && trimmed) {
      currentItem.title += "\n" + trimmed;
      continue;
    }

    // Blank line or unrecognized content resets current item
    if (trimmed === "") {
      currentItem = null;
    }
  }

  return { lanes, archive };
}

function serializeItem(lines: string[], item: Item) {
  const prefix = `- [${item.checked ? "x" : " "}] `;
  const titleLines = item.title.split("\n");
  lines.push(prefix + titleLines[0]);
  for (let i = 1; i < titleLines.length; i++) {
    lines.push("  " + titleLines[i]);
  }
}

export function serializeBoard(board: Board): string {
  const lines: string[] = ["---", "kanban-plugin: board", "---", ""];

  for (const lane of board.lanes) {
    lines.push(`## ${lane.title}`);
    for (const item of lane.items) {
      serializeItem(lines, item);
    }
    lines.push("");
  }

  if (board.archive.length > 0) {
    lines.push("---", "", "## Archive");
    for (const item of board.archive) {
      serializeItem(lines, item);
    }
    lines.push("");
  }

  return lines.join("\n");
}
