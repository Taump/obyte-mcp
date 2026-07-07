import type { McpServer } from "@modelcontextprotocol/server";
import type { ZodType } from "zod/v4";
import { assetExplorerUrl, summarizeBalanceAmounts } from "./amounts.js";
import { envelopeConfig } from "./config.js";
import { executeEnvelope } from "./envelope.js";
import { fetchAssetHolders } from "./explorerClient.js";
import { ObyteHttpClient } from "./obyteClient.js";
import { assertNoSecrets } from "./secretGuard.js";
import * as schemas from "./schemas.js";
import { getAssetBySymbol, getDecimalsBySymbolOrAsset, getSymbolByAsset, resolveAsset } from "./symbols.js";
import { textResult } from "./toolResult.js";
import { checkForUpdate } from "./updateCheck.js";
import type { Network, NetworkConfig, RuntimeConfig } from "./types.js";

type ToolSchema = ZodType;

/** Per-call context: the hub client and config for the network resolved from the request. */
interface ToolCall {
  client: ObyteHttpClient;
  network: NetworkConfig;
}

type ToolHandler = (args: Record<string, any>, call: ToolCall) => Promise<unknown>;

interface RegisterContext {
  server: McpServer;
  clients: Record<Network, ObyteHttpClient>;
  config: RuntimeConfig;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: ToolSchema;
  handler: ToolHandler;
  dryRun?: boolean;
  /** Set on tools whose output contains raw smallest-unit amounts. */
  amounts?: boolean;
}

export function registerObyteTools(server: McpServer, clients: Record<Network, ObyteHttpClient>, config: RuntimeConfig): void {
  const context: RegisterContext = { server, clients, config };
  for (const tool of [...recommendedTools(context), ...rawTools(context), ...symbolTools(context)]) {
    registerTool(context, tool);
  }
}

function resolveNetwork(value: unknown, defaultNetwork: Network): Network {
  return value === "mainnet" || value === "testnet" ? value : defaultNetwork;
}

function withNetworkNote(description: string, config: RuntimeConfig): string {
  return `${description}\n\nNetwork: this server serves both Obyte networks at once. Pass "network":"mainnet" or "network":"testnet" to choose; when omitted it defaults to ${config.defaultNetwork}. If the user has not made the network explicit, confirm which network they mean before calling.`;
}

const AMOUNTS_DESCRIPTION_NOTE =
  'Amounts: raw ledger amounts in this output are integers in the asset\'s smallest units (base is GBYTE with 9 decimals). Never show raw integers to users: prefer display_total fields when present, otherwise resolve decimals with obyte_resolve_asset or obyte_get_decimals_by_symbol_or_asset and divide by 10^decimals.';

function toolDescription(tool: ToolDefinition, config: RuntimeConfig): string {
  const base = withNetworkNote(tool.description, config);
  return tool.amounts ? `${base}\n\n${AMOUNTS_DESCRIPTION_NOTE}` : base;
}

function registerTool(context: RegisterContext, tool: ToolDefinition): void {
  context.server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: toolDescription(tool, context.config),
      inputSchema: tool.schema as any,
      annotations: {
        title: tool.title,
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        ...(tool.dryRun ? {} : { idempotentHint: true })
      }
    },
    async (args: unknown) => {
      const record = (args ?? {}) as Record<string, any>;
      const network = resolveNetwork(record.network, context.config.defaultNetwork);
      const client = context.clients[network];
      const networkConfig = context.config.networks[network];
      const text = await executeEnvelope(envelopeConfig(context.config, network), tool.name, () => client.retryCount, async () => {
        assertNoSecrets(args);
        return tool.handler(record, { client, network: networkConfig });
      });
      return textResult(text);
    }
  );
}

