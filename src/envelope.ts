import { randomUUID } from "node:crypto";
import { ObyteMcpError, toObyteMcpError } from "./errors.js";
import { sortKnownMapOutputs } from "./jsonUtils.js";
import type { EnvelopeConfig, SuccessEnvelope, ToolEnvelope, ToolExecutionContext } from "./types.js";

export function createToolContext(config: EnvelopeConfig, toolName: string): ToolExecutionContext {
  return {
    config,
    requestId: randomUUID(),
    toolName,
    startedAt: Date.now(),
    retryCount: 0
  };
}

export function successEnvelope(context: ToolExecutionContext, data: unknown): ToolEnvelope {
  return {
    ok: true,
    meta: {
      network: context.config.network,
      hub: context.config.hubAddress,
      tool: context.toolName,
      request_id: context.requestId,
      duration_ms: Date.now() - context.startedAt,
      retry_count: context.retryCount,
      truncated: false
    },
    data: sortKnownMapOutputs(context.toolName, data)
  };
}

export function errorEnvelope(context: ToolExecutionContext, error: unknown): ToolEnvelope {
  const normalized = toObyteMcpError(error);
  return {
    ok: false,
    meta: {
      network: context.config.network,
      hub: context.config.hubAddress,
      tool: context.toolName,
      request_id: context.requestId,
      duration_ms: Date.now() - context.startedAt,
      retry_count: context.retryCount,
      truncated: false
    },
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details
    }
  };
}

/** Attempts to fit `data` into the limit, halving the budget each round. */
const MAX_TRUNCATION_ATTEMPTS = 8;
/** Slack for the `output_bytes_after_truncation` field added after measuring. */
const META_SLACK_BYTES = 128;

export function envelopeToText(envelope: ToolEnvelope, maxOutputBytes: number): string {
  const serialized = JSON.stringify(envelope, null, 2);
  const initialBytes = Buffer.byteLength(serialized, "utf8");
  if (initialBytes <= maxOutputBytes) return serialized;

  if (!envelope.ok) {
    return JSON.stringify(outputTooLargeEnvelope(envelope, initialBytes, maxOutputBytes), null, 2);
  }

  const truncated: SuccessEnvelope = {
    ok: true,
    meta: {
      ...envelope.meta,
      truncated: true,
      output_bytes_before_truncation: initialBytes,
      output_bytes_after_truncation: initialBytes,
      truncation_reason: "response exceeded OBYTE_MAX_OUTPUT_BYTES"
    },
    data: null
  };

  // Budgets are measured on compact JSON while the envelope is emitted with
  // 2-space indentation, so each round retries from the original data with a
  // halved budget instead of re-truncating an already truncated value.
  let budget = Math.max(1024, Math.floor(maxOutputBytes * 0.7));
  let text = "";
  let bytes = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < MAX_TRUNCATION_ATTEMPTS; attempt += 1) {
    truncated.data = fitValue(envelope.data, budget).value;
    text = JSON.stringify(truncated, null, 2);
    bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= maxOutputBytes - META_SLACK_BYTES) break;
    budget = Math.floor(budget / 2);
    if (budget < 256) break;
  }

  if (bytes > maxOutputBytes - META_SLACK_BYTES) {
    return JSON.stringify(outputTooLargeEnvelope(envelope, initialBytes, maxOutputBytes), null, 2);
  }

  truncated.meta.output_bytes_after_truncation = bytes;
  return JSON.stringify(truncated, null, 2);
}

function outputTooLargeEnvelope(original: ToolEnvelope, initialBytes: number, maxOutputBytes: number): ToolEnvelope {
  return {
    ok: false,
    meta: {
      ...original.meta,
      truncated: false,
      output_bytes_before_truncation: initialBytes,
      truncation_reason: "response exceeded OBYTE_MAX_OUTPUT_BYTES and could not be safely truncated"
    },
    error: {
      code: "OUTPUT_TOO_LARGE",
      message: "Tool response exceeded configured output limit",
      details: { initialBytes, maxOutputBytes }
    }
  };
}

/**
 * A value that fits a byte budget, carried together with its serialized size so
 * callers never have to re-serialize it. Sizing every candidate from scratch is
 * what made truncation quadratic: a 300KB state-var map cost seconds of CPU.
 */
interface FittedValue {
  value: unknown;
  bytes: number;
}

/** Smallest budget worth handing to a child before giving up on it. */
const MIN_CHILD_BUDGET = 128;
/** Room kept for the `__truncated__` / `__truncated_keys__` marker. */
const MARKER_RESERVE_BYTES = 128;
/** Omitted keys are summarized, never listed in full: the list itself can be huge. */
const MAX_LISTED_OMITTED_KEYS = 10;

function jsonBytes(value: unknown): number {
  const text = JSON.stringify(value);
  return text === undefined ? 0 : Buffer.byteLength(text, "utf8");
}

