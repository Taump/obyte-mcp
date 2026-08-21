import { describe, expect, it, vi } from "vitest";
import { decodeNuxtPayload, fetchAssetHolders } from "../src/explorerClient.js";

/** Builds a devalue-style payload mirroring the real explorer response. */
function tokenPayload(): unknown[] {
  // indices:            0            1                      2                3
  return [
    { data: 1, prerenderedAt: -1 },
    ["ShallowReactive", 2],
    { "asset:TOK": 3 },
    { assetUnit: 4, name: 5, decimals: 6, holders: 7, supply: 14, endHolders: 15 },
    "TOK", // 4
    "TOK", // 5
    4, // 6 decimals
    [8, 11], // 7 holders
    { address: 9, asset: 10, balance: 16 }, // 8
    "HOLDER1ADDRESS1234567890ABCDEFGH", // 9
    "ASSETID+BASE64/CHARS=", // 10
    { address: 12, asset: 10, balance: 17 }, // 11
    "HOLDER2ADDRESS1234567890ABCDEFGH", // 12
    null, // 13 (unused)
    130833063, // 14 supply
    true, // 15 endHolders
    100000000, // 16 balance 1
    30833063 // 17 balance 2
  ];
}

function notFoundPayload(): unknown[] {
  return [{ data: 1 }, ["ShallowReactive", 2], { "asset:NOPE": 3 }, { notFound: 4, testnet: 5 }, true, false];
}

function fetchReturning(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
}

describe("decodeNuxtPayload", () => {
  it("resolves references, wrappers, and negative sentinels", () => {
    const decoded = decodeNuxtPayload(tokenPayload()) as any;
    expect(decoded.prerenderedAt).toBeUndefined();
    expect(decoded.data["asset:TOK"].decimals).toBe(4);
    expect(decoded.data["asset:TOK"].holders).toHaveLength(2);
    expect(decoded.data["asset:TOK"].holders[0].address).toBe("HOLDER1ADDRESS1234567890ABCDEFGH");
  });

  it("rejects non-array payloads", () => {
    expect(() => decodeNuxtPayload({})).toThrow(/Nuxt data array/);
  });
});

describe("fetchAssetHolders", () => {
  it("returns holders with display balances for a registered token", async () => {
    const fetchMock = fetchReturning(tokenPayload());
    const result = await fetchAssetHolders({ network: "mainnet", value: "TOK", limit: 20, timeoutMs: 5000, fetchImpl: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith("https://explorer.obyte.org/asset/TOK/_payload.json", expect.anything());
    expect(result.name).toBe("TOK");
    expect(result.decimals).toBe(4);
    expect(result.asset).toBe("ASSETID+BASE64/CHARS=");
    expect(result.supply_display).toBe("13083.3063");
    expect(result.holders).toEqual([
      { address: "HOLDER1ADDRESS1234567890ABCDEFGH", raw_balance: 100000000, display_balance: "10000" },
      { address: "HOLDER2ADDRESS1234567890ABCDEFGH", raw_balance: 30833063, display_balance: "3083.3063" }
    ]);
    expect(result.more_holders_available).toBe(false);
    expect(result.explorer_asset_url).toBe("https://explorer.obyte.org/asset/TOK");
  });

  it("applies the limit and flags more holders", async () => {
    const result = await fetchAssetHolders({
      network: "mainnet",
      value: "TOK",
      limit: 1,
      timeoutMs: 5000,
      fetchImpl: fetchReturning(tokenPayload())
    });
    expect(result.holders_returned).toBe(1);
    expect(result.more_holders_available).toBe(true);
  });

  it("maps base aliases to GBYTE with 9 decimals on the right explorer", async () => {
    const payload = tokenPayload();
    (payload[3] as Record<string, unknown>).assetUnit = 4;
    (payload as unknown[])[4] = "bytes";
    const fetchMock = fetchReturning(payload);
    const result = await fetchAssetHolders({ network: "testnet", value: "base", limit: 5, timeoutMs: 5000, fetchImpl: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith("https://testnetexplorer.obyte.org/asset/GBYTE/_payload.json", expect.anything());
    expect(result.name).toBe("GBYTE");
    expect(result.decimals).toBe(9);
    expect(result.holders[0]!.display_balance).toBe("0.1");
  });

  it("throws HUB_ERROR for unknown assets", async () => {
    await expect(
      fetchAssetHolders({ network: "mainnet", value: "NOPE", limit: 20, timeoutMs: 5000, fetchImpl: fetchReturning(notFoundPayload()) })
    ).rejects.toThrow(/not found on the mainnet explorer/);
  });

  it("throws NETWORK_ERROR on http failures", async () => {
    const failing = vi.fn(async () => new Response("oops", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchAssetHolders({ network: "mainnet", value: "TOK", limit: 20, timeoutMs: 5000, fetchImpl: failing })).rejects.toThrow(
      /HTTP 502/
    );
  });
  it("matches the requested asset case-insensitively when the explorer normalizes the key", async () => {
    const payload = tokenPayload();
    // Two asset entries, so a blind "first asset entry" pick would be wrong.
    (payload[2] as Record<string, unknown>) = { "asset:OTHER": 18, "asset:TOK": 3 };
    (payload as unknown[])[18] = { name: 19, decimals: 6, holders: 7, supply: 14, endHolders: 15 };
    (payload as unknown[])[19] = "OTHER";
    const result = await fetchAssetHolders({
      network: "mainnet",
      value: "tok",
      limit: 20,
      timeoutMs: 5000,
      fetchImpl: fetchReturning(payload)
    });
    expect(result.name).toBe("TOK");
  });

  it("refuses to answer with another asset when the requested one is absent", async () => {
    // Regression: the payload used to fall through to whatever asset came first,
    // silently returning a different token's holders.
    const payload = tokenPayload();
    (payload[2] as Record<string, unknown>) = { "asset:OTHER": 3, "asset:SECOND": 3 };
    await expect(
      fetchAssetHolders({ network: "mainnet", value: "TOK", limit: 20, timeoutMs: 5000, fetchImpl: fetchReturning(payload) })
    ).rejects.toThrow(/did not contain the requested asset/);
  });
});
