import { describe, expect, it, vi } from "vitest";
import { buildRuntimeConfig } from "../src/config.js";
import { PACKAGE_VERSION } from "../src/constants.js";
import { ObyteHttpClient } from "../src/obyteClient.js";

describe("ObyteHttpClient", () => {
  it("posts to hub and unwraps data", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: 123 }), { status: 200 }));
    const client = new ObyteHttpClient(buildRuntimeConfig({}, {}), fetchMock as any);
    await expect(client.getLastMci()).resolves.toBe(123);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://obyte.org/api/get_last_mci",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({ "User-Agent": `obyte-mcp/${PACKAGE_VERSION}` })
      })
    );
  });

  it("retries read requests but not dry runs", async () => {
    const readFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
    const readClient = new ObyteHttpClient(buildRuntimeConfig({}, { timeoutMs: 1000 }), readFetch as any);
    await expect(readClient.getLastMci()).resolves.toBe("ok");
    expect(readFetch).toHaveBeenCalledTimes(2);

    const dryRunFetch = vi.fn(async () => new Response("bad", { status: 500 }));
    const dryRunClient = new ObyteHttpClient(buildRuntimeConfig({}, { timeoutMs: 1000 }), dryRunFetch as any);
    await expect(dryRunClient.dryRunAa("AA", {})).rejects.toThrow(/unknown error/);
    expect(dryRunFetch).toHaveBeenCalledTimes(1);
  });

  it("caches witnesses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: ["W1"] }), { status: 200 }));
    const client = new ObyteHttpClient(buildRuntimeConfig({}, {}), fetchMock as any);
    await expect(client.getWitnesses()).resolves.toEqual(["W1"]);
    await expect(client.getWitnesses()).resolves.toEqual(["W1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getWitnessesCacheInfo().hasValue).toBe(true);
  });
});
