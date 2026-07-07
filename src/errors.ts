import type { ErrorCode } from "./types.js";

export class ObyteMcpError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ObyteMcpError";
    this.code = code;
    this.details = details;
  }
}

export function toObyteMcpError(error: unknown): ObyteMcpError {
  if (error instanceof ObyteMcpError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new ObyteMcpError("TIMEOUT", "Hub request timed out");
    }
    return new ObyteMcpError("INTERNAL_ERROR", error.message);
  }
  return new ObyteMcpError("INTERNAL_ERROR", "Unknown internal error");
}
