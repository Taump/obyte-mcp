import { describe, expect, it } from "vitest";
import { buildRuntimeConfig, normalizeHubAddress } from "../src/config.js";

describe("config", () => {
  it("exposes both networks with mainnet default", () => {
    const config = buildRuntimeConfig({}, {});
    expect(config.defaultNetwork).toBe("mainnet");
    expect(config.networks.mainnet.hubAddress).toBe("https://obyte.org/api");
    expect(config.networks.mainnet.tokenRegistryAddress).toBe("O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ");
    expect(config.networks.testnet.hubAddress).toBe("https://testnet.obyte.org/api");
    expect(config.networks.testnet.tokenRegistryAddress).toBeUndefined();
  });

  it("keeps both networks available when default is testnet", () => {
    const config = buildRuntimeConfig({}, { network: "testnet" });
    expect(config.defaultNetwork).toBe("testnet");
    expect(config.networks.testnet.hubAddress).toBe("https://testnet.obyte.org/api");
    // mainnet stays reachable with its built-in defaults
    expect(config.networks.mainnet.hubAddress).toBe("https://obyte.org/api");
    expect(config.networks.mainnet.tokenRegistryAddress).toBe("O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ");
  });

  it("gives env precedence over cli for the default network", () => {
    const config = buildRuntimeConfig(
      { OBYTE_NETWORK: "testnet", OBYTE_HUB_ADDRESS: "https://env.example/api" },
      { network: "mainnet", hubAddress: "https://cli.example/api" }
    );
    expect(config.defaultNetwork).toBe("testnet");
    expect(config.defaultNetworkSource).toBe("env");
    // plain hub override applies to the default network (testnet here)
    expect(config.networks.testnet.hubAddress).toBe("https://env.example/api");
    expect(config.networks.testnet.hubSource).toBe("env");
  });

  it("applies plain overrides only to the default network", () => {
    const config = buildRuntimeConfig({}, { network: "testnet", tokenRegistryAddress: "TESTREG123" });
    expect(config.networks.testnet.tokenRegistryAddress).toBe("TESTREG123");
    // mainnet is unaffected and keeps its default registry
    expect(config.networks.mainnet.tokenRegistryAddress).toBe("O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ");
  });

  it("supports per-network overrides regardless of default", () => {
    const config = buildRuntimeConfig(
      { OBYTE_TESTNET_TOKEN_REGISTRY_ADDRESS: "TNREG", OBYTE_MAINNET_HUB_ADDRESS: "https://mhub.example/api" },
      {}
    );
    expect(config.networks.testnet.tokenRegistryAddress).toBe("TNREG");
    expect(config.networks.testnet.tokenRegistrySource).toBe("env");
    expect(config.networks.mainnet.hubAddress).toBe("https://mhub.example/api");
    expect(config.networks.mainnet.hubSource).toBe("env");
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
