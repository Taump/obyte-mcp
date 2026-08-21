import { createRequire } from "node:module";

/**
 * package.json is the single source of truth for name and version. It sits one
 * level above dist/ in the published tarball and inside the .mcpb bundle, so
 * this resolves in every distribution channel. Keeping a second copy here is
 * what makes a release report the wrong version to clients and to the update
 * check; scripts/sync-version.mjs propagates it to manifest.json/server.json.
 */
const packageJson = createRequire(import.meta.url)("../package.json") as { name: string; version: string };

export const PACKAGE_NAME = packageJson.name;
export const PACKAGE_VERSION = packageJson.version;

export const MAINNET_HUB = "https://obyte.org/api";
export const TESTNET_HUB = "https://testnet.obyte.org/api";
export const MAINNET_TOKEN_REGISTRY_ADDRESS = "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ";

export const MAINNET_EXPLORER = "https://explorer.obyte.org";
export const TESTNET_EXPLORER = "https://testnetexplorer.obyte.org";

export const DEFAULT_TIMEOUT_MS = 20_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 120_000;

export const DEFAULT_MAX_CONCURRENCY = 4;
export const MIN_MAX_CONCURRENCY = 1;
export const MAX_MAX_CONCURRENCY = 10;

export const DEFAULT_MAX_OUTPUT_BYTES = 262_144;
export const MIN_MAX_OUTPUT_BYTES = 16_384;
export const MAX_MAX_OUTPUT_BYTES = 1_048_576;

export const WITNESSES_CACHE_TTL_MS = 10 * 60 * 1000;
export const MAX_JSON_PAYLOAD_BYTES = 64 * 1024;
