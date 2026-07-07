import { describe, expect, it } from "vitest";
import {
  getAssetBySymbol,
  getDecimalsBySymbolOrAsset,
  getOfficialTokenRegistryAddress,
  getSymbolByAsset,
  resolveAsset
} from "../src/symbols.js";

describe("symbols", () => {
  const client = {
    async getAaStateVars(_address: string, prefix?: string) {
      const values: Record<string, unknown> = {
        a2s_ASSET123456789012345678901234567890123456789: "TOK",
        s2a_TOK: "ASSET123456789012345678901234567890123456789",
        current_desc_ASSET123456789012345678901234567890123456789: "DESC",
        decimals_DESC: 4
      };
      return prefix ? Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(prefix))) : values;
    }
  };

  it("returns default registry", () => {
    expect(getOfficialTokenRegistryAddress()).toBe("O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ");
  });

  it("handles base aliases", async () => {
    await expect(getSymbolByAsset(client, "base")).resolves.toBe("GBYTE");
    await expect(getAssetBySymbol(client, "GBYTE", { configuredRegistryAddress: "REG" })).resolves.toBe("base");
    await expect(getDecimalsBySymbolOrAsset(client, "GBYTE", { configuredRegistryAddress: "REG" })).resolves.toBe(9);
    await expect(getDecimalsBySymbolOrAsset(client, "MBYTE", { configuredRegistryAddress: "REG" })).resolves.toBe(6);
    await expect(getDecimalsBySymbolOrAsset(client, "KBYTE", { configuredRegistryAddress: "REG" })).resolves.toBe(3);
    await expect(getDecimalsBySymbolOrAsset(client, "BYTE", { configuredRegistryAddress: "REG" })).resolves.toBe(0);
  });

  it("resolves registry mappings", async () => {
    await expect(
      getSymbolByAsset(client, "ASSET123456789012345678901234567890123456789", { configuredRegistryAddress: "REG" })
    ).resolves.toBe("TOK");
    await expect(getAssetBySymbol(client, "TOK", { configuredRegistryAddress: "REG" })).resolves.toBe(
      "ASSET123456789012345678901234567890123456789"
    );
    await expect(getDecimalsBySymbolOrAsset(client, "TOK", { configuredRegistryAddress: "REG" })).resolves.toBe(4);
  });

  it("requires a registry for non-base symbols", async () => {
    await expect(getAssetBySymbol(client, "TOK")).rejects.toThrow(/Token registry address/);
  });

  it("returns base alias decimals without any registry", async () => {
    // Regression: base aliases must work on testnet where no registry is configured.
    await expect(getDecimalsBySymbolOrAsset(client, "GBYTE")).resolves.toBe(9);
    await expect(getDecimalsBySymbolOrAsset(client, "base")).resolves.toBe(9);
    await expect(getDecimalsBySymbolOrAsset(client, "BYTE")).resolves.toBe(0);
  });

  it("resolves asset composite", async () => {
    await expect(resolveAsset(client, "TOK", { configuredRegistryAddress: "REG" })).resolves.toMatchObject({
      input: "TOK",
      asset: "ASSET123456789012345678901234567890123456789",
      decimals: 4
    });
  });
});
