# Mobile layout notes

## Virtual keyboard handling (Android)

On Android, when the virtual keyboard opens, `window.innerHeight` and `visualViewport.height` do **not** change — the keyboard overlays the content at the native layer. Obsidian internally resizes `.view-content` (e.g. 805px → 454px) through its own native bridge, but this resize can break standard CSS layout approaches.

### What failed

- **`display: flex` on `.view-content`** with `flex: 1 1 0` on the board. Obsidian may override the `display` property during keyboard-triggered relayout, causing the board to collapse to ~64px instead of filling the resized container.

- **`overflow: hidden`** on `.view-content`. This creates a scroll container, and the browser will implicitly set `scrollTop` on it to bring the focused input into view — pushing all board content out of the viewport.

- **Viewport-based CSS** (`100vh`, `100dvh`, percentage heights). The viewport APIs don't reflect the keyboard state on Obsidian Android, so these units remain at full-screen values even when the keyboard is covering half the screen.

### What works

- **Absolute positioning.** `.view-content` gets `position: relative`, and `.kb-board` gets `position: absolute; top:0; left:0; right:0; bottom:0`. This fills the container reliably regardless of what `display` value Obsidian sets during the relayout.

- **`overflow: clip`** (not `hidden`) on `.view-content`. Clips overflow identically to `hidden` but does **not** create a scroll container, so the browser cannot implicitly scroll it.

- **JS `focusin` handler** that walks up the DOM from `.kb-view` and resets `scrollTop = 0` on ancestor elements. Catches any residual browser scroll behavior that `overflow: clip` doesn't prevent.

### Key observations

- `window.innerHeight`, `visualViewport.height`, and `screen.height` all remain unchanged when the keyboard is open
- Obsidian resizes `.view-content` internally (via its Capacitor/native bridge), not through viewport mechanics
- The `VirtualKeyboard` API (`navigator.virtualKeyboard`) is available in Obsidian's Android WebView but was not needed for this fix
- Desktop mobile emulation (`app.emulateMobile(true)`) does **not** replicate the keyboard resize behavior — test on a real device

### Phone-specific padding

On phones, Obsidian renders floating navigation icons at the bottom of the viewport. `.is-phone .kb-board` has `padding-bottom: 48px` to keep lane content above them.
