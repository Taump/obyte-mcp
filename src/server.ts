import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { writeDiagnostic } from "./diagnostics.js";
import { ObyteHttpClient, toClientConfig } from "./obyteClient.js";
import { registerObytePrompts } from "./prompts.js";
import { registerObyteResources } from "./resources.js";
import { registerObyteTools } from "./tools.js";
import type { Network, RuntimeConfig } from "./types.js";

export async function runServer(config: RuntimeConfig): Promise<void> {
  const handle = serveStdio(
    () => {
      const server = new McpServer({
        name: PACKAGE_NAME,
        version: PACKAGE_VERSION
      });
      const clients: Record<Network, ObyteHttpClient> = {
        mainnet: new ObyteHttpClient(toClientConfig(config, "mainnet")),
        testnet: new ObyteHttpClient(toClientConfig(config, "testnet"))
      };
      registerObyteTools(server, clients, config);
      registerObyteResources(server, config);
      registerObytePrompts(server);
      return server;
    },
    {
      onerror: (error) => {
        writeDiagnostic({
          level: "error",
          event: "mcp_stdio_error",
          message: error.message
        });
      }
    }
  );

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    writeDiagnostic({
      level: "info",
      event: "shutdown",
      message: `Received ${signal}, closing MCP stdio server`
    });
    await handle.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
