import { MAINNET_EXPLORER, TESTNET_EXPLORER } from "./constants.js";
import { isPlainObject } from "./jsonUtils.js";
import { getDecimalsBySymbolOrAsset, getSymbolByAsset } from "./symbols.js";
import type { AaStateVarsReader, SymbolOptions } from "./symbols.js";
import type { Network } from "./types.js";

export const BASE_DECIMALS = 9;

export const AMOUNTS_NOTE =
  "Raw on-ledger amounts are integers in the asset's smallest units. display_total is already divided by 10^decimals; present display values to users, never raw integers. base is GBYTE with 9 decimals. explorer_asset_url lists the asset's description and holders (explorer amounts are already in display units).";

/** Explorer page listing an asset's description and holders. */
export function assetExplorerUrl(network: Network, symbolOrAsset: string): string {
  const base = network === "testnet" ? TESTNET_EXPLORER : MAINNET_EXPLORER;
  return `${base}/asset/${encodeURIComponent(symbolOrAsset)}`;
}

export interface AssetAmountSummary {
  asset: string;
  symbol: string | null;
  decimals: number | null;
  raw_total: number;
  display_total: string | null;
  explorer_asset_url?: string;
}

export interface BalanceAmountSummary {
  totals_by_asset: Record<string, AssetAmountSummary>;
  amounts_note: string;
  unresolved_assets?: string[];
}

/**
 * Converts a raw smallest-units integer into a human display string without
 * floating point artifacts, e.g. formatAmount(2500000000, 9) === "2.5".
 */
export function formatAmount(rawAmount: number, decimals: number): string | null {
  if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  if (decimals === 0) return String(rawAmount);
  if (!Number.isSafeInteger(rawAmount)) return String(rawAmount / 10 ** decimals);
  const negative = rawAmount < 0;
  const digits = String(Math.abs(rawAmount)).padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const frac = digits.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Sums raw amounts per asset from either hub balance shape:
 * - get_balances: { address: { asset: { stable, pending } } }
 * - AA balances:  { asset: number }
 */
export function collectAssetTotals(balances: unknown): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!isPlainObject(balances)) return totals;

  const add = (asset: string, value: unknown): void => {
    let raw: number | undefined;
    if (typeof value === "number") {
      raw = value;
    } else if (isPlainObject(value)) {
      const stable = typeof value.stable === "number" ? value.stable : 0;
      const pending = typeof value.pending === "number" ? value.pending : 0;
      raw = stable + pending;
    }
    if (raw !== undefined) totals[asset] = (totals[asset] ?? 0) + raw;
  };

  for (const [key, entry] of Object.entries(balances)) {
    const values = isPlainObject(entry) ? Object.values(entry) : [];
    if (values.length > 0 && values.every((value) => isPlainObject(value))) {
      // Address -> asset map (get_balances shape); sum across addresses.
      for (const [asset, value] of Object.entries(entry as Record<string, unknown>)) add(asset, value);
    } else {
      add(key, entry);
    }
  }
  return totals;
}

export interface SummarizeOptions extends SymbolOptions {
  resolve?: boolean;
  maxResolvedAssets?: number;
  /** When set, each asset summary gets an explorer_asset_url for that network. */
  network?: Network;
}

/**
 * Builds a per-asset totals summary with symbols, decimals, and display amounts.
 * base always resolves to GBYTE/9 without touching the registry; custom assets
 * are resolved through the registry when available, failures degrade to nulls
 * and are listed in unresolved_assets so agents know to resolve before display.
 */
export async function summarizeBalanceAmounts(
  reader: AaStateVarsReader,
  balances: unknown,
  options: SummarizeOptions = {}
): Promise<BalanceAmountSummary> {
  const totals = collectAssetTotals(balances);
  const customAssets = Object.keys(totals).filter((asset) => asset !== "base");
  const maxResolved = options.maxResolvedAssets ?? 10;
  const toResolve = options.resolve === false ? [] : customAssets.slice(0, maxResolved);

  const resolved = new Map(
    await Promise.all(
      toResolve.map(async (asset) => {
        const [symbol, decimals] = await Promise.all([
          getSymbolByAsset(reader, asset, options).catch(() => null),
          getDecimalsBySymbolOrAsset(reader, asset, options).catch(() => null)
        ]);
        return [asset, { symbol, decimals }] as const;
      })
    )
  );

  const totalsByAsset: Record<string, AssetAmountSummary> = {};
  const unresolved: string[] = [];
  for (const [asset, rawTotal] of Object.entries(totals)) {
    if (asset === "base") {
      totalsByAsset[asset] = {
        asset,
        symbol: "GBYTE",
        decimals: BASE_DECIMALS,
        raw_total: rawTotal,
        display_total: formatAmount(rawTotal, BASE_DECIMALS),
        ...(options.network ? { explorer_asset_url: assetExplorerUrl(options.network, "GBYTE") } : {})
      };
      continue;
    }
    const info = resolved.get(asset);
    const decimals = info?.decimals ?? null;
    const symbol = info?.symbol ?? null;
    totalsByAsset[asset] = {
      asset,
      symbol,
      decimals,
      raw_total: rawTotal,
      display_total: decimals === null ? null : formatAmount(rawTotal, decimals),
      // Unknown assets get a prefix fallback "symbol"; only registry-confirmed symbols make clean explorer URLs.
      ...(options.network ? { explorer_asset_url: assetExplorerUrl(options.network, decimals !== null && symbol ? symbol : asset) } : {})
    };
    if (decimals === null) unresolved.push(asset);
  }

  const summary: BalanceAmountSummary = { totals_by_asset: totalsByAsset, amounts_note: AMOUNTS_NOTE };
  if (unresolved.length > 0) summary.unresolved_assets = unresolved;
  return summary;
}
