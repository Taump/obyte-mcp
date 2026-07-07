import { describe, expect, it } from "vitest";
import { buildRuntimeConfig, normalizeHubAddress } from "../src/config.js";

describe("config", () => {
  it("uses mainnet defaults", () => {
    const config = buildRuntimeConfig({}, {});
    expect(config.network).toBe("mainnet");
    expect(config.hubAddress).toBe("https://obyte.org/api");
    expect(config.tokenRegistryAddress).toBe("O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ");
  });

  it("uses testnet defaults", () => {
    const config = buildRuntimeConfig({}, { network: "testnet" });
    expect(config.network).toBe("testnet");
    expect(config.hubAddress).toBe("https://testnet.obyte.org/api");
    expect(config.tokenRegistryAddress).toBeUndefined();
  });

  it("gives env precedence over cli", () => {
    const config = buildRuntimeConfig(
      { OBYTE_NETWORK: "testnet", OBYTE_HUB_ADDRESS: "https://env.example/api" },
      { network: "mainnet", hubAddress: "https://cli.example/api" }
    );
    expect(config.network).toBe("testnet");
    expect(config.hubAddress).toBe("https://env.example/api");
    expect(config.source.network).toBe("env");
    expect(config.source.hubAddress).toBe("env");
  });

  it("allows https and localhost http hubs", () => {
    expect(normalizeHubAddress("https://example.org/api/")).toBe("https://example.org/api");
    expect(normalizeHubAddress("http://localhost:6611/api/")).toBe("http://localhost:6611/api");
    expect(normalizeHubAddress("http://127.0.0.1:6611/api")).toBe("http://127.0.0.1:6611/api");
  });

  it("rejects unsafe hub URLs", () => {
    expect(() => normalizeHubAddress("http://example.org/api")).toThrow(/https/);
    expect(() => normalizeHubAddress("ftp://example.org/api")).toThrow(/https/);
    expect(() => normalizeHubAddress("https://user:pass@example.org/api")).toThrow(/credentials/);
  });
});
