import { PACKAGE_NAME } from "./constants.js";

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  event: string;
  message: string;
  request_id?: string;
  tool?: string;
  details?: unknown;
}

export function writeDiagnostic(diagnostic: DiagnosticEvent): void {
  const line = {
    ts: new Date().toISOString(),
    package: PACKAGE_NAME,
    level: diagnostic.level,
    event: diagnostic.event,
    request_id: diagnostic.request_id,
    tool: diagnostic.tool,
    message: diagnostic.message,
    details: redactDiagnostics(diagnostic.details)
  };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

function redactDiagnostics(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactDiagnostics);

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/private|secret|seed|mnemonic|passphrase|xprv/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactDiagnostics(child);
    }
  }
  return result;
}
