#!/usr/bin/env node
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { parseCliArgs } from "./cliArgs.js";
import { buildRuntimeConfig } from "./config.js";
import { toObyteMcpError } from "./errors.js";
import { runDoctor } from "./doctor.js";
import { runInstall } from "./install.js";
import { runServer } from "./server.js";
import { runSetup } from "./setup.js";

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.command === "help") {
    process.stdout.write(helpText());
    return;
  }
  if (parsed.command === "version") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }
  if (parsed.command === "setup") {
    await runSetup(parsed.options, parsed.setup);
    return;
  }
  if (parsed.command === "install") {
    await runInstall(parsed.options, parsed.install);
    return;
  }
  if (parsed.command === "doctor") {
    await runDoctor(parsed.options, parsed.doctor);
    return;
  }

  const config = buildRuntimeConfig(process.env, parsed.options);
  await runServer(config);
}

function helpText(): string {
  return `${PACKAGE_NAME} ${PACKAGE_VERSION}

Local stdio MCP server for querying Obyte hubs.

This one server serves both mainnet and testnet. Every tool accepts an optional
"network" ("mainnet" or "testnet"); when omitted it uses the default network below.

Usage:
  ${PACKAGE_NAME} [--network mainnet|testnet] [hub/registry overrides]
  ${PACKAGE_NAME} install [--client vscode|cursor|codex|claude-desktop|claude-code] [--name NAME] [--dry-run]
  ${PACKAGE_NAME} setup [--print-only] [--client vscode|cursor|codex|claude-desktop|claude-code]
  ${PACKAGE_NAME} doctor [--json]
  ${PACKAGE_NAME} --help
  ${PACKAGE_NAME} --version

Commands:
  (default)              Start the MCP stdio server
  install                Register the server with a client (runs its CLI or writes its config)
  setup                  Print client config snippets without changing anything
  doctor                 Check Node version and runtime config

Options:
  --network              Default Obyte network when a call omits "network", default mainnet
  --hub                  Custom hub URL for the default network; https only, except http localhost
  --token-registry       Token registry AA address for the default network
  --mainnet-hub          Custom mainnet hub URL
  --testnet-hub          Custom testnet hub URL
  --mainnet-token-registry   Mainnet token registry AA address
  --testnet-token-registry   Testnet token registry AA address
  --timeout-ms           Hub request timeout, 1000..120000
  --max-concurrency      Max concurrent hub requests, 1..10
  --max-output-bytes     Max MCP tool response bytes, 16384..1048576
  --client               Target one client (install/setup); default is every detected client
  --name                 Server name to register (install), default obyte
  --dry-run              Print what install would do without changing anything

The default command starts MCP stdio. Do not print logs to stdout in this mode.
`;
}

main().catch((error: unknown) => {
  const normalized = toObyteMcpError(error);
  process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  process.exitCode = 1;
});
