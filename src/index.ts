#!/usr/bin/env node
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { parseCliArgs } from "./cliArgs.js";
import { buildRuntimeConfig } from "./config.js";
import { ObyteMcpError, toObyteMcpError } from "./errors.js";
import { runDoctor } from "./doctor.js";
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

Usage:
  ${PACKAGE_NAME} [--network mainnet|testnet] [--hub URL] [--token-registry ADDRESS]
  ${PACKAGE_NAME} setup [--print-only] [--client codex|claude-desktop|claude-code] [--network mainnet|testnet]
  ${PACKAGE_NAME} doctor [--json]
  ${PACKAGE_NAME} --help
  ${PACKAGE_NAME} --version

Options:
  --network              Obyte network, default mainnet
  --hub                  Custom hub URL; https only, except http localhost
  --token-registry       Token registry AA address
  --timeout-ms           Hub request timeout, 1000..120000
  --max-concurrency      Max concurrent hub requests, 1..10
  --max-output-bytes     Max MCP tool response bytes, 16384..1048576

The default command starts MCP stdio. Do not print logs to stdout in this mode.
`;
}

main().catch((error: unknown) => {
  const normalized = toObyteMcpError(error);
  const body = normalized instanceof ObyteMcpError ? normalized : toObyteMcpError(error);
  process.stderr.write(`${body.code}: ${body.message}\n`);
  process.exitCode = 1;
});
