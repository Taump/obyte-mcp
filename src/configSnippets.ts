import type { ClientName } from "./cliArgs.js";
import type { RuntimeConfig } from "./types.js";

export const DEFAULT_SERVER_NAME = "obyte";

export interface Invocation {
  command: string;
  args: string[];
}

/** The `npx` arguments that launch the server with the given runtime config. */
export function commandArgs(config: RuntimeConfig): string[] {
  const args = ["-y", "obyte-mcp"];
  if (config.defaultNetwork !== "mainnet") args.push("--network", config.defaultNetwork);
  if (config.networks.mainnet.hubSource !== "default") args.push("--mainnet-hub", config.networks.mainnet.hubAddress);
  if (config.networks.testnet.hubSource !== "default") args.push("--testnet-hub", config.networks.testnet.hubAddress);
  if (isOverride(config.networks.mainnet.tokenRegistrySource) && config.networks.mainnet.tokenRegistryAddress) {
    args.push("--mainnet-token-registry", config.networks.mainnet.tokenRegistryAddress);
  }
  if (isOverride(config.networks.testnet.tokenRegistrySource) && config.networks.testnet.tokenRegistryAddress) {
    args.push("--testnet-token-registry", config.networks.testnet.tokenRegistryAddress);
  }
  return args;
}

function isOverride(source: string): boolean {
  return source === "env" || source === "cli";
}

/** The `command`/`args` for the entry written into a JSON-style client config (`npx obyte-mcp ...`). */
export function serverEntry(config: RuntimeConfig): Invocation {
  return { command: "npx", args: commandArgs(config) };
}

/** The client CLI command that registers the server (for clients that expose a CLI). */
export function installInvocation(client: ClientName, config: RuntimeConfig, serverName: string): Invocation | undefined {
  const args = commandArgs(config);
  if (client === "claude-code") {
    return { command: "claude", args: ["mcp", "add", "--transport", "stdio", serverName, "--", "npx", ...args] };
  }
  if (client === "codex") {
    return { command: "codex", args: ["mcp", "add", serverName, "--", "npx", ...args] };
  }
  if (client === "vscode") {
    return { command: "code", args: ["--add-mcp", JSON.stringify({ name: serverName, command: "npx", args })] };
  }
  return undefined; // claude-desktop has no CLI; it is configured by writing its JSON file
}

export function configSnippet(client: ClientName, config: RuntimeConfig, serverName = DEFAULT_SERVER_NAME): string {
  if (client === "claude-code") return claudeCodeSnippet(config, serverName);
  if (client === "claude-desktop") return claudeDesktopSnippet(config, serverName);
  if (client === "cursor") return cursorSnippet(config, serverName);
  if (client === "vscode") return vscodeSnippet(config, serverName);
  return codexSnippet(config, serverName);
}

export function allConfigSnippets(config: RuntimeConfig, serverName = DEFAULT_SERVER_NAME): string {
  return `## VS Code

${vscodeSnippet(config, serverName)}

## Cursor

${cursorSnippet(config, serverName)}

## Codex CLI

${codexSnippet(config, serverName)}

## Claude Desktop

${claudeDesktopSnippet(config, serverName)}

## Claude Code

${claudeCodeSnippet(config, serverName)}
`;
}

export function vscodeSnippet(config: RuntimeConfig, serverName = DEFAULT_SERVER_NAME): string {
  const entry = serverEntry(config);
  const body = fencedJson({
    servers: {
      [serverName]: { type: "stdio", command: entry.command, args: entry.args }
    }
  });
  return `Add to \`.vscode/mcp.json\` (workspace) or your user \`settings.json\` under \`"mcp"\`:

${body}

Or register it from a terminal:

${fencedShell(`code --add-mcp '${JSON.stringify({ name: serverName, command: entry.command, args: entry.args })}'`)}`;
}

export function codexSnippet(config: RuntimeConfig, serverName = DEFAULT_SERVER_NAME): string {
  const entry = serverEntry(config);
  const argsToml = entry.args.map((value) => JSON.stringify(value)).join(", ");
  return `Add to \`~/.codex/config.toml\`:

\`\`\`toml
[mcp_servers.${serverName}]
command = ${JSON.stringify(entry.command)}
args = [${argsToml}]
\`\`\`

Or register it from a terminal (newer Codex CLI):

${fencedShell(`codex mcp add ${serverName} -- ${entry.command} ${entry.args.map(shellQuote).join(" ")}`)}`;
}

export function cursorSnippet(config: RuntimeConfig, serverName = DEFAULT_SERVER_NAME): string {
  const entry = serverEntry(config);
  return `Edit \`~/.cursor/mcp.json\` (global) or \`.cursor/mcp.json\` (this project) and restart Cursor:

${fencedJson({ mcpServers: { [serverName]: { command: entry.command, args: entry.args } } })}`;
}

export function claudeDesktopSnippet(config: RuntimeConfig, serverName = DEFAULT_SERVER_NAME): string {
  const entry = serverEntry(config);
  return `Edit \`claude_desktop_config.json\` and restart Claude Desktop:

${fencedJson({ mcpServers: { [serverName]: { command: entry.command, args: entry.args } } })}`;
}

export function claudeCodeSnippet(config: RuntimeConfig, serverName = DEFAULT_SERVER_NAME): string {
  const entry = serverEntry(config);
  return `${fencedShell(`claude mcp add --transport stdio ${serverName} -- ${entry.command} ${entry.args.map(shellQuote).join(" ")}`)}

The \`--\` before \`${entry.command}\` is required. Without it, Claude Code can parse server flags as Claude flags.`;
}

function fencedJson(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function fencedShell(command: string): string {
  return `\`\`\`bash\n${command}\n\`\`\``;
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/:=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