function recommendedTools(context: RegisterContext): ToolDefinition[] {
  return [
    {
      name: "obyte_analyze_address",
      title: "Analyze Obyte Address",
      schema: schemas.analyzeAddressSchema,
      amounts: true,
      description:
        "Recommended first tool whenever the user pastes an Obyte address (a 32-character base32 string) or asks about an Obyte wallet, balance, or account. Returns balances with a decimals-aware balance_summary (symbols, decimals, display totals), plus optional definition, profile units, attestations, and bounded history. Use this instead of several raw calls. Output is a stable JSON envelope and may be truncated.",
      handler: async (args, { client, network }) => {
        const [balances, profileUnits, definition, attestations, history] = await Promise.all([
          client.getBalances([args.address]),
          client.getProfileUnits([args.address]),
          args.include_definition ? client.getDefinition(args.address).catch((error) => ({ error: String(error) })) : undefined,
          args.include_attestations ? client.getAttestations(args.address).catch((error) => ({ error: String(error) })) : undefined,
          args.include_history ? client.getHistory([args.address]).catch((error) => ({ error: String(error) })) : undefined
        ]);
        const balanceSummary = await summarizeBalanceAmounts(client, balances, {
          configuredRegistryAddress: network.tokenRegistryAddress,
          network: network.network
        });
        return {
          address: args.address,
          balances,
          balance_summary: balanceSummary,
          profile_units: profileUnits,
          definition,
          attestations,
          history
        };
      }
    },
    {
      name: "obyte_analyze_unit",
      title: "Analyze Obyte Unit",
      schema: schemas.analyzeUnitSchema,
      amounts: true,
      description:
        "Recommended tool whenever the user pastes an Obyte unit hash (a 44-character base64 string, usually ending in \"=\") or asks about an Obyte transaction. Fetches the joint and, when requested, follows the AA response chain for trigger units. Payment output amounts are raw smallest units. Output is hub data wrapped in a stable JSON envelope.",
      handler: async (args, { client }) => ({
        unit: args.unit,
        joint: await client.getJoint(args.unit),
        aa_response_chain: args.include_aa_response_chain ? await client.getAaResponseChain(args.unit).catch(() => null) : undefined
      })
    },
    {
      name: "obyte_analyze_aa",
      title: "Analyze Autonomous Agent",
      schema: schemas.analyzeAaSchema,
      amounts: true,
      description:
        "Recommended tool for summarizing an Obyte autonomous agent (AA). Returns AA balances with a decimals-aware balance_summary, selected state vars by prefix, and optional AA responses. Use for AA debugging or state inspection. State var amounts are raw smallest units. State vars are sorted by key and output may be truncated.",
      handler: async (args, { client, network }) => {
        const balances = args.include_balances ? await client.getAaBalances(args.address) : undefined;
        const [balanceSummary, stateVars, aaResponses] = await Promise.all([
          balances !== undefined
            ? summarizeBalanceAmounts(client, balances, {
                configuredRegistryAddress: network.tokenRegistryAddress,
                network: network.network
              })
            : undefined,
          args.state_var_prefix ? client.getAaStateVars(args.address, args.state_var_prefix) : undefined,
          args.include_responses ? client.getAaResponses(args.address) : undefined
        ]);
        return {
          address: args.address,
          balances,
          balance_summary: balanceSummary,
          state_vars: stateVars,
          aa_responses: aaResponses
        };
      }
    },
    {
      name: "obyte_resolve_asset",
      title: "Resolve Obyte Asset",
      schema: schemas.resolveAssetSchema,
      description:
        "Recommended tool for resolving an Obyte asset id (44-character base64 string) or token symbol (like GBYTE or OUSD) in the selected network's registry. Returns asset, symbol, and decimals when available. Always call this (or obyte_get_decimals_by_symbol_or_asset) before presenting amounts of unknown assets to users. Registry mappings are convenience metadata, not proof of legitimacy.",
      handler: async (args, { client, network }) => {
        const result = (await resolveAsset(client, args.value, {
          configuredRegistryAddress: network.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })) as Record<string, unknown>;
        const urlTarget = typeof result.symbol === "string" ? result.symbol : args.value;
        return {
          ...result,
          explorer_asset_url: assetExplorerUrl(network.network, urlTarget),
          holders_hint:
            "Open explorer_asset_url to see the asset description and current holders. Explorer amounts are already in display units - do not divide them by 10^decimals again."
        };
      }
    },
    {
      name: "obyte_get_asset_holders",
      title: "Get Asset Holders",
      schema: schemas.assetHoldersSchema,
      amounts: true,
      description:
        'Recommended tool whenever the user asks who holds an Obyte asset, wants a top-holders list, or asks about distribution/concentration of a token. Accepts a token symbol (like GBYTE or OUSD) or a 44-character asset id and returns holders sorted by balance descending with raw and display amounts, plus total supply. Data comes from the Obyte explorer (a centralized convenience service), not the hub, and may lag slightly. Up to 100 holders per call.',
      handler: async (args, { network }) =>
        fetchAssetHolders({
          network: network.network,
          value: args.asset_or_symbol,
          limit: args.limit ?? 20,
          timeoutMs: context.config.timeoutMs
        })
    },
    {
      name: "obyte_prepare_aa_dry_run",
      title: "Prepare AA Dry Run",
      schema: schemas.prepareAaDryRunSchema,
      dryRun: true,
      amounts: true,
      description:
        "Recommended tool for simulating an Obyte autonomous-agent trigger through the selected network's hub. Trigger and response amounts are raw smallest units (1 GBYTE = 1e9 bytes) - convert user-facing amounts before building the trigger. This does not sign, broadcast, or mutate local state. Dry-run tools are not marked idempotent and are not retried by default.",
      handler: async (args, { client }) => ({ address: args.address, dry_run: await client.dryRunAa(args.address, args.trigger) })
    },
    {
      name: "obyte_get_portfolio_summary",
      title: "Get Portfolio Summary",
      schema: schemas.portfolioSummarySchema,
      amounts: true,
      description:
        "Recommended tool for summarizing balances for up to 20 addresses. Returns raw balances plus totals_by_asset with symbols, decimals, and display totals already divided by 10^decimals (resolve_symbols controls registry lookups). Use for user-facing balance explanations rather than raw get_balances.",
      handler: async (args, { client, network }) => {
        const balances = await client.getBalances(args.addresses);
        const summary = await summarizeBalanceAmounts(client, balances, {
          configuredRegistryAddress: network.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address,
          resolve: args.resolve_symbols,
          maxResolvedAssets: 20,
          network: network.network
        });
        return { addresses: args.addresses, balances, ...summary };
      }
    }
  ];
}

