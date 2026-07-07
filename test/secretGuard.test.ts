import { describe, expect, it } from "vitest";
import { assertNoSecrets } from "../src/secretGuard.js";

describe("secret guard", () => {
  it("rejects secret-like keys", () => {
    expect(() => assertNoSecrets({ private_key: "abc" })).toThrow(/Secret-like input/);
    expect(() => assertNoSecrets({ nested: { mnemonic: "word word" } })).toThrow(/Secret-like input/);
  });

  it("rejects private-key-like strings conservatively", () => {
    expect(() => assertNoSecrets({ value: "a".repeat(64) })).toThrow(/Secret-like input/);
  });

  it("allows ordinary public trigger data", () => {
    expect(() => assertNoSecrets({ data: { amount: 1000, asset: "base" } })).not.toThrow();
  });
});
