import { BASE_DECIMALS, assetExplorerUrl, formatAmount } from "./amounts.js";
import { MAINNET_EXPLORER, TESTNET_EXPLORER } from "./constants.js";
import { ObyteMcpError } from "./errors.js";
import { isPlainObject } from "./jsonUtils.js";
import type { Network } from "./types.js";

/**
 * Reads top asset holders from the Obyte explorer's Nuxt payload endpoint
 * (/asset/<symbol|asset>/_payload.json). The explorer is a centralized
 * convenience service separate from the hub; treat its data accordingly.
 */

export interface AssetHolder {
  address: string;
  raw_balance: number;
  display_balance: string | null;
}

export interface AssetHoldersResult {
  input: string;
  network: Network;
  asset: string | null;
  name: string | null;
  decimals: number | null;
  supply_raw: number | null;
  supply_display: string | null;
  holders: AssetHolder[];
  holders_returned: number;
  more_holders_available: boolean;
  explorer_asset_url: string;
  source_note: string;
}

const SOURCE_NOTE =
  "Data from the Obyte explorer (a centralized convenience service, not the hub), sorted by balance descending and may lag the ledger slightly. raw amounts are smallest units; display values are already divided by 10^decimals.";

export interface FetchHoldersOptions {
  network: Network;
  value: string;
  limit: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAssetHolders(options: FetchHoldersOptions): Promise<AssetHoldersResult> {
  const value = normalizeAlias(options.value);
  const base = options.network === "testnet" ? TESTNET_EXPLORER : MAINNET_EXPLORER;
  const url = `${base}/asset/${encodeURIComponent(value)}/_payload.json`;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ObyteMcpError("TIMEOUT", `Explorer request timed out after ${options.timeoutMs}ms`, { url });
    }
    throw new ObyteMcpError("NETWORK_ERROR", "Explorer request failed", { url });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ObyteMcpError("NETWORK_ERROR", `Explorer responded with HTTP ${response.status}`, { url });
  }

  const payload = (await response.json()) as unknown;
  const entry = extractAssetEntry(decodeNuxtPayload(payload), value);
  if (entry.notFound === true) {
    throw new ObyteMcpError("HUB_ERROR", `Asset "${options.value}" was not found on the ${options.network} explorer`, { url });
  }

  const holdersRaw = Array.isArray(entry.holders) ? entry.holders : [];
  const isBase = entry.assetUnit === "bytes" || value === "GBYTE";
  const decimals = isBase ? BASE_DECIMALS : typeof entry.decimals === "number" ? entry.decimals : null;
  const name = isBase ? "GBYTE" : typeof entry.name === "string" ? entry.name : null;
  const supplyRaw = typeof entry.supply === "number" ? entry.supply : null;

  const holders: AssetHolder[] = [];
  let assetId: string | null = null;
  for (const item of holdersRaw.slice(0, options.limit)) {
    if (!isPlainObject(item) || typeof item.address !== "string" || typeof item.balance !== "number") continue;
    if (assetId === null && typeof item.asset === "string") assetId = item.asset === "bytes" ? "base" : item.asset;
    holders.push({
      address: item.address,
      raw_balance: item.balance,
      display_balance: decimals === null ? null : formatAmount(item.balance, decimals)
    });
  }

  return {
    input: options.value,
    network: options.network,
    asset: assetId,
    name,
    decimals,
    supply_raw: supplyRaw,
    supply_display: supplyRaw !== null && decimals !== null ? formatAmount(supplyRaw, decimals) : null,
    holders,
    holders_returned: holders.length,
    more_holders_available: entry.endHolders === false || holdersRaw.length > holders.length,
    explorer_asset_url: assetExplorerUrl(options.network, value),
    source_note: SOURCE_NOTE
  };
}

function normalizeAlias(value: string): string {
  const trimmed = value.trim();
  return trimmed === "base" || trimmed === "bytes" ? "GBYTE" : trimmed;
}

function extractAssetEntry(decoded: unknown, value: string): Record<string, unknown> {
  const data = isPlainObject(decoded) ? decoded.data : undefined;
  if (isPlainObject(data)) {
    const exact = data[`asset:${value}`];
    if (isPlainObject(exact)) return exact;
    for (const [key, entry] of Object.entries(data)) {
      if (key.startsWith("asset:") && isPlainObject(entry)) return entry;
    }
  }
  throw new ObyteMcpError("INTERNAL_ERROR", "Unexpected explorer payload shape", { value });
}

/**
 * Resolves Nuxt's devalue payload: a flat array where object values and array
 * items are indices into the same array. Known reactive wrappers are unwrapped;
 * devalue's negative sentinels map to undefined.
 */
export function decodeNuxtPayload(payload: unknown): unknown {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ObyteMcpError("INTERNAL_ERROR", "Explorer payload is not a Nuxt data array");
  }
  const wrappers = new Set(["ShallowReactive", "Reactive", "Ref", "ShallowRef"]);

  const resolve = (index: number, depth: number): unknown => {
    if (depth > 16 || index < 0 || index >= payload.length) return undefined;
    const value = payload[index];
    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {};
      for (const [key, ref] of Object.entries(value)) {
        result[key] = typeof ref === "number" ? resolve(ref, depth + 1) : ref;
      }
      return result;
    }
    if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === "string" && wrappers.has(value[0]) && typeof value[1] === "number") {
        return resolve(value[1], depth + 1);
      }
      return value.map((ref) => (typeof ref === "number" ? resolve(ref, depth + 1) : ref));
    }
    return value;
  };

  return resolve(0, 0);
}
