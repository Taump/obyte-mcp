import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAINNET_HUB,
  MAINNET_TOKEN_REGISTRY_ADDRESS,
  MAX_MAX_CONCURRENCY,
  MAX_MAX_OUTPUT_BYTES,
  MAX_TIMEOUT_MS,
  MIN_MAX_CONCURRENCY,
  MIN_MAX_OUTPUT_BYTES,
  MIN_TIMEOUT_MS,
  TESTNET_HUB
} from "./constants.js";
import { ObyteMcpError } from "./errors.js";
import type { CliOptions, Network, RuntimeConfig } from "./types.js";

export function parseNetwork(value: string | undefined, source: string): Network | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "mainnet" || value === "testnet") return value;
  throw new ObyteMcpError("CONFIG_ERROR", `${source} must be "mainnet" or "testnet"`, { value });
}

export function buildRuntimeConfig(env: NodeJS.ProcessEnv = process.env, cli: CliOptions = {}): RuntimeConfig {
  const envNetwork = parseNetwork(env.OBYTE_NETWORK, "OBYTE_NETWORK");
  const network = envNetwork ?? cli.network ?? "mainnet";
  const networkSource = envNetwork ? "env" : cli.network ? "cli" : "default";

  const envHub = normalizeHubAddress(env.OBYTE_HUB_ADDRESS);
  const cliHub = normalizeHubAddress(cli.hubAddress);
  const hubAddress = envHub ?? cliHub ?? (network === "testnet" ? TESTNET_HUB : MAINNET_HUB);
  const hubSource = envHub ? "env" : cliHub ? "cli" : "default";

  const envRegistry = normalizeOptionalString(env.OBYTE_TOKEN_REGISTRY_ADDRESS);
  const cliRegistry = normalizeOptionalString(cli.tokenRegistryAddress);
  const tokenRegistryAddress = envRegistry ?? cliRegistry ?? (network === "mainnet" ? MAINNET_TOKEN_REGISTRY_ADDRESS : undefined);
  const registrySource = envRegistry ? "env" : cliRegistry ? "cli" : network === "mainnet" ? "default" : "unset";

  const timeoutMs = pickBoundedNumber(env.OBYTE_REQUEST_TIMEOUT_MS, cli.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, "OBYTE_REQUEST_TIMEOUT_MS");
  const maxConcurrency = pickBoundedNumber(
    env.OBYTE_MAX_CONCURRENCY,
    cli.maxConcurrency,
    DEFAULT_MAX_CONCURRENCY,
    MIN_MAX_CONCURRENCY,
    MAX_MAX_CONCURRENCY,
    "OBYTE_MAX_CONCURRENCY"
  );
  const maxOutputBytes = pickBoundedNumber(
    env.OBYTE_MAX_OUTPUT_BYTES,
    cli.maxOutputBytes,
    DEFAULT_MAX_OUTPUT_BYTES,
    MIN_MAX_OUTPUT_BYTES,
    MAX_MAX_OUTPUT_BYTES,
    "OBYTE_MAX_OUTPUT_BYTES"
  );

  return {
    network,
    hubAddress,
    tokenRegistryAddress,
    timeoutMs,
    maxConcurrency,
    maxOutputBytes,
    source: {
      network: networkSource,
      hubAddress: hubSource,
      tokenRegistryAddress: registrySource,
      timeoutMs: env.OBYTE_REQUEST_TIMEOUT_MS ? "env" : cli.timeoutMs !== undefined ? "cli" : "default",
      maxConcurrency: env.OBYTE_MAX_CONCURRENCY ? "env" : cli.maxConcurrency !== undefined ? "cli" : "default",
      maxOutputBytes: env.OBYTE_MAX_OUTPUT_BYTES ? "env" : cli.maxOutputBytes !== undefined ? "cli" : "default"
    }
  };
}

export function normalizeHubAddress(value: string | undefined): string | undefined {
  const raw = normalizeOptionalString(value);
  if (!raw) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ObyteMcpError("CONFIG_ERROR", "Hub address must be a valid URL", { value: raw });
  }

  if (parsed.username || parsed.password) {
    throw new ObyteMcpError("CONFIG_ERROR", "Hub address must not include credentials");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new ObyteMcpError("CONFIG_ERROR", "Custom hub URL must use https, except http localhost is allowed for development", { value: raw });
  }

  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function pickBoundedNumber(
  envValue: string | undefined,
  cliValue: number | undefined,
  defaultValue: number,
  min: number,
  max: number,
  label: string
): number {
  const raw = envValue !== undefined && envValue !== "" ? Number(envValue) : cliValue;
  if (raw === undefined) return defaultValue;
  if (!Number.isInteger(raw) || raw < min || raw > max) {
    throw new ObyteMcpError("CONFIG_ERROR", `${label} must be an integer from ${min} to ${max}`, { value: raw });
  }
  return raw;
}
