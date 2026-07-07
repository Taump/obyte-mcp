export type Network = "mainnet" | "testnet";
export type ConfigSource = "env" | "cli" | "default";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "CONFIG_ERROR"
  | "HUB_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "OUTPUT_TOO_LARGE"
  | "SECRET_INPUT_REJECTED"
  | "INTERNAL_ERROR";

export interface NetworkConfig {
  network: Network;
  hubAddress: string;
  tokenRegistryAddress: string | undefined;
  hubSource: ConfigSource;
  tokenRegistrySource: ConfigSource | "unset";
}

export interface RuntimeConfig {
  defaultNetwork: Network;
  defaultNetworkSource: ConfigSource;
  networks: Record<Network, NetworkConfig>;
  timeoutMs: number;
  maxConcurrency: number;
  maxOutputBytes: number;
  limitsSource: {
    timeoutMs: ConfigSource;
    maxConcurrency: ConfigSource;
    maxOutputBytes: ConfigSource;
  };
}

/** Minimal per-call view used when building the response envelope. */
export interface EnvelopeConfig {
  network: Network;
  hubAddress: string;
  maxOutputBytes: number;
}

export interface CliOptions {
  network?: Network | undefined;
  hubAddress?: string | undefined;
  tokenRegistryAddress?: string | undefined;
  mainnetHubAddress?: string | undefined;
  testnetHubAddress?: string | undefined;
  mainnetTokenRegistryAddress?: string | undefined;
  testnetTokenRegistryAddress?: string | undefined;
  timeoutMs?: number | undefined;
  maxConcurrency?: number | undefined;
  maxOutputBytes?: number | undefined;
}

export interface ToolMeta {
  network: Network;
  hub: string;
  tool: string;
  request_id: string;
  duration_ms: number;
  retry_count: number;
  truncated: boolean;
  output_bytes_before_truncation?: number;
  output_bytes_after_truncation?: number;
  truncation_reason?: string;
}

export interface SuccessEnvelope {
  ok: true;
  meta: ToolMeta;
  data: unknown;
}

export interface ErrorEnvelope {
  ok: false;
  meta: ToolMeta;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ToolEnvelope = SuccessEnvelope | ErrorEnvelope;

export interface ToolExecutionContext {
  config: EnvelopeConfig;
  requestId: string;
  toolName: string;
  startedAt: number;
  retryCount: number;
}
