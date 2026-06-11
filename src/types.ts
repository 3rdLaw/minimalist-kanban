export interface Item {
  id: string;
  title: string;
  checked: boolean;
}

export interface Lane {
  id: string;
  title: string;
  items: Item[];
  /** Unrecognized markdown lines under this lane, preserved verbatim. */
  extra?: string[];
}

export interface Board {
  lanes: Lane[];
  archive: Item[];
  /** Raw frontmatter lines (between the `---` delimiters), preserved verbatim. */
  frontmatter?: string[];
  /** Unrecognized lines between the frontmatter and the first lane heading. */
  preamble?: string[];
  /** Unrecognized lines in the archive section. */
  archiveExtra?: string[];
}

let counter = 0;
export function generateId(): string {
  return `kb-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}
