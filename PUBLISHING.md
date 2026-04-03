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

This runs `eslint-plugin-obsidianmd` with the recommended ruleset, checking for sentence case, forbidden APIs, `any` types, and other Obsidian plugin guidelines.

## Unit tests

```bash
# Run all tests
npm test

# Single file
npx vitest run tests/parser.test.ts
```

80 tests across 4 files (parser, item, lane, board). All run in jsdom with mocked Obsidian API and SortableJS.

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

1. Update `version` in both `manifest.json` and `package.json` to the new version (must follow semver `x.y.z`).

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
~/vault-the-first/.obsidian/plugins/minimalist-kanban$ cp ~/code/minimalist-kanban/{main.js,manifest.json,styles.css} .
Then click refresh icon near community plugins, ensure the new version number appears, then toggle the plugin on/off on desktop.
Repeat later on mobile too, unfortunately.