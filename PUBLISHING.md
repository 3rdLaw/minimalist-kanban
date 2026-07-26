# Publishing

## Prerequisites

```bash
npm install
```

## Linting

Run the Obsidian ESLint plugin to catch review-bot issues before submitting:

```bash
npm run lint
```

This runs `eslint-plugin-obsidianmd` with the recommended ruleset, checking for sentence case, forbidden APIs, `any` types, and other Obsidian plugin guidelines. It then runs `npm run check` (svelte-check), which type-checks the `.svelte` component scripts against the Obsidian typings — the only thing that catches a call to an API Obsidian no longer publishes.

## Unit tests

```bash
# Run all tests
npm test

# Single file
npx vitest run tests/parser.test.ts
```

304 tests across 9 files (parser, parser properties, item, lane, board, link-suggest, main, kanban-view, settings). All run in jsdom with mocked Obsidian API and SortableJS.

## E2E tests

E2E tests drive a live Obsidian instance via the [Obsidian CLI](https://obsidian.md/help/Extending+Obsidian/Obsidian+CLI) (requires Obsidian 1.12+).

**One-time setup:**

```bash
./tests/e2e/setup.sh
```

Then open the test vault in Obsidian, disable restricted mode, and enable the plugin.

**Running:**

```bash
# Obsidian must be running with the test vault open
npm run test:e2e
```

## Creating a release

1. Bump the version. `npm version` writes `package.json` and `package-lock.json`, then runs `version-bump.mjs` (npm's `version` lifecycle script) to carry the new version into `manifest.json` and add a `versions.json` entry pointing at the current `minAppVersion`:

   ```bash
   npm version --no-git-tag-version minor   # or patch / major
   ```

   `--no-git-tag-version` leaves the commit and tag to you. It touches four files but only stages two: `version-bump.mjs` runs `git add manifest.json versions.json`, so `package.json` and `package-lock.json` are left modified but unstaged.

   Dropping the flag lets npm commit and tag in one step, but it requires a clean working tree and tags as `v0.10.0` — this repo's existing tags have no `v`. Run `npm config set tag-version-prefix ""` once if you want that form.

   If a release needs a **higher** `minAppVersion`, edit `manifest.json` first: `version-bump.mjs` copies whatever is in `minAppVersion` into the new `versions.json` entry. Obsidian reads `versions.json` to offer installations older than the current minimum the newest plugin version they can still run, so past entries must not be rewritten.

2. Build the production bundle:

   ```bash
   npm run build
   ```

3. Run the full check suite:

   ```bash
   npm run lint && npm test && npm audit
   ```

   Review any audit findings. Dev-only vulnerabilities (in test tooling, build tools) are lower risk but production dependencies should be clean.

4. Commit the version bump and push.

5. Create a GitHub release:
   - Set the **tag** to match the version in `manifest.json` (e.g. `0.3.0`).
   - Give the release a name and description.
   - Attach these files as binary assets:
     - `main.js`
     - `manifest.json`
     - `styles.css`

Obsidian's community plugin infrastructure picks up the release automatically once the tag and manifest version match.

##### Temporary notes for myself
Until it's hosted, I do the following to load the files on desktop:
```
cd ~/vault-the-first/.obsidian/plugins/minimalist-kanban; cp ~/code/minimalist-kanban/{main.js,manifest.json,styles.css} .
```
Then click refresh icon near community plugins, ensure the new version number appears, then toggle the plugin on/off on desktop.
Repeat later on mobile too, unfortunately.