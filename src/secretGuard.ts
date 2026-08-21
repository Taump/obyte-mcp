import { ObyteMcpError } from "./errors.js";

/**
 * Rejects the key material this server never needs: private keys, seeds,
 * mnemonics, xprv values, and passphrases.
 *
 * The guard is deliberately name-driven. AA triggers and getter arguments
 * legitimately carry opaque blobs - Ethereum txids ("0x" + 64 hex), sha256
 * hashes, and hash-timelock fields such as `secret_hash` - so a bare hex string
 * is not treated as key material on its own. Hex is only rejected under a field
 * name that claims to hold a key.
 */

const SECRET_KEY_PATTERN = /(^|[_-])(private[_-]?key|priv[_-]?key|secret[_-]?key|seed([_-]?phrase)?|mnemonic|xprv|tprv|pass[_-]?phrase|wif)([_-]|$)/i;
/** Field names that claim to hold a key without naming the key material outright. */
const KEYISH_NAME_PATTERN = /(^|[_-])(key|sk|priv|wif)([_-]|$)/i;
/** Field names that are about hashing, never about key material. */
const HASH_NAME_PATTERN = /hash|digest|checksum/i;
const HEX_KEY_PATTERN = /^(?:0x)?[a-f0-9]{64}$/i;
const XPRV_PATTERN = /\b(?:xprv|tprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/;
const MNEMONIC_LIKE_PATTERN = /\b(?:[a-z]{3,12}\s+){11,23}[a-z]{3,12}\b/i;

export function assertNoSecrets(value: unknown): void {
  const reason = findSecretLikeInput(value, [], undefined);
  if (reason) {
    throw new ObyteMcpError(
      "SECRET_INPUT_REJECTED",
      "Secret-like input was rejected. This MCP server never needs private keys, seeds, mnemonics, xprv values, or passphrases.",
      reason
    );
  }
}

function findSecretLikeInput(value: unknown, path: string[], parentKey: string | undefined): unknown {
  if (typeof value === "string") {
    if (XPRV_PATTERN.test(value)) return { path, reason: "xprv-like string" };
    if (MNEMONIC_LIKE_PATTERN.test(value)) return { path, reason: "mnemonic-like phrase" };
    if (isKeyishName(parentKey) && HEX_KEY_PATTERN.test(value.trim())) {
      return { path, reason: "hex private-key-like string under a key-like field name" };
    }
    return undefined;
  }

  if (value === null || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      // Array items inherit the field name that holds the array, e.g. keys: [...].
      const found = findSecretLikeInput(value[index], [...path, String(index)], parentKey);
      if (found) return found;
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) return { path: [...path, key], reason: "secret-like field name" };
    const found = findSecretLikeInput(child, [...path, key], key);
    if (found) return found;
  }
  return undefined;
}

function isKeyishName(key: string | undefined): boolean {
  if (!key) return false;
  return KEYISH_NAME_PATTERN.test(key) && !HASH_NAME_PATTERN.test(key);
}
