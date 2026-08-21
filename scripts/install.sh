#!/usr/bin/env sh
# Register obyte-mcp with your local MCP clients (VS Code, Cursor, Codex, Claude Desktop, Claude Code).
#
# Usage:
#   ./scripts/install.sh                       # every detected client, mainnet default
#   ./scripts/install.sh --dry-run             # preview without changing anything
#   ./scripts/install.sh --client vscode       # a single client
#   ./scripts/install.sh --network testnet     # make testnet the default network
#
# Any flags are passed through to `obyte-mcp install`.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root_dir=$(dirname -- "$script_dir")

if [ -f "$root_dir/dist/index.js" ]; then
  # Running from a checkout: use the local build.
  node "$root_dir/dist/index.js" install "$@"
elif [ -f "$root_dir/package.json" ] && command -v npm >/dev/null 2>&1; then
  # Checkout without a build yet: build first, then install.
  (cd "$root_dir" && npm install && npm run build)
  node "$root_dir/dist/index.js" install "$@"
else
  # No checkout: use the published package.
  npx -y obyte-mcp install "$@"
fi
