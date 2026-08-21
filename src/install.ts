import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { buildRuntimeConfig } from "./config.js";
import { CLIENT_NAMES, type ClientName } from "./cliArgs.js";
import { DEFAULT_SERVER_NAME, allConfigSnippets, configSnippet, installInvocation, serverEntry } from "./configSnippets.js";
import { ObyteMcpError } from "./errors.js";
import type { CliOptions, RuntimeConfig } from "./types.js";

interface InstallOptions {
  dryRun: boolean;
  client?: ClientName;
  serverName?: string;
}

interface StepResult {
  client: ClientName;
  status: "installed" | "dry-run" | "printed" | "skipped" | "failed";
  detail: string;
}

export async function runInstall(cliOptions: CliOptions, install: InstallOptions): Promise<void> {
  const config = buildRuntimeConfig(process.env, cliOptions);
  const serverName = install.serverName ?? DEFAULT_SERVER_NAME;
  const targeted = install.client !== undefined;
  const clients = install.client ? [install.client] : CLIENT_NAMES;

  out(`# obyte-mcp install\n`);
  out(`Server name: ${serverName}`);
  out(`Default network: ${config.defaultNetwork} (each tool still accepts a per-call "network")`);
  out(install.dryRun ? "Mode: dry run (no changes will be made)\n" : "Mode: apply\n");

  const results: StepResult[] = [];
  for (const client of clients) {
    // Without an explicit --client, clients that are not installed are skipped
    // quietly instead of printing manual steps nobody asked for.
    if (!targeted && !isClientInstalled(client)) {
      results.push({ client, status: "skipped", detail: "not installed on this machine" });
      continue;
    }
    results.push(
      usesJsonConfigFile(client)
        ? installJsonClient(client, config, serverName, install.dryRun)
        : installViaCli(client, config, serverName, install.dryRun)
    );
  }

  reportSummary(results, config, serverName, targeted);

  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

function reportSummary(results: StepResult[], config: RuntimeConfig, serverName: string, targeted: boolean): void {
  out(`\n## Summary`);
  for (const result of results) {
    out(`${statusIcon(result.status)} ${result.client}: ${result.detail}`);
  }

  const changed = results.filter((result) => result.status === "installed");
  if (changed.length > 0) {
    out(`\nRestart ${changed.map((result) => result.client).join(", ")} to load the server, then verify with:`);
    out(`  npx -y obyte-mcp doctor`);
    return;
  }

  if (!targeted && results.every((result) => result.status === "skipped")) {
    out(`\nNo supported MCP client was detected. Install one, or add the server by hand:\n`);
    out(allConfigSnippets(config, serverName));
  }
}

/** Clients configured by writing a JSON file rather than by running their own CLI. */
function usesJsonConfigFile(client: ClientName): boolean {
  return client === "claude-desktop" || client === "cursor";
}

function jsonConfigPath(client: ClientName): string {
  return client === "cursor" ? cursorConfigPath() : claudeDesktopConfigPath();
}

/** A client counts as installed when its CLI is on PATH or its config directory exists. */
export function isClientInstalled(client: ClientName): boolean {
  if (usesJsonConfigFile(client)) return existsSync(dirname(jsonConfigPath(client)));
  const command = clientCommand(client);
  return command !== undefined && isCommandAvailable(command);
}

function clientCommand(client: ClientName): string | undefined {
  if (client === "claude-code") return "claude";
  if (client === "codex") return "codex";
  if (client === "vscode") return "code";
  return undefined;
}

/**
 * Looks the command up on PATH directly. Spawning a probe would either need a
 * shell (deprecated with args, and needless quoting risk) or `where`/`which`,
 * which are not uniformly available.
 */
function isCommandAvailable(command: string): boolean {
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      if (existsSync(join(directory, `${command}${extension}`))) return true;
    }
  }
  return false;
}

