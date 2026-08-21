import { describe, expect, it } from "vitest";
import { CLIENT_NAMES, parseCliArgs } from "../src/cliArgs.js";

describe("cli args", () => {
  it("defaults to starting the server", () => {
    const parsed = parseCliArgs([]);
    expect(parsed.command).toBe("server");
    expect(parsed.options).toEqual({});
  });

  it("parses install flags", () => {
    const parsed = parseCliArgs(["install", "--client", "cursor", "--name", "obyte-testnet", "--network", "testnet", "--dry-run"]);
    expect(parsed.command).toBe("install");
    expect(parsed.install).toEqual({ dryRun: true, client: "cursor", serverName: "obyte-testnet" });
    expect(parsed.options.network).toBe("testnet");
  });

  it("accepts every supported client", () => {
    for (const client of CLIENT_NAMES) {
      expect(parseCliArgs(["install", "--client", client]).install.client).toBe(client);
      expect(parseCliArgs(["setup", "--client", client]).setup.client).toBe(client);
    }
  });

  it("lists the supported clients when one is unknown", () => {
    expect(() => parseCliArgs(["install", "--client", "notepad"])).toThrow(/--client must be one of .*cursor/);
  });

  it("rejects unknown arguments and missing values", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(/Unknown argument/);
    expect(() => parseCliArgs(["--network"])).toThrow(/--network requires a value/);
    expect(() => parseCliArgs(["--hub", "--network"])).toThrow(/--hub requires a value/);
  });

  it("parses bounded numeric options", () => {
    const parsed = parseCliArgs(["--timeout-ms", "5000", "--max-concurrency", "2", "--max-output-bytes", "32768"]);
    expect(parsed.options).toMatchObject({ timeoutMs: 5000, maxConcurrency: 2, maxOutputBytes: 32768 });
    expect(() => parseCliArgs(["--timeout-ms", "abc"])).toThrow(/requires an integer/);
  });
});
