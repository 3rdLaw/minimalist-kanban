import Sortable from "sortablejs";
export function getSortable() {
  return (globalThis as unknown as { __TEST_SORTABLE__?: typeof Sortable }).__TEST_SORTABLE__ || Sortable;
}
