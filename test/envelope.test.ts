import { describe, expect, it } from "vitest";
import { createToolContext, envelopeToText, successEnvelope } from "../src/envelope.js";
import { buildRuntimeConfig } from "../src/config.js";

describe("envelope", () => {
  it("adds stable meta", () => {
    const config = buildRuntimeConfig({}, {});
    const envelope = successEnvelope(createToolContext(config, "obyte_get_last_mci"), 123);
    expect(envelope.ok).toBe(true);
    expect(envelope.meta.network).toBe("mainnet");
    expect(envelope.meta.hub).toBe("https://obyte.org/api");
    expect(envelope.meta.tool).toBe("obyte_get_last_mci");
  });

  it("truncates large data without truncating meta", () => {
    const config = buildRuntimeConfig({}, {});
    const envelope = successEnvelope(createToolContext(config, "obyte_get_joint"), {
      value: "x".repeat(50_000)
    });
    const text = envelopeToText(envelope, 16_384);
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.meta.output_bytes_before_truncation).toBeGreaterThan(16_384);
    expect(parsed.data.value).toContain("[truncated]");
  });
});
