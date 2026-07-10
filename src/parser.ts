import { Board, Lane, Item, ExtraBlock, generateId } from "./types";

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
  // CRLF input is normalized to LF: the serializer joins with "\n", and
  // verbatim-preserved lines or continuation text must not embed stray "\r".
  const lines = markdown.split(/\r?\n/);
  const lanes: Lane[] = [];
  const archive: Item[] = [];
  const preamble: string[] = [];
  const archiveExtra: ExtraBlock[] = [];
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
  let lastItem: Item | null = null;
  let inArchive = false;
  let awaitingArchiveHeading = false;
  let inFence = false;

  const pushExtra = (line: string) => {
    const extra = inArchive ? archiveExtra : currentLane?.extra;
    if (extra) {
      const afterItemId = lastItem?.id;
      const previous = extra[extra.length - 1];
      if (previous && previous.afterItemId === afterItemId) previous.lines.push(line);
      else extra.push({ afterItemId, lines: [line] });
    }
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
    // "```" lines can't corrupt the board on re-parse. A whitespace-only
    // continuation ("  ") is a blank line inside the card — serializeItem
    // emits one for each interior blank title line, so treating it as a
    // card boundary here would split the card on reload.
    if (currentItem && (line.startsWith("\t") || /^\s{2,}/.test(line))) {
      // Remove only the tab or two spaces that make this a list
      // continuation. Any additional indentation is card content (for
      // example, an indented code block) and must survive a save unchanged.
      currentItem.title += "\n" + (line.startsWith("\t") ? line.slice(1) : line.slice(2));
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
      awaitingArchiveHeading = true;
      currentLane = null;
      currentItem = null;
      lastItem = null;
      continue;
    }

    // Lane headings
    if (trimmed.startsWith("## ")) {
      currentItem = null;
      if (inArchive && awaitingArchiveHeading && /^##\s+archive\s*$/i.test(trimmed)) {
        // Consume only the archive marker. Any later headings are user content.
        awaitingArchiveHeading = false;
        continue;
      }
      if (inArchive) {
        pushExtra(line);
        continue;
      }
      const title = trimmed.substring(3).trim();
      currentLane = { id: generateId(), title, items: [], extra: [] };
      lanes.push(currentLane);
      lastItem = null;
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
      lastItem = newItem;
      continue;
    }

    if (trimmed === "") {
      // Blank lines inside a lane/archive are meaningful Markdown spacing.
      // Keep them as opaque content at their original anchor.
      // The split produces a final empty element for a trailing newline;
      // serialization supplies that newline itself, so do not turn it into a
      // growing opaque block on every round-trip.
      if (i !== lines.length - 1) {
        if ((currentLane || inArchive) && !(inArchive && awaitingArchiveHeading)) {
          pushExtra(line);
        } else if (!currentLane && !inArchive && preamble.length > 0) {
          // Interior preamble blanks separate paragraphs and must survive.
          // Leading ones are skipped (and trailing ones popped below): that
          // spacing is canonical and owned by serializeBoard.
          preamble.push(line);
        }
      }
      currentItem = null;
      continue;
    }

    // Anything unrecognized is preserved verbatim and re-emitted on save
    currentItem = null;
    pushExtra(line);
  }

  while (preamble.length > 0 && preamble[preamble.length - 1] === "") preamble.pop();

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

/** Push opaque Markdown blocks at the same card-relative position. */
function serializeExtra(
  lines: string[],
  extra: ExtraBlock[] | undefined,
  afterItemId: string | undefined
) {
  for (const block of extra ?? []) {
    if (block.afterItemId === afterItemId) lines.push(...block.lines);
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
    serializeExtra(lines, lane.extra, undefined);
    for (const item of lane.items) {
      serializeItem(lines, item);
      serializeExtra(lines, lane.extra, item.id);
    }
    // Keep opaque blocks even if their former card was deleted or moved.
    for (const block of lane.extra ?? []) {
      if (block.afterItemId && !lane.items.some((item) => item.id === block.afterItemId)) {
        lines.push(...block.lines);
      }
    }
    if (lines[lines.length - 1] !== "") lines.push("");
  }

  const archiveExtra = board.archiveExtra ?? [];
  if (board.archive.length > 0 || archiveExtra.length > 0) {
    lines.push("---", "", "## Archive");
    serializeExtra(lines, archiveExtra, undefined);
    for (const item of board.archive) {
      serializeItem(lines, item);
      serializeExtra(lines, archiveExtra, item.id);
    }
    for (const block of archiveExtra) {
      if (block.afterItemId && !board.archive.some((item) => item.id === block.afterItemId)) {
        lines.push(...block.lines);
      }
    }
    if (lines[lines.length - 1] !== "") lines.push("");
  }

  return lines.join("\n");
}
