import { MAINNET_TOKEN_REGISTRY_ADDRESS } from "./constants.js";
import { ObyteMcpError } from "./errors.js";

export interface AaStateVarsReader {
  getAaStateVars(address: string, varPrefix?: string, from?: string, to?: string): Promise<unknown>;
}

export interface SymbolOptions {
  configuredRegistryAddress?: string | undefined;
  tokenRegistryAddress?: string | undefined;
}

/** Registry symbols are uppercase by convention; asset ids are base64 and case-sensitive. */
const ASSET_ID_LENGTH = 44;

export function getOfficialTokenRegistryAddress(configuredRegistryAddress?: string): string {
  return configuredRegistryAddress ?? MAINNET_TOKEN_REGISTRY_ADDRESS;
}

export async function getSymbolByAsset(client: AaStateVarsReader, asset: string | null, options: SymbolOptions = {}): Promise<string | null> {
  if (asset === null || asset === "base") return "GBYTE";
  if (typeof asset !== "string") return null;
  const tokenRegistryAddress = requireRegistry(options);
  const resolved = await readRegistryVar(client, tokenRegistryAddress, `a2s_${asset}`);
  if (typeof resolved === "string") {
    return resolved;
  }
  return asset.replace(/[+=]/g, "").substring(0, 6);
}

export async function getAssetBySymbol(client: AaStateVarsReader, symbol: string, options: SymbolOptions = {}): Promise<string | null> {
  if (baseAlias(symbol)) return "base";
  const tokenRegistryAddress = requireRegistry(options);
  const found = await lookupSymbol(client, symbol, tokenRegistryAddress);
  return found?.asset ?? null;
}

export async function getDecimalsBySymbolOrAsset(client: AaStateVarsReader, symbolOrAsset: string, options: SymbolOptions = {}): Promise<number> {
  if (!symbolOrAsset) throw new ObyteMcpError("VALIDATION_ERROR", "symbolOrAsset is undefined");
  // Base aliases have fixed decimals and must work without a registry (e.g. on testnet).
  const alias = baseAlias(symbolOrAsset);
  if (alias) return alias.decimals;
  const tokenRegistryAddress = requireRegistry(options);

  let asset: string;
  if (symbolOrAsset.length === ASSET_ID_LENGTH) {
    asset = symbolOrAsset;
  } else {
    const found = await lookupSymbol(client, symbolOrAsset, tokenRegistryAddress);
    if (!found) throw new ObyteMcpError("HUB_ERROR", `no such symbol ${symbolOrAsset}`);
    asset = found.asset;
  }

  return decimalsForAsset(client, asset, tokenRegistryAddress, symbolOrAsset);
}

export async function resolveAsset(client: AaStateVarsReader, value: string, options: SymbolOptions = {}): Promise<unknown> {
  const alias = baseAlias(value);
  if (alias) {
    return { input: value, asset: "base", symbol: alias.symbol, decimals: alias.decimals };
  }

  if (value.length === ASSET_ID_LENGTH) {
    const [symbol, decimals] = await Promise.all([
      getSymbolByAsset(client, value, options),
      getDecimalsBySymbolOrAsset(client, value, options).catch(() => null)
    ]);
    return { input: value, asset: value, symbol, decimals };
  }

  const tokenRegistryAddress = requireRegistry(options);
  const found = await lookupSymbol(client, value, tokenRegistryAddress);
  if (!found) {
    return {
      input: value,
      asset: null,
      symbol: null,
      decimals: null,
      note: `No asset is registered under the symbol "${value}" in the selected registry. Registry symbols are uppercase and the input is uppercased before lookup; check the symbol or pass the 44-character asset id.`
    };
  }
  const decimals = await decimalsForAsset(client, found.asset, tokenRegistryAddress, found.symbol).catch(() => null);
  return { input: value, asset: found.asset, symbol: found.symbol, decimals };
}

interface SymbolLookup {
  /** The registry spelling that matched, which is what should be shown to users. */
  symbol: string;
  asset: string;
}

/**
 * Looks a symbol up in the registry. Registry symbols are always uppercase, so
 * the input is normalized first: agents passing "ousd" would otherwise silently
 * resolve to nothing.
 */
async function lookupSymbol(client: AaStateVarsReader, symbol: string, tokenRegistryAddress: string): Promise<SymbolLookup | null> {
  const normalized = symbol.trim().toUpperCase();
  const resolved = await readRegistryVar(client, tokenRegistryAddress, `s2a_${normalized}`);
  return typeof resolved === "string" ? { symbol: normalized, asset: resolved } : null;
}

async function decimalsForAsset(client: AaStateVarsReader, asset: string, tokenRegistryAddress: string, label: string): Promise<number> {
  const descHash = await readRegistryVar(client, tokenRegistryAddress, `current_desc_${asset}`);
  if (typeof descHash !== "string") throw new ObyteMcpError("HUB_ERROR", `no decimals for ${label}`);

  const decimals = await readRegistryVar(client, tokenRegistryAddress, `decimals_${descHash}`);
  if (typeof decimals !== "number") throw new ObyteMcpError("HUB_ERROR", `no decimals for ${label}`);
  return decimals;
}

async function readRegistryVar(client: AaStateVarsReader, tokenRegistryAddress: string, varName: string): Promise<unknown> {
  const stateVars = await client.getAaStateVars(tokenRegistryAddress, varName);
  return isRecord(stateVars) ? stateVars[varName] : undefined;
}

/** Base-asset aliases are case-insensitive and never touch the registry. */
function baseAlias(value: string): { symbol: string; decimals: number } | undefined {
  switch (value.trim().toUpperCase()) {
    case "BASE":
    case "GBYTE":
      return { symbol: "GBYTE", decimals: 9 };
    case "MBYTE":
      return { symbol: "MBYTE", decimals: 6 };
    case "KBYTE":
      return { symbol: "KBYTE", decimals: 3 };
    case "BYTE":
      return { symbol: "BYTE", decimals: 0 };
    default:
      return undefined;
  }
}

function requireRegistry(options: SymbolOptions): string {
  const tokenRegistryAddress = options.tokenRegistryAddress ?? options.configuredRegistryAddress;
  if (!tokenRegistryAddress) {
    throw new ObyteMcpError(
      "CONFIG_ERROR",
      "Token registry address is required for symbol lookup on this network. Set OBYTE_TOKEN_REGISTRY_ADDRESS, pass --token-registry, or provide token_registry_address."
    );
  }
  return tokenRegistryAddress;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
