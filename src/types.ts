export interface Item {
  id: string;
  title: string;
  checked: boolean;
}

/**
 * Markdown which the board UI does not interpret.  It is anchored to the
 * preceding card so saving a board does not move a note or callout past later
 * cards in the same lane.
 */
export interface ExtraBlock {
  afterItemId?: string;
  lines: string[];
}

export interface Lane {
  id: string;
  title: string;
  items: Item[];
  /** Unrecognized markdown under this lane, preserved in document order. */
  extra?: ExtraBlock[];
}

export interface Board {
  lanes: Lane[];
  archive: Item[];
  /** Raw frontmatter lines (between the `---` delimiters), preserved verbatim. */
  frontmatter?: string[];
  /** Unrecognized lines between the frontmatter and the first lane heading. */
  preamble?: string[];
  /** Unrecognized markdown in the archive section, preserved in document order. */
  archiveExtra?: ExtraBlock[];
}

let counter = 0;
export function generateId(): string {
  return `kb-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}
