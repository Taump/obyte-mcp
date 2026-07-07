import { ObyteMcpError } from "./errors.js";

const SECRET_KEY_PATTERN = /(^|[_-])(private[_-]?key|privkey|seed|mnemonic|xprv|passphrase|secret)([_-]|$)/i;
const HEX_PRIVATE_KEY_PATTERN = /\b(?:0x)?[a-f0-9]{64}\b/i;
const XPRV_PATTERN = /\b(?:xprv|tprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/;
const MNEMONIC_LIKE_PATTERN = /\b(?:[a-z]{3,12}\s+){11,23}[a-z]{3,12}\b/i;

export function assertNoSecrets(value: unknown): void {
  const reason = findSecretLikeInput(value, []);
  if (reason) {
    throw new ObyteMcpError(
      "SECRET_INPUT_REJECTED",
      "Secret-like input was rejected. This MCP server never needs private keys, seeds, mnemonics, xprv values, or passphrases.",
      reason
    );
  }
}

function findSecretLikeInput(value: unknown, path: string[]): unknown {
  if (typeof value === "string") {
    if (XPRV_PATTERN.test(value)) return { path, reason: "xprv-like string" };
    if (HEX_PRIVATE_KEY_PATTERN.test(value)) return { path, reason: "64-character hex private-key-like string" };
    if (MNEMONIC_LIKE_PATTERN.test(value)) return { path, reason: "mnemonic-like phrase" };
    return undefined;
  }

  if (value === null || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretLikeInput(value[index], [...path, String(index)]);
      if (found) return found;
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) return { path: [...path, key], reason: "secret-like field name" };
    const found = findSecretLikeInput(child, [...path, key]);
    if (found) return found;
  }
  return undefined;
}
