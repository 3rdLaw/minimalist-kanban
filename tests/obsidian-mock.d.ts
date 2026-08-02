/**
 * Test-only type surface for `tests/mocks/obsidian.ts`.
 *
 * vitest aliases the `obsidian` module to that mock at runtime
 * (see vitest.config.mts), but TypeScript resolves `import ... from "obsidian"`
 * to the real package's typings. The mock deliberately adds things the real API
 * has no reason to expose — `static instances` arrays so a test can assert what
 * the plugin constructed, a `findItem` lookup, a `lastViewState` record — and
 * without these declarations every use of them was a type error. That is why
 * the unit suites went unchecked.
 *
 * Declared here rather than by pointing `paths` at the mock, because the tests
 * import from `../src`, so aliasing the module would check the PLUGIN's source
 * against the mock too — hiding real API misuse. src keeps the real typings and
 * is checked separately by `npm run check`.
 *
 * Only additive: nothing here contradicts the real API, so a test that
 * typechecks against this still typechecks against Obsidian proper. Keep it in
 * step with the mock — a member added there needs a line here.
 */

import "obsidian";

declare module "obsidian" {
  // `namespace X` merges with `class X`, which is how a static is added to an
  // already-declared class. The `interface X` blocks reach the instance side.
  namespace Menu {
    const instances: Menu[];
  }
  namespace Notice {
    const instances: Notice[];
  }
  namespace Setting {
    const instances: Setting[];
  }

  interface Menu {
    /** What the mock recorded, so tests can assert menu contents. */
    items: (MenuItem | { type: "separator" })[];
    /** Mock helper: first item whose title matches, ignoring separators. */
    findItem(title: string): MenuItem | undefined;
  }

  interface MenuItem {
    /** Present in current Obsidian, absent from the installed typings. */
    setSubmenu(): Menu;
    // The mock records what was set so tests can read it back.
    _title: string;
    _icon: string;
    _checked: boolean;
    _onClick: (() => void) | null;
    _submenu: Menu | null;
  }

  interface Notice {
    /** Mock-only: set by hide(), so tests can assert dismissal. */
    hidden: boolean;
  }

  interface Setting {
    /** Mock-only: the label this Setting was given. */
    name: string;
    /** Mock-only: the toggle this Setting built, for driving onChange. */
    toggle: {
      value: boolean;
      changeHandler: ((v: boolean) => unknown) | null;
      setValue(v: boolean): unknown;
      onChange(handler: (v: boolean) => unknown): unknown;
    } | null;
  }

  interface WorkspaceLeaf {
    /**
     * Mock-only: the last state passed to setViewState, for assertions.
     *
     * Typed `any` to match the mock's own declaration. Narrowing it to
     * `ViewState | null` would be more informative but forces a non-null
     * assertion at ~11 call sites that are only ever reading back what the
     * test itself just triggered.
     */

    lastViewState: any;
  }
}