function rawTools(context: RegisterContext): ToolDefinition[] {
  return [
    {
      name: "obyte_get_network_info",
      title: "Get Obyte Network Info",
      schema: schemas.networkInfoSchema,
      description:
        "Returns the effective MCP runtime configuration for both networks: default network, per-network hub URL and token registry, config precedence, limits, witnesses cache metadata, and whether a newer obyte-mcp version is published (mention it to the user when update_available is true). Use before other calls when network selection matters.",
      handler: async () => ({
        default_network: context.config.defaultNetwork,
        default_network_source: context.config.defaultNetworkSource,
        networks: context.config.networks,
        limits: {
          timeout_ms: context.config.timeoutMs,
          max_concurrency: context.config.maxConcurrency,
          max_output_bytes: context.config.maxOutputBytes,
          source: context.config.limitsSource
        },
        witnesses_cache: {
          mainnet: context.clients.mainnet.getWitnessesCacheInfo(),
          testnet: context.clients.testnet.getWitnessesCacheInfo()
        },
        update: await checkForUpdate()
      })
    },
    {
      name: "obyte_get_last_mci",
      title: "Get Last MCI",
      schema: schemas.networkOnlySchema,
      description: "Raw hub read. Returns the last main chain index known by the selected Obyte hub.",
      handler: async (_args, { client }) => client.getLastMci()
    },
    {
      name: "obyte_get_peers",
      title: "Get Hub Peers",
      schema: schemas.networkOnlySchema,
      description: "Raw hub read. Returns peers known by the selected Obyte hub. Use for network diagnostics, not address analysis.",
      handler: async (_args, { client }) => client.getPeers()
    },
    {
      name: "obyte_get_witnesses",
      title: "Get Witnesses",
      schema: schemas.getWitnessesSchema,
      description:
        "Raw hub read. Returns witnesses for the selected network. Results are cached in memory for 10 minutes per network+hub unless update is true.",
      handler: async (args, { client }) => client.getWitnesses(args.update)
    },
    {
      name: "obyte_get_joint",
      title: "Get Joint",
      schema: schemas.getJointSchema,
      description: "Raw hub read. Fetches the joint for one unit hash from the selected hub.",
      handler: async (args, { client }) => client.getJoint(args.unit)
    },
    {
      name: "obyte_get_balances",
      title: "Get Balances",
      schema: schemas.addressesSchema,
      amounts: true,
      description: "Raw hub read. Fetches balances for 1 to 20 addresses. Use obyte_get_portfolio_summary for agent-friendly summaries with decimals-adjusted display totals.",
      handler: async (args, { client }) => client.getBalances(args.addresses)
    },
    {
      name: "obyte_get_profile_units",
      title: "Get Profile Units",
      schema: schemas.addressesSchema,
      description: "Raw hub read. Returns profile units for 1 to 20 addresses when available.",
      handler: async (args, { client }) => client.getProfileUnits(args.addresses)
    },
    {
      name: "obyte_get_definition",
      title: "Get Address Definition",
      schema: schemas.getDefinitionSchema,
      description: "Raw hub read. Returns the definition of one Obyte address.",
      handler: async (args, { client }) => client.getDefinition(args.address)
    },
    {
      name: "obyte_get_data_feed",
      title: "Get Data Feed",
      schema: schemas.getDataFeedSchema,
      description: "Raw hub read. Reads a data feed by oracle addresses and feed name. Oracle arrays are limited to 10 entries.",
      handler: async (args, { client }) => client.getDataFeed(args.oracles, args.feed_name, args.ifnone)
    },
    {
      name: "obyte_get_history",
      title: "Get Address History",
      schema: schemas.getHistorySchema,
      amounts: true,
      description:
        "Raw hub read. Returns history for 1 to 20 addresses. If witnesses are omitted, the server uses the 10-minute witnesses cache or fetches witnesses from the hub.",
      handler: async (args, { client }) => client.getHistory(args.addresses, args.witnesses, args.update_witnesses)
    },
    {
      name: "obyte_get_attestation",
      title: "Get Attestation",
      schema: schemas.getAttestationSchema,
      description: "Raw hub read. Looks up one attestation by attestor address, field, and value.",
      handler: async (args, { client }) => client.getAttestation(args.attestor_address, args.field, args.value)
    },
    {
      name: "obyte_get_attestations",
      title: "Get Address Attestations",
      schema: schemas.getAttestationsSchema,
      description: "Raw hub read. Returns attestations associated with one address.",
      handler: async (args, { client }) => client.getAttestations(args.address)
    },
    {
      name: "obyte_get_aa_response_chain",
      title: "Get AA Response Chain",
      schema: schemas.triggerUnitSchema,
      amounts: true,
      description: "Raw hub read. Returns the autonomous-agent response chain for a trigger unit.",
      handler: async (args, { client }) => client.getAaResponseChain(args.trigger_unit)
    },
    {
      name: "obyte_get_aa_responses",
      title: "Get AA Responses",
      schema: schemas.aaOrAasSchema,
      amounts: true,
      description: "Raw hub read. Returns AA responses for one AA address or up to 20 AA addresses.",
      handler: async (args, { client }) => client.getAaResponses(args.aa ?? args.aas!)
    },
    {
      name: "obyte_get_aas_by_base_aas",
      title: "Get AAs By Base AAs",
      schema: schemas.baseAaOrAasSchema,
      description: "Raw hub read. Returns AAs derived from one base AA or up to 20 base AAs.",
      handler: async (args, { client }) => client.getAasByBaseAas(args.base_aa ?? args.base_aas!)
    },
    {
      name: "obyte_dry_run_aa",
      title: "Dry Run AA",
      schema: schemas.dryRunAaSchema,
      dryRun: true,
      amounts: true,
      description:
        "Raw hub dry run. Simulates triggering an autonomous agent with a JSON trigger payload. It does not sign or broadcast. Not retried by default and not marked idempotent.",
      handler: async (args, { client }) => client.dryRunAa(args.address, args.trigger)
    },
    {
      name: "obyte_execute_getter",
      title: "Execute AA Getter",
      schema: schemas.executeGetterSchema,
      description: "Raw hub read. Executes an autonomous-agent getter with optional JSON args and returns the getter result.",
      handler: async (args, { client }) => client.executeGetter(args.address, args.getter, args.args)
    },
    {
      name: "obyte_get_aa_balances",
      title: "Get AA Balances",
      schema: schemas.aaAddressSchema,
      amounts: true,
      description: "Raw hub read. Returns balances held by one autonomous agent address. Use obyte_analyze_aa for a decimals-aware summary.",
      handler: async (args, { client }) => client.getAaBalances(args.address)
    },
    {
      name: "obyte_get_aa_state_vars",
      title: "Get AA State Vars",
      schema: schemas.getAaStateVarsSchema,
      amounts: true,
      description:
        "Raw hub read. Returns autonomous-agent state variables, optionally bounded by prefix/range. State vars holding amounts are raw smallest units. Prefix length is limited to 128 characters. Map-like output is sorted by key.",
      handler: async (args, { client }) => client.getAaStateVars(args.address, args.var_prefix, args.var_prefix_from, args.var_prefix_to)
    }
  ];
}

