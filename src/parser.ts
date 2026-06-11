import { Board, Lane, Item, generateId } from "./types";

const FENCE = /^(```|~~~)/;
const DEFAULT_FRONTMATTER = ["kanban-plugin: board"];

/**
 * `---` only starts the archive section when the next non-blank line
 * is an "## Archive" heading. Any other `---` is user content
 * (e.g. a thematic break) and is preserved verbatim.
 */
function isArchiveSeparator(lines: string[], idx: number): boolean {
  for (let j = idx + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === "") continue;
    return /^##\s+archive\s*$/i.test(t);
  }
  return false;
}

export function parseBoard(markdown: string): Board {
  const lines = markdown.split("\n");
  const lanes: Lane[] = [];
  const archive: Item[] = [];
  const preamble: string[] = [];
  const archiveExtra: string[] = [];
  let frontmatter: string[] | undefined;

  let start = 0;
  // Frontmatter is only valid at the very start of the document
  if (lines.length > 0 && lines[0].trim() === "---") {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === "---") {
        frontmatter = lines.slice(1, j);
        start = j + 1;
        break;
      }
    }
  }

  let currentLane: Lane | null = null;
  let currentItem: Item | null = null;
  let inArchive = false;
  let inFence = false;

  const pushExtra = (line: string) => {
    if (inArchive) archiveExtra.push(line);
    else if (currentLane) currentLane.extra!.push(line);
    else preamble.push(line);
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Inside a fenced code block nothing is structural — preserve verbatim
    if (inFence) {
      pushExtra(line);
      if (FENCE.test(trimmed)) inFence = false;
      continue;
    }

    // Continuation line of the current item. This must run before the
    // structural checks below so card text containing "---", "## " or
    // "```" lines can't corrupt the board on re-parse.
    if (currentItem && trimmed && /^\s{2,}/.test(line)) {
      currentItem.title += "\n" + trimmed;
      continue;
    }

    if (FENCE.test(trimmed)) {
      inFence = true;
      currentItem = null;
      pushExtra(line);
      continue;
    }

    if (trimmed === "---" && !inArchive && isArchiveSeparator(lines, i)) {
      inArchive = true;
      currentLane = null;
      currentItem = null;
      continue;
    }

    // Lane headings
    if (trimmed.startsWith("## ")) {
      currentItem = null;
      if (inArchive) {
        // Skip the "## Archive" heading itself; items below go to archive[]
        continue;
      }
      const title = trimmed.substring(3).trim();
      currentLane = { id: generateId(), title, items: [], extra: [] };
      lanes.push(currentLane);
      continue;
    }

    // A bare "- [ ]" with no text can't be a card — preserve as text
    // (otherwise the regex below would make a card titled "[ ]")
    if (/^[-*]\s+\[[ xX]\]\s*$/.test(trimmed)) {
      currentItem = null;
      pushExtra(line);
      continue;
    }

    // List item: "- text", "- [ ] text", "- [x] text"
    const match = trimmed.match(/^[-*]\s+(?:\[([ xX])\]\s+)?(.+)/);
    if (match) {
      // Items before the first lane heading have no home — preserve as text
      if (!inArchive && !currentLane) {
        currentItem = null;
        pushExtra(line);
        continue;
      }
      const checked = match[1] === "x" || match[1] === "X";
      const newItem: Item = { id: generateId(), title: match[2], checked };
      if (inArchive) archive.push(newItem);
      else currentLane!.items.push(newItem);
      currentItem = newItem;
      continue;
    }

    if (trimmed === "") {
      currentItem = null;
      continue;
    }

    // Anything unrecognized is preserved verbatim and re-emitted on save
    currentItem = null;
    pushExtra(line);
  }

  return { lanes, archive, frontmatter, preamble, archiveExtra };
}

function serializeItem(lines: string[], item: Item) {
  const prefix = `- [${item.checked ? "x" : " "}] `;
  const titleLines = item.title.split("\n");
  lines.push(prefix + titleLines[0]);
  for (let i = 1; i < titleLines.length; i++) {
    lines.push("  " + titleLines[i]);
  }
}

/**
 * Push preserved extra lines, separated from any items above by a blank
 * line so an indented extra line can't merge into the last item on re-parse.
 */
function serializeExtra(lines: string[], extra: string[] | undefined) {
  if (extra && extra.length > 0) {
    lines.push("", ...extra);
  }
}

export function serializeBoard(board: Board): string {
  const lines: string[] = [];
  lines.push("---", ...(board.frontmatter ?? DEFAULT_FRONTMATTER), "---", "");

  if (board.preamble && board.preamble.length > 0) {
    lines.push(...board.preamble, "");
  }

  for (const lane of board.lanes) {
    lines.push(`## ${lane.title}`);
    for (const item of lane.items) {
      serializeItem(lines, item);
    }
    serializeExtra(lines, lane.extra);
    lines.push("");
  }

  const archiveExtra = board.archiveExtra ?? [];
  if (board.archive.length > 0 || archiveExtra.length > 0) {
    lines.push("---", "", "## Archive");
    for (const item of board.archive) {
      serializeItem(lines, item);
    }
    serializeExtra(lines, archiveExtra);
    lines.push("");
  }

  return lines.join("\n");
}