function fitValue(value: unknown, budgetBytes: number): FittedValue {
  const bytes = jsonBytes(value);
  if (bytes <= budgetBytes) return { value, bytes };
  if (typeof value === "string") {
    // truncateString budgets raw UTF-8 bytes; serialization adds quotes and may
    // escape characters, so shrink until the serialized form really fits.
    let allowance = Math.max(0, budgetBytes - 2);
    let shortened = truncateString(value, allowance);
    let shortenedBytes = jsonBytes(shortened);
    while (shortenedBytes > budgetBytes && allowance > 16) {
      allowance = Math.floor(allowance / 2);
      shortened = truncateString(value, allowance);
      shortenedBytes = jsonBytes(shortened);
    }
    return { value: shortened, bytes: shortenedBytes };
  }
  if (Array.isArray(value)) return fitArray(value, budgetBytes);
  if (value !== null && typeof value === "object") return fitObject(value as Record<string, unknown>, budgetBytes);
  // Numbers, booleans and null are already minimal.
  return { value, bytes };
}

function fitArray(value: unknown[], budgetBytes: number): FittedValue {
  const result: unknown[] = [];
  let used = 2; // []

  for (let index = 0; index < value.length; index += 1) {
    const separator = result.length > 0 ? 1 : 0;
    const available = budgetBytes - used - separator - MARKER_RESERVE_BYTES;
    const share = Math.floor((budgetBytes - used) / (value.length - index));
    const childBudget = Math.min(available, Math.max(MIN_CHILD_BUDGET, share));
    if (childBudget < MIN_CHILD_BUDGET) return withOmittedItems(result, used, value.length - index);

    const child = fitValue(value[index], childBudget);
    if (used + separator + child.bytes > budgetBytes - MARKER_RESERVE_BYTES) {
      return withOmittedItems(result, used, value.length - index);
    }
    result.push(child.value);
    used += separator + child.bytes;
  }
  return { value: result, bytes: used };
}

function withOmittedItems(result: unknown[], used: number, omitted: number): FittedValue {
  const marker = { __truncated__: true, omitted_items: omitted };
  const separator = result.length > 0 ? 1 : 0;
  result.push(marker);
  return { value: result, bytes: used + separator + jsonBytes(marker) };
}

function fitObject(value: Record<string, unknown>, budgetBytes: number): FittedValue {
  const entries = Object.entries(value).filter(([, child]) => JSON.stringify(child) !== undefined);
  const result: Record<string, unknown> = {};
  let used = 2; // {}
  let kept = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const [key, child] = entries[index]!;
    // "key": plus a separating comma for every entry after the first.
    const keyCost = jsonBytes(key) + 1 + (kept > 0 ? 1 : 0);
    const available = budgetBytes - used - keyCost - MARKER_RESERVE_BYTES;
    const share = Math.floor((budgetBytes - used) / (entries.length - index));
    const childBudget = Math.min(available, Math.max(MIN_CHILD_BUDGET, share));
    if (childBudget < MIN_CHILD_BUDGET) return withOmittedKeys(result, used, entries.slice(index), kept);

    const fitted = fitValue(child, childBudget);
    if (used + keyCost + fitted.bytes > budgetBytes - MARKER_RESERVE_BYTES) {
      return withOmittedKeys(result, used, entries.slice(index), kept);
    }
    result[key] = fitted.value;
    used += keyCost + fitted.bytes;
    kept += 1;
  }
  return { value: result, bytes: used };
}

function withOmittedKeys(result: Record<string, unknown>, used: number, omitted: Array<[string, unknown]>, kept: number): FittedValue {
  const marker = {
    omitted_keys: omitted.length,
    first_omitted_keys: omitted.slice(0, MAX_LISTED_OMITTED_KEYS).map(([key]) => key)
  };
  result.__truncated_keys__ = marker;
  const keyCost = jsonBytes("__truncated_keys__") + 1 + (kept > 0 ? 1 : 0);
  return { value: result, bytes: used + keyCost + jsonBytes(marker) };
}

function truncateString(value: string, budgetBytes: number): string {
  const suffix = "...[truncated]";
  if (Buffer.byteLength(value, "utf8") <= budgetBytes) return value;
  const target = Math.max(0, budgetBytes - Buffer.byteLength(suffix, "utf8"));
  let current = "";
  for (const char of value) {
    if (Buffer.byteLength(current + char, "utf8") > target) break;
    current += char;
  }
  return current + suffix;
}

export async function executeEnvelope<T>(
  config: EnvelopeConfig,
  toolName: string,
  retryCounter: () => number,
  handler: (context: ToolExecutionContext) => Promise<T>
): Promise<string> {
  const beforeRetries = retryCounter();
  const context = createToolContext(config, toolName);
  try {
    const data = await handler(context);
    context.retryCount = retryCounter() - beforeRetries;
    return envelopeToText(successEnvelope(context, data), config.maxOutputBytes);
  } catch (error) {
    context.retryCount = retryCounter() - beforeRetries;
    return envelopeToText(errorEnvelope(context, error), config.maxOutputBytes);
  }
}
