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
import type { CliOptions, ConfigSource, EnvelopeConfig, Network, NetworkConfig, RuntimeConfig } from "./types.js";

export const NETWORKS: readonly Network[] = ["mainnet", "testnet"];

export function parseNetwork(value: string | undefined, source: string): Network | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "mainnet" || value === "testnet") return value;
  throw new ObyteMcpError("CONFIG_ERROR", `${source} must be "mainnet" or "testnet"`, { value });
}

export function buildRuntimeConfig(env: NodeJS.ProcessEnv = process.env, cli: CliOptions = {}): RuntimeConfig {
  const envNetwork = parseNetwork(env.OBYTE_NETWORK, "OBYTE_NETWORK");
  const defaultNetwork = envNetwork ?? cli.network ?? "mainnet";
  const defaultNetworkSource: ConfigSource = envNetwork ? "env" : cli.network ? "cli" : "default";

  const networks = {
    mainnet: buildNetworkConfig("mainnet", env, cli, defaultNetwork),
    testnet: buildNetworkConfig("testnet", env, cli, defaultNetwork)
  } satisfies Record<Network, NetworkConfig>;

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
    defaultNetwork,
    defaultNetworkSource,
    networks,
    timeoutMs,
    maxConcurrency,
    maxOutputBytes,
    limitsSource: {
      timeoutMs: env.OBYTE_REQUEST_TIMEOUT_MS ? "env" : cli.timeoutMs !== undefined ? "cli" : "default",
      maxConcurrency: env.OBYTE_MAX_CONCURRENCY ? "env" : cli.maxConcurrency !== undefined ? "cli" : "default",
      maxOutputBytes: env.OBYTE_MAX_OUTPUT_BYTES ? "env" : cli.maxOutputBytes !== undefined ? "cli" : "default"
    }
  };
}

/** Narrows the full runtime config to the fields the response envelope needs for one network. */
export function envelopeConfig(config: RuntimeConfig, network: Network): EnvelopeConfig {
  return { network, hubAddress: config.networks[network].hubAddress, maxOutputBytes: config.maxOutputBytes };
}

function buildNetworkConfig(network: Network, env: NodeJS.ProcessEnv, cli: CliOptions, defaultNetwork: Network): NetworkConfig {
  const isDefault = network === defaultNetwork;
  const upper = network.toUpperCase();

  const hub = resolveSourced(
    [
      [normalizeHubAddress(env[`OBYTE_${upper}_HUB_ADDRESS`]), "env"],
      [normalizeHubAddress(network === "mainnet" ? cli.mainnetHubAddress : cli.testnetHubAddress), "cli"],
      [isDefault ? normalizeHubAddress(env.OBYTE_HUB_ADDRESS) : undefined, "env"],
      [isDefault ? normalizeHubAddress(cli.hubAddress) : undefined, "cli"]
    ],
    [network === "testnet" ? TESTNET_HUB : MAINNET_HUB, "default"]
  );

  const registryDefault: string | undefined = network === "mainnet" ? MAINNET_TOKEN_REGISTRY_ADDRESS : undefined;
  const registry = resolveSourced(
    [
      [normalizeOptionalString(env[`OBYTE_${upper}_TOKEN_REGISTRY_ADDRESS`]), "env"],
      [normalizeOptionalString(network === "mainnet" ? cli.mainnetTokenRegistryAddress : cli.testnetTokenRegistryAddress), "cli"],
      [isDefault ? normalizeOptionalString(env.OBYTE_TOKEN_REGISTRY_ADDRESS) : undefined, "env"],
      [isDefault ? normalizeOptionalString(cli.tokenRegistryAddress) : undefined, "cli"]
    ],
    [registryDefault, registryDefault ? "default" : "unset"]
  );

  return {
    network,
    hubAddress: hub.value,
    tokenRegistryAddress: registry.value,
    hubSource: hub.source,
    tokenRegistrySource: registry.source
  };
}

function resolveSourced<T, S extends ConfigSource | "unset">(
  candidates: Array<[T | undefined, ConfigSource]>,
  fallback: [T, S]
): { value: T; source: ConfigSource | S } {
  for (const [value, source] of candidates) {
    if (value !== undefined) return { value, source };
  }
  return { value: fallback[0], source: fallback[1] };
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
