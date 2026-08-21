import { ObyteMcpError } from "./errors.js";
import { parseNetwork } from "./config.js";
import type { CliOptions, Network } from "./types.js";

export type CommandName = "server" | "setup" | "install" | "doctor" | "help" | "version";
export type ClientName = "codex" | "claude-desktop" | "claude-code" | "cursor" | "vscode";

export const CLIENT_NAMES: readonly ClientName[] = ["vscode", "cursor", "codex", "claude-desktop", "claude-code"];

export interface ParsedCli {
  command: CommandName;
  options: CliOptions;
  setup: {
    printOnly: boolean;
    client?: ClientName;
  };
  install: {
    dryRun: boolean;
    client?: ClientName;
    serverName?: string;
  };
  doctor: {
    json: boolean;
  };
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const parsed: ParsedCli = {
    command: "server",
    options: {},
    setup: { printOnly: false },
    install: { dryRun: false },
    doctor: { json: false }
  };

  const args = [...argv];
  const first = args[0];
  if (first === "setup" || first === "install" || first === "doctor") {
    parsed.command = first;
    args.shift();
  } else if (first === "--help" || first === "-h" || first === "help") {
    parsed.command = "help";
    args.shift();
  } else if (first === "--version" || first === "-v" || first === "version") {
    parsed.command = "version";
    args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--print-only") {
      parsed.setup.printOnly = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.install.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      parsed.doctor.json = true;
      continue;
    }

    const next = args[index + 1];
    if (arg === "--network") {
      parsed.options.network = requireValue(parseNetwork(next, "--network"), "--network") as Network;
      index += 1;
      continue;
    }
    if (arg === "--hub") {
      parsed.options.hubAddress = requireString(next, "--hub");
      index += 1;
      continue;
    }
    if (arg === "--token-registry") {
      parsed.options.tokenRegistryAddress = requireString(next, "--token-registry");
      index += 1;
      continue;
    }
    if (arg === "--mainnet-hub") {
      parsed.options.mainnetHubAddress = requireString(next, "--mainnet-hub");
      index += 1;
      continue;
    }
    if (arg === "--testnet-hub") {
      parsed.options.testnetHubAddress = requireString(next, "--testnet-hub");
      index += 1;
      continue;
    }
    if (arg === "--mainnet-token-registry") {
      parsed.options.mainnetTokenRegistryAddress = requireString(next, "--mainnet-token-registry");
      index += 1;
      continue;
    }
    if (arg === "--testnet-token-registry") {
      parsed.options.testnetTokenRegistryAddress = requireString(next, "--testnet-token-registry");
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.options.timeoutMs = parseInteger(requireString(next, "--timeout-ms"), "--timeout-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-concurrency") {
      parsed.options.maxConcurrency = parseInteger(requireString(next, "--max-concurrency"), "--max-concurrency");
      index += 1;
      continue;
    }
    if (arg === "--max-output-bytes") {
      parsed.options.maxOutputBytes = parseInteger(requireString(next, "--max-output-bytes"), "--max-output-bytes");
      index += 1;
      continue;
    }
    if (arg === "--client") {
      const client = parseClient(requireString(next, "--client"));
      parsed.setup.client = client;
      parsed.install.client = client;
      index += 1;
      continue;
    }
    if (arg === "--name") {
      parsed.install.serverName = requireString(next, "--name");
      index += 1;
      continue;
    }

    throw new ObyteMcpError("CONFIG_ERROR", `Unknown argument: ${arg}`);
  }

  return parsed;
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new ObyteMcpError("CONFIG_ERROR", `${label} requires a value`);
  return value;
}

function requireString(value: string | undefined, label: string): string {
  if (!value || value.startsWith("--")) throw new ObyteMcpError("CONFIG_ERROR", `${label} requires a value`);
  return value;
}

function parseInteger(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new ObyteMcpError("CONFIG_ERROR", `${label} requires an integer`);
  return number;
}

function parseClient(value: string): ClientName {
  if (CLIENT_NAMES.includes(value as ClientName)) return value as ClientName;
  throw new ObyteMcpError("CONFIG_ERROR", `--client must be one of ${CLIENT_NAMES.join(", ")}`, { value });
}
