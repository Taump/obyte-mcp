import { randomUUID } from "node:crypto";
import { ObyteMcpError, toObyteMcpError } from "./errors.js";
import { sortKnownMapOutputs } from "./jsonUtils.js";
import type { RuntimeConfig, ToolEnvelope, ToolExecutionContext } from "./types.js";

export function createToolContext(config: RuntimeConfig, toolName: string): ToolExecutionContext {
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

export function envelopeToText(envelope: ToolEnvelope, maxOutputBytes: number): string {
  const serialized = JSON.stringify(envelope, null, 2);
  const initialBytes = Buffer.byteLength(serialized, "utf8");
  if (initialBytes <= maxOutputBytes) return serialized;

  if (!envelope.ok) {
    return JSON.stringify(outputTooLargeEnvelope(envelope, initialBytes, maxOutputBytes), null, 2);
  }

  const truncated = structuredClone(envelope) as ToolEnvelope;
  if (!truncated.ok) return JSON.stringify(outputTooLargeEnvelope(envelope, initialBytes, maxOutputBytes), null, 2);

  truncated.meta.truncated = true;
  truncated.meta.output_bytes_before_truncation = initialBytes;
  truncated.meta.truncation_reason = "response exceeded OBYTE_MAX_OUTPUT_BYTES";
  truncated.data = truncateValue(truncated.data, Math.max(1024, Math.floor(maxOutputBytes * 0.7)));

  let text = JSON.stringify(truncated, null, 2);
  let bytes = Buffer.byteLength(text, "utf8");
  while (bytes > maxOutputBytes && truncated.ok) {
    truncated.data = truncateValue(truncated.data, Math.max(256, Math.floor(maxOutputBytes * 0.45)));
    text = JSON.stringify(truncated, null, 2);
    bytes = Buffer.byteLength(text, "utf8");
    if (isTerminalTruncation(truncated.data)) break;
  }

  if (bytes > maxOutputBytes) {
    return JSON.stringify(outputTooLargeEnvelope(envelope, initialBytes, maxOutputBytes), null, 2);
  }

  if (truncated.ok) truncated.meta.output_bytes_after_truncation = bytes;
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

function truncateValue(value: unknown, budgetBytes: number): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateString(value, budgetBytes);
  if (Array.isArray(value)) return truncateArray(value, budgetBytes);
  if (typeof value === "object") return truncateObject(value as Record<string, unknown>, budgetBytes);
  return String(value);
}

function truncateArray(value: unknown[], budgetBytes: number): unknown[] {
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let childBudget = Math.floor(budgetBytes / Math.max(1, value.length));
    let child = truncateValue(value[index], childBudget);
    let candidate = [...result, child];
    while (Buffer.byteLength(JSON.stringify(candidate), "utf8") > budgetBytes && childBudget > 128) {
      childBudget = Math.floor(childBudget * 0.7);
      child = truncateValue(value[index], childBudget);
      candidate = [...result, child];
    }
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > budgetBytes) {
      result.push({ __truncated__: true, omitted_items: value.length - index });
      return result;
    }
    result.push(candidate[candidate.length - 1]);
  }
  return result;
}

function truncateObject(value: Record<string, unknown>, budgetBytes: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (let index = 0; index < entries.length; index += 1) {
    const [key, child] = entries[index]!;
    let childBudget = Math.floor(budgetBytes / Math.max(1, entries.length));
    let truncatedChild = truncateValue(child, childBudget);
    let candidate = {
      ...result,
      [key]: truncatedChild
    };
    while (Buffer.byteLength(JSON.stringify(candidate), "utf8") > budgetBytes && childBudget > 128) {
      childBudget = Math.floor(childBudget * 0.7);
      truncatedChild = truncateValue(child, childBudget);
      candidate = {
        ...result,
        [key]: truncatedChild
      };
    }
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > budgetBytes) {
      result.__truncated_keys__ = entries.slice(index).map(([entryKey]) => entryKey);
      return result;
    }
    result[key] = candidate[key];
  }
  return result;
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

function isTerminalTruncation(value: unknown): boolean {
  return typeof value === "string" || value === null || typeof value !== "object";
}

export async function executeEnvelope<T>(
  config: RuntimeConfig,
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
    const envelope = error instanceof ObyteMcpError ? errorEnvelope(context, error) : errorEnvelope(context, error);
    return envelopeToText(envelope, config.maxOutputBytes);
  }
}