function installViaCli(client: ClientName, config: RuntimeConfig, serverName: string, dryRun: boolean): StepResult {
  const invocation = installInvocation(client, config, serverName);
  if (!invocation) throw new ObyteMcpError("INTERNAL_ERROR", `No CLI installer for ${client}`);
  const printable = `${invocation.command} ${invocation.args.map(quoteForDisplay).join(" ")}`;

  out(`\n## ${client}`);
  if (dryRun) {
    out(`Would run:\n  ${printable}`);
    return { client, status: "dry-run", detail: `would run \`${invocation.command}\`` };
  }

  const run = runCli(invocation.command, invocation.args);
  if (run.missing) {
    out(`\`${invocation.command}\` was not found on PATH. Register it manually instead:\n`);
    out(configSnippet(client, config, serverName));
    return { client, status: "printed", detail: `\`${invocation.command}\` not found; printed manual steps` };
  }
  if (!run.ok) {
    out(`\`${invocation.command}\` exited with an error. You can also register it manually:\n`);
    out(configSnippet(client, config, serverName));
    return { client, status: "failed", detail: run.message };
  }
  return { client, status: "installed", detail: `registered via \`${invocation.command} mcp add\`` };
}

function installJsonClient(client: ClientName, config: RuntimeConfig, serverName: string, dryRun: boolean): StepResult {
  const path = jsonConfigPath(client);
  const entry = serverEntry(config);
  const serverConfig = { command: entry.command, args: entry.args };

  out(`\n## ${client}`);
  out(`Config file: ${path}`);

  if (dryRun) {
    out(`Would add server "${serverName}":\n  ${JSON.stringify(serverConfig)}`);
    return { client, status: "dry-run", detail: `would edit ${path}` };
  }

  const dir = dirname(path);
  if (!existsSync(dir)) {
    out(`${client} config directory does not exist. Is ${client} installed? Add this manually:\n`);
    out(configSnippet(client, config, serverName));
    return { client, status: "printed", detail: "config dir not found; printed manual steps" };
  }

  let root: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) root = parsed as Record<string, unknown>;
      else return failWithSnippet(client, config, serverName, `existing config is not a JSON object: ${path}`);
    } catch {
      return failWithSnippet(client, config, serverName, `existing config is not valid JSON: ${path}`);
    }
    const backup = `${path}.bak`;
    copyFileSync(path, backup);
    out(`Backed up existing config to ${backup}`);
  } else {
    mkdirSync(dir, { recursive: true });
  }

  const servers = (root.mcpServers && typeof root.mcpServers === "object" ? root.mcpServers : {}) as Record<string, unknown>;
  const existed = serverName in servers;
  servers[serverName] = serverConfig;
  root.mcpServers = servers;
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, "utf8");

  out(`${existed ? "Updated" : "Added"} server "${serverName}". Restart ${client} to load it.`);
  return { client, status: "installed", detail: `${existed ? "updated" : "added"} in ${path}` };
}

function failWithSnippet(client: ClientName, config: RuntimeConfig, serverName: string, detail: string): StepResult {
  out(`${detail}. Left the file untouched. Add this manually:\n`);
  out(configSnippet(client, config, serverName));
  return { client, status: "failed", detail };
}

interface CliRun {
  ok: boolean;
  missing: boolean;
  message: string;
}

function runCli(command: string, args: string[]): CliRun {
  if (process.platform === "win32") return runCliWindows(command, args);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, missing: true, message: `${command} not found on PATH` };
    }
    return { ok: false, missing: false, message: result.error.message };
  }
  if (result.status === 0) return { ok: true, missing: false, message: "ok" };
  return { ok: false, missing: false, message: `exited with code ${result.status ?? "unknown"}` };
}

function runCliWindows(command: string, args: string[]): CliRun {
  // npm-installed CLIs (claude, code, codex) are .cmd shims on Windows; modern Node
  // refuses to spawn them without a shell (CVE-2024-27980). Probe with where.exe,
  // then run through the shell with cmd-style quoting.
  if (!isCommandAvailable(command)) {
    return { ok: false, missing: true, message: `${command} not found on PATH` };
  }
  const line = [command, ...args.map(quoteForCmd)].join(" ");
  const result = spawnSync(line, { stdio: "inherit", shell: true });
  if (result.error) return { ok: false, missing: false, message: result.error.message };
  if (result.status === 0) return { ok: true, missing: false, message: "ok" };
  return { ok: false, missing: false, message: `exited with code ${result.status ?? "unknown"}` };
}

function quoteForCmd(value: string): string {
  if (/^[A-Za-z0-9._:\\/=-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function cursorConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

export function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function statusIcon(status: StepResult["status"]): string {
  if (status === "installed") return "ok  ";
  if (status === "dry-run") return "dry ";
  if (status === "printed") return "note";
  if (status === "skipped") return "skip";
  return "fail";
}

function quoteForDisplay(value: string): string {
  return /[\s'"{}]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
