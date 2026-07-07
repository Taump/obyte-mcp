import { describe, expect, it, vi } from "vitest";
import { buildRuntimeConfig } from "../src/config.js";
import { ObyteHttpClient, toClientConfig } from "../src/obyteClient.js";
import { registerObyteTools } from "../src/tools.js";
import type { CliOptions, Network, RuntimeConfig } from "../src/types.js";

/**
 * These tests prove the routing promise of the server: a single instance serves
 * both mainnet and testnet, and each tool call reaches the hub of the network
 * resolved from the request (or the default network when `network` is omitted).
 */

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ text: string }> }>;

function makeHarness(config: RuntimeConfig, fetchImpl: typeof fetch) {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }
  } as any;
  const clients: Record<Network, ObyteHttpClient> = {
    mainnet: new ObyteHttpClient(toClientConfig(config, "mainnet"), fetchImpl),
    testnet: new ObyteHttpClient(toClientConfig(config, "testnet"), fetchImpl)
  };
  registerObyteTools(server, clients, config);

  async function call(name: string, args: unknown): Promise<any> {
    const handler = tools.get(name);
    if (!handler) throw new Error(`tool ${name} not registered`);
    const result = await handler(args);
    return JSON.parse(result.content[0]!.text);
  }

  return { call };
}

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ data: 1 }), { status: 200 })) as unknown as typeof fetch;
}

function lastUrl(fetchMock: any): string {
  return fetchMock.mock.calls.at(-1)[0] as string;
}

describe("network routing", () => {
  it("sends the request to the hub of the network named in the call", async () => {
    const fetchMock = okFetch();
    const { call } = makeHarness(buildRuntimeConfig({}, {}), fetchMock);

    const testnet = await call("obyte_get_last_mci", { network: "testnet" });
    expect(lastUrl(fetchMock)).toBe("https://testnet.obyte.org/api/get_last_mci");
    expect(testnet.meta.network).toBe("testnet");
    expect(testnet.meta.hub).toBe("https://testnet.obyte.org/api");

    const mainnet = await call("obyte_get_balances", { network: "mainnet", addresses: ["ADDR"] });
    expect(lastUrl(fetchMock)).toBe("https://obyte.org/api/get_balances");
    expect(mainnet.meta.network).toBe("mainnet");
    expect(mainnet.meta.hub).toBe("https://obyte.org/api");
  });

  it("uses the default network (mainnet) when the call omits network", async () => {
    const fetchMock = okFetch();
    const { call } = makeHarness(buildRuntimeConfig({}, {}), fetchMock);

    const result = await call("obyte_get_last_mci", {});
    expect(lastUrl(fetchMock)).toBe("https://obyte.org/api/get_last_mci");
    expect(result.meta.network).toBe("mainnet");
  });

  it("honors a testnet default network for calls that omit network, but still routes explicit mainnet calls to mainnet", async () => {
    const fetchMock = okFetch();
    const cli: CliOptions = { network: "testnet" };
    const { call } = makeHarness(buildRuntimeConfig({}, cli), fetchMock);

    const omitted = await call("obyte_get_last_mci", {});
    expect(lastUrl(fetchMock)).toBe("https://testnet.obyte.org/api/get_last_mci");
    expect(omitted.meta.network).toBe("testnet");

    const explicitMainnet = await call("obyte_get_last_mci", { network: "mainnet" });
    expect(lastUrl(fetchMock)).toBe("https://obyte.org/api/get_last_mci");
    expect(explicitMainnet.meta.network).toBe("mainnet");
  });

  it("routes to a per-network custom hub override", async () => {
    const fetchMock = okFetch();
    const config = buildRuntimeConfig({ OBYTE_TESTNET_HUB_ADDRESS: "https://my-testnet.example/api" }, {});
    const { call } = makeHarness(config, fetchMock);

    const result = await call("obyte_get_peers", { network: "testnet" });
    expect(lastUrl(fetchMock)).toBe("https://my-testnet.example/api/get_peers");
    expect(result.meta.hub).toBe("https://my-testnet.example/api");
    // mainnet stays on its default hub
    await call("obyte_get_peers", { network: "mainnet" });
    expect(lastUrl(fetchMock)).toBe("https://obyte.org/api/get_peers");
  });
});
