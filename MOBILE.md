# Mobile layout notes

## Virtual keyboard handling (Android)

On Android, when the virtual keyboard opens, `window.innerHeight` and `visualViewport.height` do **not** change — the keyboard overlays the content at the native layer. Obsidian internally resizes `.view-content` (e.g. 805px → 454px) through its own native bridge, but this resize can break standard CSS layout approaches.

### What failed

- **`display: flex` on `.view-content`** with `flex: 1 1 0` on the board. Obsidian may override the `display` property during keyboard-triggered relayout, causing the board to collapse to ~64px instead of filling the resized container.

- **`overflow: hidden`** on `.view-content`. This creates a scroll container, and the browser will implicitly set `scrollTop` on it to bring the focused input into view — pushing all board content out of the viewport.

- **Viewport-based CSS** (`100vh`, `100dvh`, percentage heights). The viewport APIs don't reflect the keyboard state on Obsidian Android, so these units remain at full-screen values even when the keyboard is covering half the screen.

### What works

These rules live in `styles.css`, scoped to `.is-mobile`. `.view-content` is the view's `contentEl`, which `KanbanView` classes `.kb-view`, so the selectors there read `.kb-view` / `.kb-board`.

- **Absolute positioning.** `.view-content` gets `position: relative`, and `.kb-board` gets `position: absolute; top:0; left:0; right:0; bottom:0`. This fills the container reliably regardless of what `display` value Obsidian sets during the relayout.

- **`overflow: clip`** (not `hidden`) on `.view-content`. Clips overflow identically to `hidden` but does **not** create a scroll container, so the browser cannot implicitly scroll it.

- **JS `focusin` handler** that walks up the DOM from `.kb-view` and resets `scrollTop = 0` on ancestor elements, once on the next animation frame and again after 120ms (`Board.svelte`). Catches any residual browser scroll behavior that `overflow: clip` doesn't prevent.

### Key observations

- `window.innerHeight`, `visualViewport.height`, and `screen.height` all remain unchanged when the keyboard is open
- Obsidian resizes `.view-content` internally (via its Capacitor/native bridge), not through viewport mechanics
- The `VirtualKeyboard` API (`navigator.virtualKeyboard`) is available in Obsidian's Android WebView but was not needed for this fix
- Desktop mobile emulation (`app.emulateMobile(true)`) does **not** replicate the keyboard resize behavior — test on a real device

### Phone-specific padding

On phones, Obsidian renders floating navigation icons at the bottom of the viewport. `.is-phone .kb-board` has `padding-bottom: 64px` to keep lane content above them.

## Reading the keyboard height

The viewport APIs never report the keyboard, but Obsidian does: it publishes the soft-keyboard height on the root element as the CSS custom property `--keyboard-height`, and caps its own UI with `body.is-mobile .app-container { max-height: calc(100vh - var(--keyboard-height)) }`. Measured on an Android phone: keyboard down, `--keyboard-height: 0px` and `visualViewport.height` 923; keyboard up, `--keyboard-height: 378.2875px` and `visualViewport.height` still 923.

- Anything **inside** `.app-container` (the board included) already sits in a container Obsidian has shrunk, which is why filling that container with absolute positioning is the right fix above.
- Anything mounted **outside** it is not shrunk. `.modal-container` is a direct child of `<body>`, so a modal keeps full-screen geometry and the keyboard covers it. For UI like that, read `--keyboard-height` from `document.documentElement` and watch the root element's `style` attribute with a `MutationObserver` to learn when it changes.
- The value is fractional, so parse it as a float. Obsidian animates it rather than stepping it, so a single read on one mutation can catch an intermediate frame; react to every mutation.

The plugin has no modals today; this matters as soon as it gets one.

## Sync landing while you type

An external change to an open board (usually an Obsidian Sync pull) updates it in place when the lanes are unchanged, so a half-typed card and the keyboard survive; see design constraint 7 in [ARCHITECTURE.md](ARCHITECTURE.md). When triaging a report of lost typing on mobile, ask which of these happened:

- **Typing continued uninterrupted:** the in-place update worked.
- **Keyboard closed and a notice appeared** (`.kb-draft-notice`, with Copy and Dismiss): a remount, which is expected when the lanes changed, or when SortableJS still thinks a drag is in progress (`KanbanView.setViewData` remounts while `Sortable.dragged` or `Sortable.active` is set). A touch on a card is suspected of leaving `Sortable.dragged` set after an Android `pointercancel`; that has not been confirmed on a device.
- **Text vanished with no notice:** a real bug.
