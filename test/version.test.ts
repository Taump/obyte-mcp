import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/constants.js";

function readJson(file: string): any {
  return JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
}

describe("version", () => {
  it("takes name and version from package.json", () => {
    const pkg = readJson("package.json");
    expect(PACKAGE_NAME).toBe(pkg.name);
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });

  it("keeps the distribution manifests in sync with package.json", () => {
    // Guards the release flow: bump package.json, run `npm run sync-version`.
    const { version } = readJson("package.json");
    expect(readJson("manifest.json").version).toBe(version);
    const server = readJson("server.json");
    expect(server.version).toBe(version);
    expect(server.packages[0].version).toBe(version);
  });
});
