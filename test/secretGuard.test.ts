import { describe, expect, it } from "vitest";
import { assertNoSecrets } from "../src/secretGuard.js";

describe("secret guard", () => {
  it("rejects secret-like keys", () => {
    expect(() => assertNoSecrets({ private_key: "abc" })).toThrow(/Secret-like input/);
    expect(() => assertNoSecrets({ privkey: "abc" })).toThrow(/Secret-like input/);
    expect(() => assertNoSecrets({ secret_key: "abc" })).toThrow(/Secret-like input/);
    expect(() => assertNoSecrets({ seed_phrase: "abc" })).toThrow(/Secret-like input/);
    expect(() => assertNoSecrets({ nested: { mnemonic: "word word" } })).toThrow(/Secret-like input/);
    expect(() => assertNoSecrets({ passphrase: "abc" })).toThrow(/Secret-like input/);
  });

  it("rejects key material by value", () => {
    expect(() => assertNoSecrets({ data: "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi" })).toThrow(
      /Secret-like input/
    );
    expect(() =>
      assertNoSecrets({ note: "abandon ability able about above absent absorb abstract absurd abuse access accident" })
    ).toThrow(/Secret-like input/);
    // Hex is only key material under a field name that claims to hold a key.
    expect(() => assertNoSecrets({ key: "a".repeat(64) })).toThrow(/Secret-like input/);
  });

  it("allows ordinary public trigger data", () => {
    expect(() => assertNoSecrets({ data: { amount: 1000, asset: "base" } })).not.toThrow();
  });

  it("allows opaque blobs that AA triggers legitimately carry", () => {
    // Regression: bridge triggers carry Ethereum txids, and hash-timelock AAs
    // carry sha256 hashes and secret_hash fields. None of these are key material.
    expect(() => assertNoSecrets({ trigger: { data: { txid: `0x${"a1b2c3d4".repeat(8)}`, txts: 1700000000 } } })).not.toThrow();
    expect(() => assertNoSecrets({ address: "AA", getter: "get", args: [`3b7f${"0".repeat(60)}`] })).not.toThrow();
    expect(() => assertNoSecrets({ trigger: { secret_hash: "a".repeat(64) } })).not.toThrow();
    expect(() => assertNoSecrets({ trigger: { hashed_secret: "abc", hash: "a".repeat(64) } })).not.toThrow();
  });
});
