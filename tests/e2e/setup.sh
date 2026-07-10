#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# The vault is committed to the repo; its name (directory basename) is how
# the obsidian CLI addresses it (vault=minimalist-kanban-vault).
VAULT_DIR="$SCRIPT_DIR/minimalist-kanban-vault"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/minimalist-kanban"

echo "=== minimalist-kanban e2e setup ==="
echo "Project root: $PROJECT_ROOT"
echo "Test vault:   $VAULT_DIR"

# Build the plugin first
echo ""
echo "Building plugin..."
(cd "$PROJECT_ROOT" && npm run build)

# The plugins dir is gitignored (the symlink is machine-specific) — recreate it
mkdir -p "$VAULT_DIR/.obsidian/plugins"

# Symlink the plugin files (not the whole project — just what Obsidian needs)
if [ -L "$PLUGIN_DIR" ]; then
  if [ "$(readlink "$PLUGIN_DIR")" != "$PROJECT_ROOT" ]; then
    echo "Fixing stale symlink at $PLUGIN_DIR"
    ln -sfn "$PROJECT_ROOT" "$PLUGIN_DIR"
  else
    echo "Symlink already exists at $PLUGIN_DIR"
  fi
elif [ -d "$PLUGIN_DIR" ]; then
  echo "WARNING: $PLUGIN_DIR is a real directory, not a symlink. Remove it and re-run."
  exit 1
else
  ln -s "$PROJECT_ROOT" "$PLUGIN_DIR"
  echo "Created symlink: $PLUGIN_DIR -> $PROJECT_ROOT"
fi

# Verify the required files are reachable through the symlink
for f in main.js manifest.json styles.css; do
  if [ -f "$PLUGIN_DIR/$f" ]; then
    echo "  OK: $f"
  else
    echo "  MISSING: $f — run 'npm run build' first"
  fi
done

echo ""
echo "=== Next steps ==="
echo "1. Register the vault with Obsidian (once per machine): open it via the"
echo "   vault switcher ('Open folder as vault' -> $VAULT_DIR)"
echo "2. Enable the plugin: Settings -> Community plugins -> Enable 'Minimalist Kanban'"
echo "   Or via CLI:  obsidian vault=minimalist-kanban-vault plugin:enable id=minimalist-kanban"
echo "3. Run the e2e test:  npm run test:e2e"
