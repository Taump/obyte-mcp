# Register obyte-mcp with your local MCP clients (VS Code, Codex, Claude Desktop, Claude Code).
#
# Usage:
#   ./scripts/install.ps1                    # all clients, mainnet default
#   ./scripts/install.ps1 --dry-run          # preview without changing anything
#   ./scripts/install.ps1 --client vscode    # a single client
#   ./scripts/install.ps1 --network testnet  # make testnet the default network
#
# Any flags are passed through to `obyte-mcp install`.
$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $rootDir "dist/index.js"

if (Test-Path $dist) {
  node $dist install @args
} elseif (Test-Path (Join-Path $rootDir "package.json")) {
  Push-Location $rootDir
  try {
    npm install
    npm run build
    node $dist install @args
  } finally {
    Pop-Location
  }
} else {
  npx -y obyte-mcp install @args
}
