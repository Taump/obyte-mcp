import { describe, expect, it } from "vitest";
import { assetExplorerUrl, collectAssetTotals, formatAmount, summarizeBalanceAmounts } from "../src/amounts.js";

const ASSET = "ASSET123456789012345678901234567890123456789";

const registryReader = {
  async getAaStateVars(_address: string, prefix?: string) {
    const values: Record<string, unknown> = {
      [`a2s_${ASSET}`]: "TOK",
      [`current_desc_${ASSET}`]: "DESC",
      decimals_DESC: 4
    };
    return prefix ? Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(prefix))) : values;
  }
};

describe("formatAmount", () => {
  it("divides by 10^decimals without float artifacts", () => {
    expect(formatAmount(2_500_000_000, 9)).toBe("2.5");
    expect(formatAmount(1, 9)).toBe("0.000000001");
    expect(formatAmount(130833063, 8)).toBe("1.30833063");
    expect(formatAmount(1_000_000_000, 9)).toBe("1");
    expect(formatAmount(-1_500_000_000, 9)).toBe("-1.5");
    expect(formatAmount(42, 0)).toBe("42");
  });

  it("rejects invalid input", () => {
    expect(formatAmount(Number.NaN, 9)).toBeNull();
    expect(formatAmount(1, -1)).toBeNull();
    expect(formatAmount(1, 1.5)).toBeNull();
  });
});

describe("collectAssetTotals", () => {
  it("sums get_balances shape across addresses", () => {
    const totals = collectAssetTotals({
      ADDR1: { base: { stable: 1_000, pending: 500 }, [ASSET]: { stable: 20, pending: 0 } },
      ADDR2: { base: { stable: 2_000, pending: 0 } }
    });
    expect(totals).toEqual({ base: 3_500, [ASSET]: 20 });
  });

  it("reads flat AA balances shape", () => {
    expect(collectAssetTotals({ base: 123, [ASSET]: 7 })).toEqual({ base: 123, [ASSET]: 7 });
  });
});

describe("summarizeBalanceAmounts", () => {
  it("always resolves base to GBYTE with 9 decimals and no registry calls", async () => {
    const failingReader = {
      async getAaStateVars(): Promise<unknown> {
        throw new Error("must not be called for base-only balances");
      }
    };
    const summary = await summarizeBalanceAmounts(failingReader, { ADDR: { base: { stable: 2_500_000_000, pending: 0 } } });
    expect(summary.totals_by_asset.base).toMatchObject({
      symbol: "GBYTE",
      decimals: 9,
      raw_total: 2_500_000_000,
      display_total: "2.5"
    });
    expect(summary.unresolved_assets).toBeUndefined();
  });

  it("resolves custom assets through the registry with display totals and explorer urls", async () => {
    const summary = await summarizeBalanceAmounts(
      registryReader,
      { ADDR: { [ASSET]: { stable: 130833063, pending: 0 } } },
      { configuredRegistryAddress: "REG", network: "mainnet" }
    );
    expect(summary.totals_by_asset[ASSET]).toMatchObject({
      symbol: "TOK",
      decimals: 4,
      display_total: "13083.3063",
      explorer_asset_url: "https://explorer.obyte.org/asset/TOK"
    });
  });

  it("degrades to unresolved when no registry is configured", async () => {
    const summary = await summarizeBalanceAmounts(registryReader, { ADDR: { [ASSET]: { stable: 5, pending: 0 } } }, { network: "testnet" });
    expect(summary.totals_by_asset[ASSET]).toMatchObject({ decimals: null, display_total: null });
    expect(summary.unresolved_assets).toEqual([ASSET]);
    // unresolved assets link by asset id, not by the prefix fallback pseudo-symbol
    expect(summary.totals_by_asset[ASSET]!.explorer_asset_url).toBe(
      `https://testnetexplorer.obyte.org/asset/${encodeURIComponent(ASSET)}`
    );
  });
});

describe("assetExplorerUrl", () => {
  it("targets the right explorer per network and encodes asset ids", () => {
    expect(assetExplorerUrl("mainnet", "GBYTE")).toBe("https://explorer.obyte.org/asset/GBYTE");
    expect(assetExplorerUrl("testnet", "n9y3vomFUDgpm7wgYSMEcGTKxx0BUCoYnfF4B1Uk+n0=")).toBe(
      `https://testnetexplorer.obyte.org/asset/${encodeURIComponent("n9y3vomFUDgpm7wgYSMEcGTKxx0BUCoYnfF4B1Uk+n0=")}`
    );
  });
});
