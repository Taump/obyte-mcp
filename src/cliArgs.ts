import { ObyteMcpError } from "./errors.js";
import { parseNetwork } from "./config.js";
import type { CliOptions, Network } from "./types.js";

export type CommandName = "server" | "setup" | "doctor" | "help" | "version";
export type ClientName = "codex" | "claude-desktop" | "claude-code";

export interface ParsedCli {
  command: CommandName;
  options: CliOptions;
  setup: {
    printOnly: boolean;
    client?: ClientName;
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
    doctor: { json: false }
  };

  const args = [...argv];
  const first = args[0];
  if (first === "setup" || first === "doctor") {
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
      parsed.setup.client = parseClient(requireString(next, "--client"));
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
  if (value === "codex" || value === "claude-desktop" || value === "claude-code") return value;
  throw new ObyteMcpError("CONFIG_ERROR", "--client must be codex, claude-desktop, or claude-code", { value });
}
