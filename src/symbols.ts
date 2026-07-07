import { MAINNET_TOKEN_REGISTRY_ADDRESS } from "./constants.js";
import { ObyteMcpError } from "./errors.js";

export interface AaStateVarsReader {
  getAaStateVars(address: string, varPrefix?: string, from?: string, to?: string): Promise<unknown>;
}

export interface SymbolOptions {
  configuredRegistryAddress?: string | undefined;
  tokenRegistryAddress?: string | undefined;
}

export function getOfficialTokenRegistryAddress(configuredRegistryAddress?: string): string {
  return configuredRegistryAddress ?? MAINNET_TOKEN_REGISTRY_ADDRESS;
}

export async function getSymbolByAsset(client: AaStateVarsReader, asset: string | null, options: SymbolOptions = {}): Promise<string | null> {
  if (asset === null || asset === "base") return "GBYTE";
  if (typeof asset !== "string") return null;
  const tokenRegistryAddress = requireRegistry(options);
  const stateVars = await client.getAaStateVars(tokenRegistryAddress, `a2s_${asset}`);
  const resolved = isRecord(stateVars) ? stateVars[`a2s_${asset}`] : undefined;
  if (typeof resolved === "string") {
    return resolved;
  }
  return asset.replace(/[+=]/g, "").substring(0, 6);
}

export async function getAssetBySymbol(client: AaStateVarsReader, symbol: string, options: SymbolOptions = {}): Promise<string | null> {
  if (symbol === "GBYTE" || symbol === "MBYTE" || symbol === "KBYTE" || symbol === "BYTE") return "base";
  const tokenRegistryAddress = requireRegistry(options);
  const stateVars = await client.getAaStateVars(tokenRegistryAddress, `s2a_${symbol}`);
  const resolved = isRecord(stateVars) ? stateVars[`s2a_${symbol}`] : undefined;
  return typeof resolved === "string" ? resolved : null;
}

export async function getDecimalsBySymbolOrAsset(client: AaStateVarsReader, symbolOrAsset: string, options: SymbolOptions = {}): Promise<number> {
  if (!symbolOrAsset) throw new ObyteMcpError("VALIDATION_ERROR", "symbolOrAsset is undefined");
  // Base aliases have fixed decimals and must work without a registry (e.g. on testnet).
  if (symbolOrAsset === "base" || symbolOrAsset === "GBYTE") return 9;
  if (symbolOrAsset === "MBYTE") return 6;
  if (symbolOrAsset === "KBYTE") return 3;
  if (symbolOrAsset === "BYTE") return 0;
  const tokenRegistryAddress = requireRegistry(options);

  let asset: string;
  if (symbolOrAsset.length === 44) {
    asset = symbolOrAsset;
  } else if (symbolOrAsset === symbolOrAsset.toUpperCase()) {
    const stateVars = await client.getAaStateVars(tokenRegistryAddress, `s2a_${symbolOrAsset}`);
    const resolved = isRecord(stateVars) ? stateVars[`s2a_${symbolOrAsset}`] : undefined;
    if (typeof resolved !== "string") throw new ObyteMcpError("HUB_ERROR", `no such symbol ${symbolOrAsset}`);
    asset = resolved;
  } else {
    throw new ObyteMcpError("VALIDATION_ERROR", "not valid symbolOrAsset");
  }

  const descVars = await client.getAaStateVars(tokenRegistryAddress, `current_desc_${asset}`);
  const descHash = isRecord(descVars) ? descVars[`current_desc_${asset}`] : undefined;
  if (typeof descHash !== "string") throw new ObyteMcpError("HUB_ERROR", `no decimals for ${symbolOrAsset}`);

  const decimalsVars = await client.getAaStateVars(tokenRegistryAddress, `decimals_${descHash}`);
  const decimals = isRecord(decimalsVars) ? decimalsVars[`decimals_${descHash}`] : undefined;
  if (typeof decimals !== "number") throw new ObyteMcpError("HUB_ERROR", `no decimals for ${symbolOrAsset}`);
  return decimals;
}

export async function resolveAsset(client: AaStateVarsReader, value: string, options: SymbolOptions = {}): Promise<unknown> {
  if (value === "base" || value === "GBYTE" || value === "MBYTE" || value === "KBYTE" || value === "BYTE") {
    return {
      input: value,
      asset: "base",
      symbol: value === "base" ? "GBYTE" : value,
      decimals: value === "GBYTE" || value === "base" ? 9 : value === "MBYTE" ? 6 : value === "KBYTE" ? 3 : 0
    };
  }

  if (value.length === 44) {
    const [symbol, decimals] = await Promise.all([
      getSymbolByAsset(client, value, options),
      getDecimalsBySymbolOrAsset(client, value, options).catch(() => null)
    ]);
    return { input: value, asset: value, symbol, decimals };
  }

  const asset = await getAssetBySymbol(client, value, options);
  const decimals = await getDecimalsBySymbolOrAsset(client, value, options).catch(() => null);
  return { input: value, asset, symbol: value, decimals };
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
