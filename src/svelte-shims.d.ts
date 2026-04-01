declare module "*.svelte" {
  import { SvelteComponent } from "svelte";
  export default class extends SvelteComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  > {}
}
