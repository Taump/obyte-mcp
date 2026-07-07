import { ObyteMcpError } from "./errors.js";
import { MAX_JSON_PAYLOAD_BYTES } from "./constants.js";

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function assertJsonSize(value: unknown, maxBytes = MAX_JSON_PAYLOAD_BYTES): void {
  const bytes = jsonByteLength(value);
  if (bytes > maxBytes) {
    throw new ObyteMcpError("VALIDATION_ERROR", `JSON payload exceeds ${maxBytes} bytes`, { bytes, maxBytes });
  }
}

export function sortMapLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortMapLike);
  if (!isPlainObject(value)) return value;

  const entries = Object.entries(value as Record<string, unknown>);
  const sorted: Record<string, unknown> = {};
  for (const [key, child] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    sorted[key] = sortMapLike(child);
  }
  return sorted;
}

export function sortKnownMapOutputs(toolName: string, data: unknown): unknown {
  const mapLikeTools = new Set([
    "obyte_get_aa_state_vars",
    "obyte_get_balances",
    "obyte_get_aa_balances",
    "obyte_get_portfolio_summary"
  ]);
  return mapLikeTools.has(toolName) ? sortMapLike(data) : data;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function redactForError(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactForError);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/private|secret|seed|mnemonic|xprv|passphrase/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactForError(child);
    }
  }
  return result;
}
