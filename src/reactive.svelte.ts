/**
 * Svelte 5 removed `component.$set()`. To push a prop change into a mounted
 * component you hand `mount()` a reactive object and assign to it instead.
 * `$state` is only available inside a rune-aware module, which is what the
 * `.svelte.ts` extension buys us — `KanbanView.ts` is a plain module and
 * cannot call it directly.
 */
export function reactive<T extends object>(initial: T): T {
  const state = $state(initial);
  return state;
}
