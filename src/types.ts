export type Network = "mainnet" | "testnet";

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

export interface RuntimeConfig {
  network: Network;
  hubAddress: string;
  tokenRegistryAddress: string | undefined;
  timeoutMs: number;
  maxConcurrency: number;
  maxOutputBytes: number;
  source: {
    network: "env" | "cli" | "default";
    hubAddress: "env" | "cli" | "default";
    tokenRegistryAddress: "env" | "cli" | "default" | "unset";
    timeoutMs: "env" | "cli" | "default";
    maxConcurrency: "env" | "cli" | "default";
    maxOutputBytes: "env" | "cli" | "default";
  };
}

export interface CliOptions {
  network?: Network | undefined;
  hubAddress?: string | undefined;
  tokenRegistryAddress?: string | undefined;
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
  config: RuntimeConfig;
  requestId: string;
  toolName: string;
  startedAt: number;
  retryCount: number;
}
