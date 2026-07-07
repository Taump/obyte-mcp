import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildRuntimeConfig } from "./config.js";
import { allConfigSnippets, configSnippet } from "./configSnippets.js";
import type { ClientName } from "./cliArgs.js";
import type { CliOptions, Network } from "./types.js";

interface SetupOptions {
  printOnly: boolean;
  client?: ClientName;
}

export async function runSetup(cliOptions: CliOptions, setup: SetupOptions): Promise<void> {
  const options = setup.printOnly ? cliOptions : await interactiveOptions(cliOptions);
  const config = buildRuntimeConfig(process.env, options);
  const body = setup.client ? configSnippet(setup.client, config) : allConfigSnippets(config);
  process.stdout.write(`# obyte-mcp setup

This one server serves both networks. Every tool takes an optional "network"; it defaults to the network below.

Default network: ${config.defaultNetwork}
Mainnet hub: ${config.networks.mainnet.hubAddress}
Testnet hub: ${config.networks.testnet.hubAddress}
Mainnet token registry: ${config.networks.mainnet.tokenRegistryAddress ?? "(not configured)"}
Testnet token registry: ${config.networks.testnet.tokenRegistryAddress ?? "(not configured)"}

To apply automatically instead of copying, run: obyte-mcp install

${body}
`);
}

async function interactiveOptions(cliOptions: CliOptions): Promise<CliOptions> {
  const rl = createInterface({ input, output });
  try {
    const network = cliOptions.network ?? (await askNetwork(rl));
    const hubAddress = cliOptions.hubAddress ?? (await askOptional(rl, "Custom hub URL (empty for default): "));
    const tokenRegistryAddress =
      cliOptions.tokenRegistryAddress ?? (await askOptional(rl, "Token registry address (empty for network default or unset): "));
    const result: CliOptions = { ...cliOptions, network };
    if (hubAddress !== undefined) result.hubAddress = hubAddress;
    if (tokenRegistryAddress !== undefined) result.tokenRegistryAddress = tokenRegistryAddress;
    return result;
  } finally {
    rl.close();
  }
}

async function askNetwork(rl: ReturnType<typeof createInterface>): Promise<Network> {
  while (true) {
    const answer = (await rl.question("Network (mainnet/testnet) [mainnet]: ")).trim() || "mainnet";
    if (answer === "mainnet" || answer === "testnet") return answer;
    process.stdout.write("Please enter mainnet or testnet.\n");
  }
}

async function askOptional(rl: ReturnType<typeof createInterface>, question: string): Promise<string | undefined> {
  const answer = (await rl.question(question)).trim();
  return answer || undefined;
}
