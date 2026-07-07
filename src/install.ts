import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildRuntimeConfig } from "./config.js";
import { CLIENT_NAMES, type ClientName } from "./cliArgs.js";
import { DEFAULT_SERVER_NAME, configSnippet, installInvocation, serverEntry } from "./configSnippets.js";
import { ObyteMcpError } from "./errors.js";
import type { CliOptions, RuntimeConfig } from "./types.js";

interface InstallOptions {
  dryRun: boolean;
  client?: ClientName;
  serverName?: string;
}

interface StepResult {
  client: ClientName;
  status: "installed" | "dry-run" | "printed" | "failed";
  detail: string;
}

export async function runInstall(cliOptions: CliOptions, install: InstallOptions): Promise<void> {
  const config = buildRuntimeConfig(process.env, cliOptions);
  const serverName = install.serverName ?? DEFAULT_SERVER_NAME;
  const clients = install.client ? [install.client] : CLIENT_NAMES;

  out(`# obyte-mcp install\n`);
  out(`Server name: ${serverName}`);
  out(`Default network: ${config.defaultNetwork} (each tool still accepts a per-call "network")`);
  out(install.dryRun ? "Mode: dry run (no changes will be made)\n" : "Mode: apply\n");

  const results: StepResult[] = [];
  for (const client of clients) {
    results.push(client === "claude-desktop" ? installDesktop(config, serverName, install.dryRun) : installViaCli(client, config, serverName, install.dryRun));
  }

  out(`\n## Summary`);
  for (const result of results) {
    out(`${statusIcon(result.status)} ${result.client}: ${result.detail}`);
  }

  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
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

function installDesktop(config: RuntimeConfig, serverName: string, dryRun: boolean): StepResult {
  const client: ClientName = "claude-desktop";
  const path = claudeDesktopConfigPath();
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
    out(`Claude Desktop config directory does not exist. Is Claude Desktop installed? Add this manually:\n`);
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

  out(`${existed ? "Updated" : "Added"} server "${serverName}". Restart Claude Desktop to load it.`);
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
  const probe = spawnSync("where", [command], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
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
  return "fail";
}

function quoteForDisplay(value: string): string {
  return /[\s'"{}]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
