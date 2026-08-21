import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Constraints the Official MCP Registry enforces on server.json
 * (https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
 * They are checked here because the registry only reports them at publish time,
 * as a 422 from CI after the npm release is already out.
 */
function readJson(file: string): any {
  return JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
}

const MAX_DESCRIPTION = 100;
const MAX_TITLE = 100;
const MAX_NAME = 200;
const NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

describe("server.json", () => {
  const server = readJson("server.json");

  it("keeps the description within the registry limit", () => {
    expect(server.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });

  it("keeps the title within the registry limit", () => {
    expect(server.title.length).toBeLessThanOrEqual(MAX_TITLE);
  });

  it("uses a well-formed server name", () => {
    expect(server.name.length).toBeLessThanOrEqual(MAX_NAME);
    expect(server.name).toMatch(NAME_PATTERN);
  });

  it("matches mcpName in package.json exactly", () => {
    // The registry compares these case-sensitively when verifying npm ownership,
    // and the namespace must carry the GitHub login's exact case.
    expect(readJson("package.json").mcpName).toBe(server.name);
  });

  it("points at the npm package this repository publishes", () => {
    const pkg = readJson("package.json");
    expect(server.packages[0].registryType).toBe("npm");
    expect(server.packages[0].identifier).toBe(pkg.name);
  });
});
