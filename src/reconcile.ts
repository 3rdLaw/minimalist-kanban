import type { Board, ExtraBlock, Item } from "./types";

/**
 * Carries ids from the board on screen onto a freshly parsed one, so a
 * re-parse (an external change, e.g. Obsidian Sync) can update the mounted
 * component in place instead of remounting it.
 *
 * Ids exist only in memory — they never reach the Markdown — so this decides
 * which components Svelte keeps, never what is saved. The only rule is
 * equality: lanes keep their ids only if the whole sequence of lane titles is
 * unchanged, and a lane's cards (or the archive's) keep theirs only if that
 * whole sequence of cards is unchanged. Nothing is matched by similarity; a
 * sequence that differs at all gets the parser's fresh ids.
 *
 * Mutates `next`. Returns false when the lanes did not match, in which case
 * `next` is left untouched and the caller should remount.
 */
export function reconcileIds(current: Board, next: Board): boolean {
  if (current.lanes.length !== next.lanes.length) return false;
  if (current.lanes.some((lane, i) => lane.title !== next.lanes[i].title)) return false;

  next.lanes.forEach((lane, i) => {
    const old = current.lanes[i];
    lane.id = old.id;
    adoptItemIds(old.items, lane.items, lane.extra);
  });
  adoptItemIds(current.archive, next.archive, next.archiveExtra);
  return true;
}

function adoptItemIds(current: Item[], next: Item[], extra: ExtraBlock[] | undefined) {
  if (current.length !== next.length) return;
  const same = current.every(
    (item, i) => item.title === next[i].title && item.checked === next[i].checked
  );
  if (!same) return;

  const renamed = new Map<string, string>();
  next.forEach((item, i) => {
    renamed.set(item.id, current[i].id);
    item.id = current[i].id;
  });
  // Extra blocks are anchored to the card they follow, by id.
  for (const block of extra ?? []) {
    if (block.afterItemId !== undefined) {
      block.afterItemId = renamed.get(block.afterItemId) ?? block.afterItemId;
    }
  }
}
