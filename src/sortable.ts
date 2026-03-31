import Sortable from "sortablejs";
export function getSortable() {
  return (globalThis as any).__TEST_SORTABLE__ || Sortable;
}
