import { describe, expect, it } from "vitest";
import { createToolContext, envelopeToText, successEnvelope } from "../src/envelope.js";
import { buildRuntimeConfig, envelopeConfig } from "../src/config.js";

describe("envelope", () => {
  it("adds stable meta for the resolved network", () => {
    const config = buildRuntimeConfig({}, {});
    const envelope = successEnvelope(createToolContext(envelopeConfig(config, "mainnet"), "obyte_get_last_mci"), 123);
    expect(envelope.ok).toBe(true);
    expect(envelope.meta.network).toBe("mainnet");
    expect(envelope.meta.hub).toBe("https://obyte.org/api");
    expect(envelope.meta.tool).toBe("obyte_get_last_mci");
  });

  it("reflects testnet in meta when testnet is resolved", () => {
    const config = buildRuntimeConfig({}, {});
    const envelope = successEnvelope(createToolContext(envelopeConfig(config, "testnet"), "obyte_get_last_mci"), 1);
    expect(envelope.meta.network).toBe("testnet");
    expect(envelope.meta.hub).toBe("https://testnet.obyte.org/api");
  });

  it("truncates large data without truncating meta", () => {
    const config = buildRuntimeConfig({}, {});
    const envelope = successEnvelope(createToolContext(envelopeConfig(config, "mainnet"), "obyte_get_joint"), {
      value: "x".repeat(50_000)
    });
    const text = envelopeToText(envelope, 16_384);
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.meta.output_bytes_before_truncation).toBeGreaterThan(16_384);
    expect(parsed.data.value).toContain("[truncated]");
  });
  it("truncates large maps to a bounded marker instead of listing every omitted key", () => {
    const config = buildRuntimeConfig({}, {});
    const stateVars: Record<string, string> = {};
    for (let index = 0; index < 8_000; index += 1) stateVars[`pool_${index}_supply_of_something_long`] = "1234567890123456789";
    const envelope = successEnvelope(createToolContext(envelopeConfig(config, "mainnet"), "obyte_get_aa_state_vars"), stateVars);

    const started = Date.now();
    const text = envelopeToText(envelope, 262_144);
    const elapsed = Date.now() - started;

    const parsed = JSON.parse(text);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(262_144);
    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.data.pool_0_supply_of_something_long).toBe("1234567890123456789");
    expect(parsed.data.__truncated_keys__.omitted_keys).toBeGreaterThan(0);
    expect(parsed.data.__truncated_keys__.first_omitted_keys.length).toBeLessThanOrEqual(10);
    // Regression: sizing every candidate from scratch made this take seconds.
    expect(elapsed).toBeLessThan(500);
  });

  it("marks omitted array items and stays within the limit", () => {
    const config = buildRuntimeConfig({}, {});
    const joints = Array.from({ length: 2_000 }, (_, index) => ({ unit: `${"u".repeat(43)}${index}`, timestamp: 1_700_000_000 + index }));
    const envelope = successEnvelope(createToolContext(envelopeConfig(config, "mainnet"), "obyte_get_history"), { joints });

    const text = envelopeToText(envelope, 16_384);
    const parsed = JSON.parse(text);

    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(16_384);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.data.joints[0].unit).toContain("u");
    expect(parsed.data.joints.at(-1)).toMatchObject({ __truncated__: true });
    expect(parsed.data.joints.at(-1).omitted_items).toBeGreaterThan(0);
  });

  it("reports output_bytes_after_truncation as the real size", () => {
    const config = buildRuntimeConfig({}, {});
    const envelope = successEnvelope(createToolContext(envelopeConfig(config, "mainnet"), "obyte_get_joint"), {
      value: "x".repeat(80_000)
    });
    const text = envelopeToText(envelope, 16_384);
    const parsed = JSON.parse(text);
    expect(parsed.meta.output_bytes_after_truncation).toBeLessThanOrEqual(16_384);
    expect(Math.abs(Buffer.byteLength(text, "utf8") - parsed.meta.output_bytes_after_truncation)).toBeLessThan(128);
  });
});
