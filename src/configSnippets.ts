import type { ClientName } from "./cliArgs.js";
import type { CliOptions, Network, RuntimeConfig } from "./types.js";

export function configSnippet(client: ClientName, config: RuntimeConfig): string {
  if (client === "claude-code") return claudeCodeCommand(config);
  if (client === "claude-desktop") return claudeDesktopJson(config);
  return codexJson(config);
}

export function allConfigSnippets(config: RuntimeConfig): string {
  return `# Codex

${codexJson(config)}

# Claude Desktop

${claudeDesktopJson(config)}

# Claude Code

${claudeCodeCommand(config)}
`;
}

export function cliOptionsFromNetwork(network: Network): CliOptions {
  return { network };
}

function commandArgs(config: RuntimeConfig): string[] {
  const args = ["-y", "obyte-mcp", "--network", config.network];
  if (config.source.hubAddress !== "default") args.push("--hub", config.hubAddress);
  if (config.tokenRegistryAddress && config.source.tokenRegistryAddress !== "default") {
    args.push("--token-registry", config.tokenRegistryAddress);
  }
  return args;
}

function codexJson(config: RuntimeConfig): string {
  return fencedJson({
    mcpServers: {
      obyte: {
        command: "npx",
        args: commandArgs(config)
      }
    }
  });
}

function claudeDesktopJson(config: RuntimeConfig): string {
  return fencedJson({
    mcpServers: {
      obyte: {
        command: "npx",
        args: commandArgs(config)
      }
    }
  });
}

function claudeCodeCommand(config: RuntimeConfig): string {
  return `\`\`\`bash
claude mcp add --transport stdio obyte -- npx ${commandArgs(config).map(shellQuote).join(" ")}
\`\`\`

The \`--\` before \`npx\` is required. Without it, Claude Code can parse server flags as Claude flags.`;
}

function fencedJson(value: unknown): string {
  return `\`\`\`json
${JSON.stringify(value, null, 2)}
\`\`\``;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/:=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
