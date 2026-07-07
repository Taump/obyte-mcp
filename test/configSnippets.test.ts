import { describe, expect, it } from "vitest";
import { buildRuntimeConfig } from "../src/config.js";
import { commandArgs, installInvocation, serverEntry } from "../src/configSnippets.js";

describe("install command builders", () => {
  it("keeps the default (mainnet) launch args minimal", () => {
    const args = commandArgs(buildRuntimeConfig({}, {}));
    expect(args).toEqual(["-y", "obyte-mcp"]);
  });

  it("emits --network only when the default is not mainnet", () => {
    expect(commandArgs(buildRuntimeConfig({}, { network: "testnet" }))).toEqual(["-y", "obyte-mcp", "--network", "testnet"]);
  });

  it("emits per-network overrides", () => {
    const config = buildRuntimeConfig(
      { OBYTE_TESTNET_HUB_ADDRESS: "https://tn.example/api", OBYTE_TESTNET_TOKEN_REGISTRY_ADDRESS: "TNREG" },
      {}
    );
    expect(commandArgs(config)).toEqual([
      "-y",
      "obyte-mcp",
      "--testnet-hub",
      "https://tn.example/api",
      "--testnet-token-registry",
      "TNREG"
    ]);
  });

  it("builds a claude-code CLI invocation with the required -- separator", () => {
    const invocation = installInvocation("claude-code", buildRuntimeConfig({}, {}), "obyte");
    expect(invocation).toEqual({
      command: "claude",
      args: ["mcp", "add", "--transport", "stdio", "obyte", "--", "npx", "-y", "obyte-mcp"]
    });
  });

  it("builds a codex CLI invocation", () => {
    const invocation = installInvocation("codex", buildRuntimeConfig({}, { network: "testnet" }), "obyte");
    expect(invocation).toEqual({
      command: "codex",
      args: ["mcp", "add", "obyte", "--", "npx", "-y", "obyte-mcp", "--network", "testnet"]
    });
  });

  it("builds a vscode invocation with a JSON server blob", () => {
    const invocation = installInvocation("vscode", buildRuntimeConfig({}, {}), "obyte")!;
    expect(invocation.command).toBe("code");
    expect(invocation.args[0]).toBe("--add-mcp");
    expect(JSON.parse(invocation.args[1]!)).toEqual({ name: "obyte", command: "npx", args: ["-y", "obyte-mcp"] });
  });

  it("has no CLI invocation for claude-desktop (file-based)", () => {
    expect(installInvocation("claude-desktop", buildRuntimeConfig({}, {}), "obyte")).toBeUndefined();
    expect(serverEntry(buildRuntimeConfig({}, {}))).toEqual({ command: "npx", args: ["-y", "obyte-mcp"] });
  });
});
