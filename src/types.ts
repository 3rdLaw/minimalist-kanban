export interface Item {
  id: string;
  title: string;
  checked: boolean;
  hasCheckbox: boolean;
}

export interface Lane {
  id: string;
  title: string;
  items: Item[];
}

export interface Board {
  lanes: Lane[];
  archive: Item[];
}

let counter = 0;
export function generateId(): string {
  return `kb-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}