function symbolTools(_context: RegisterContext): ToolDefinition[] {
  return [
    {
      name: "obyte_get_official_token_registry_address",
      title: "Get Token Registry Address",
      schema: schemas.registrySchema,
      description:
        "Returns the token registry address for the selected network. The mainnet default comes from obyte.js; custom and testnet registries must be explicitly trusted by the user.",
      handler: async (args, { network }) => ({
        network: network.network,
        token_registry_address: args.token_registry_address ?? network.tokenRegistryAddress ?? null,
        trust_model: "Registry mappings are metadata convenience, not proof of asset legitimacy."
      })
    },
    {
      name: "obyte_get_symbol_by_asset",
      title: "Get Symbol By Asset",
      schema: schemas.symbolByAssetSchema,
      description:
        "Resolves an Obyte asset id to a token symbol through the selected registry. base/null maps to GBYTE; unknown assets fall back to the first sanitized asset characters as in obyte.js.",
      handler: async (args, { client, network }) =>
        getSymbolByAsset(client, args.asset, {
          configuredRegistryAddress: network.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })
    },
    {
      name: "obyte_get_asset_by_symbol",
      title: "Get Asset By Symbol",
      schema: schemas.assetBySymbolSchema,
      description:
        "Resolves a token symbol to an Obyte asset id through the selected registry. GBYTE, MBYTE, KBYTE, and BYTE resolve to base.",
      handler: async (args, { client, network }) =>
        getAssetBySymbol(client, args.symbol, {
          configuredRegistryAddress: network.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })
    },
    {
      name: "obyte_get_decimals_by_symbol_or_asset",
      title: "Get Decimals By Symbol Or Asset",
      schema: schemas.decimalsSchema,
      description:
        "Returns decimals for base aliases or a registry-known token symbol/asset. base and GBYTE use 9, MBYTE 6, KBYTE 3, BYTE 0. Registry data is untrusted metadata.",
      handler: async (args, { client, network }) =>
        getDecimalsBySymbolOrAsset(client, args.symbol_or_asset, {
          configuredRegistryAddress: network.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })
    }
  ];
}
