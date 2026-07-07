import type { McpServer } from "@modelcontextprotocol/server";
import type { ZodType } from "zod/v4";
import { executeEnvelope } from "./envelope.js";
import { ObyteHttpClient } from "./obyteClient.js";
import { assertNoSecrets } from "./secretGuard.js";
import * as schemas from "./schemas.js";
import {
  getAssetBySymbol,
  getDecimalsBySymbolOrAsset,
  getOfficialTokenRegistryAddress,
  getSymbolByAsset,
  resolveAsset
} from "./symbols.js";
import { textResult } from "./toolResult.js";
import type { RuntimeConfig } from "./types.js";

type ToolSchema = ZodType;
type ToolHandler = (args: Record<string, any>) => Promise<unknown>;

interface RegisterContext {
  server: McpServer;
  client: ObyteHttpClient;
  config: RuntimeConfig;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: ToolSchema;
  handler: ToolHandler;
  dryRun?: boolean;
}

export function registerObyteTools(server: McpServer, client: ObyteHttpClient, config: RuntimeConfig): void {
  const context = { server, client, config };
  for (const tool of [...recommendedTools(context), ...rawTools(context), ...symbolTools(context)]) {
    registerTool(context, tool);
  }
}

function registerTool(context: RegisterContext, tool: ToolDefinition): void {
  context.server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
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
      const text = await executeEnvelope(context.config, tool.name, () => context.client.retryCount, async () => {
        assertNoSecrets(args);
        return tool.handler(args as Record<string, any>);
      });
      return textResult(text);
    }
  );
}

function recommendedTools(context: RegisterContext): ToolDefinition[] {
  const { client, config } = context;
  return [
    {
      name: "obyte_analyze_address",
      title: "Analyze Obyte Address",
      schema: schemas.analyzeAddressSchema,
      description:
        "Recommended first tool for understanding an Obyte address on the configured network. Returns balances and optional definition, profile units, attestations, and bounded history. Use this instead of several raw calls when an agent needs an address overview. Output is a stable JSON envelope and may be truncated.",
      handler: async (args) => {
        const [balances, profileUnits, definition, attestations, history] = await Promise.all([
          client.getBalances([args.address]),
          client.getProfileUnits([args.address]),
          args.include_definition ? client.getDefinition(args.address).catch((error) => ({ error: String(error) })) : undefined,
          args.include_attestations ? client.getAttestations(args.address).catch((error) => ({ error: String(error) })) : undefined,
          args.include_history ? client.getHistory([args.address]).catch((error) => ({ error: String(error) })) : undefined
        ]);
        return { address: args.address, balances, profile_units: profileUnits, definition, attestations, history };
      }
    },
    {
      name: "obyte_analyze_unit",
      title: "Analyze Obyte Unit",
      schema: schemas.analyzeUnitSchema,
      description:
        "Recommended tool for inspecting one Obyte unit. Fetches the joint and, when requested, follows the AA response chain for trigger units. Use when the user provides a unit hash and asks what happened. Output is hub data wrapped in a stable JSON envelope.",
      handler: async (args) => ({
        unit: args.unit,
        joint: await client.getJoint(args.unit),
        aa_response_chain: args.include_aa_response_chain ? await client.getAaResponseChain(args.unit).catch(() => null) : undefined
      })
    },
    {
      name: "obyte_analyze_aa",
      title: "Analyze Autonomous Agent",
      schema: schemas.analyzeAaSchema,
      description:
        "Recommended tool for summarizing an autonomous agent. Returns AA balances, selected state vars by prefix, and optional AA responses. Use for AA debugging or state inspection. State vars are sorted by key and output may be truncated.",
      handler: async (args) => ({
        address: args.address,
        balances: args.include_balances ? await client.getAaBalances(args.address) : undefined,
        state_vars: args.state_var_prefix ? await client.getAaStateVars(args.address, args.state_var_prefix) : undefined,
        aa_responses: args.include_responses ? await client.getAaResponses(args.address) : undefined
      })
    },
    {
      name: "obyte_resolve_asset",
      title: "Resolve Obyte Asset",
      schema: schemas.resolveAssetSchema,
      description:
        "Recommended tool for resolving an asset id or token symbol in the configured registry. Returns asset, symbol, and decimals when available. Registry mappings are convenience metadata, not proof of legitimacy.",
      handler: async (args) =>
        resolveAsset(client, args.value, {
          configuredRegistryAddress: config.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })
    },
    {
      name: "obyte_prepare_aa_dry_run",
      title: "Prepare AA Dry Run",
      schema: schemas.prepareAaDryRunSchema,
      dryRun: true,
      description:
        "Recommended tool for simulating an autonomous-agent trigger through the configured hub. This does not sign, broadcast, or mutate local state. Dry-run tools are not marked idempotent and are not retried by default.",
      handler: async (args) => ({ address: args.address, dry_run: await client.dryRunAa(args.address, args.trigger) })
    },
    {
      name: "obyte_get_portfolio_summary",
      title: "Get Portfolio Summary",
      schema: schemas.portfolioSummarySchema,
      description:
        "Recommended tool for summarizing balances for up to 20 addresses. Optionally enriches asset ids with symbols and decimals from the selected token registry. Use for user-facing balance explanations rather than raw get_balances.",
      handler: async (args) => {
        const balances = await client.getBalances(args.addresses);
        return {
          addresses: args.addresses,
          balances,
          symbol_resolution: args.resolve_symbols
            ? { note: "Use obyte_resolve_asset for per-asset details when the balance map contains non-base assets." }
            : undefined
        };
      }
    }
  ];
}

function rawTools(context: RegisterContext): ToolDefinition[] {
  const { client, config } = context;
  return [
    {
      name: "obyte_get_network_info",
      title: "Get Obyte Network Info",
      schema: schemas.networkInfoSchema,
      description:
        "Returns the effective MCP runtime configuration: network, hub URL, token registry, config precedence, limits, and witnesses cache metadata. Use before other calls when network selection matters.",
      handler: async () => ({ ...config, witnesses_cache: client.getWitnessesCacheInfo() })
    },
    {
      name: "obyte_get_last_mci",
      title: "Get Last MCI",
      schema: schemas.emptySchema,
      description: "Raw hub read. Returns the last main chain index known by the configured Obyte hub.",
      handler: async () => client.getLastMci()
    },
    {
      name: "obyte_get_peers",
      title: "Get Hub Peers",
      schema: schemas.emptySchema,
      description: "Raw hub read. Returns peers known by the configured Obyte hub. Use for network diagnostics, not address analysis.",
      handler: async () => client.getPeers()
    },
    {
      name: "obyte_get_witnesses",
      title: "Get Witnesses",
      schema: schemas.getWitnessesSchema,
      description:
        "Raw hub read. Returns witnesses for the configured network. Results are cached in memory for 10 minutes per network+hub unless update is true.",
      handler: async (args) => client.getWitnesses(args.update)
    },
    {
      name: "obyte_get_joint",
      title: "Get Joint",
      schema: schemas.getJointSchema,
      description: "Raw hub read. Fetches the joint for one unit hash from the configured hub.",
      handler: async (args) => client.getJoint(args.unit)
    },
    {
      name: "obyte_get_balances",
      title: "Get Balances",
      schema: schemas.addressesSchema,
      description: "Raw hub read. Fetches balances for 1 to 20 addresses. Use obyte_get_portfolio_summary for agent-friendly summaries.",
      handler: async (args) => client.getBalances(args.addresses)
    },
    {
      name: "obyte_get_profile_units",
      title: "Get Profile Units",
      schema: schemas.addressesSchema,
      description: "Raw hub read. Returns profile units for 1 to 20 addresses when available.",
      handler: async (args) => client.getProfileUnits(args.addresses)
    },
    {
      name: "obyte_get_definition",
      title: "Get Address Definition",
      schema: schemas.getDefinitionSchema,
      description: "Raw hub read. Returns the definition of one Obyte address.",
      handler: async (args) => client.getDefinition(args.address)
    },
    {
      name: "obyte_get_data_feed",
      title: "Get Data Feed",
      schema: schemas.getDataFeedSchema,
      description: "Raw hub read. Reads a data feed by oracle addresses and feed name. Oracle arrays are limited to 10 entries.",
      handler: async (args) => client.getDataFeed(args.oracles, args.feed_name, args.ifnone)
    },
    {
      name: "obyte_get_history",
      title: "Get Address History",
      schema: schemas.getHistorySchema,
      description:
        "Raw hub read. Returns history for 1 to 20 addresses. If witnesses are omitted, the server uses the 10-minute witnesses cache or fetches witnesses from the hub.",
      handler: async (args) => client.getHistory(args.addresses, args.witnesses, args.update_witnesses)
    },
    {
      name: "obyte_get_attestation",
      title: "Get Attestation",
      schema: schemas.getAttestationSchema,
      description: "Raw hub read. Looks up one attestation by attestor address, field, and value.",
      handler: async (args) => client.getAttestation(args.attestor_address, args.field, args.value)
    },
    {
      name: "obyte_get_attestations",
      title: "Get Address Attestations",
      schema: schemas.getAttestationsSchema,
      description: "Raw hub read. Returns attestations associated with one address.",
      handler: async (args) => client.getAttestations(args.address)
    },
    {
      name: "obyte_get_aa_response_chain",
      title: "Get AA Response Chain",
      schema: schemas.triggerUnitSchema,
      description: "Raw hub read. Returns the autonomous-agent response chain for a trigger unit.",
      handler: async (args) => client.getAaResponseChain(args.trigger_unit)
    },
    {
      name: "obyte_get_aa_responses",
      title: "Get AA Responses",
      schema: schemas.aaOrAasSchema,
      description: "Raw hub read. Returns AA responses for one AA address or up to 20 AA addresses.",
      handler: async (args) => client.getAaResponses(args.aa ?? args.aas!)
    },
    {
      name: "obyte_get_aas_by_base_aas",
      title: "Get AAs By Base AAs",
      schema: schemas.baseAaOrAasSchema,
      description: "Raw hub read. Returns AAs derived from one base AA or up to 20 base AAs.",
      handler: async (args) => client.getAasByBaseAas(args.base_aa ?? args.base_aas!)
    },
    {
      name: "obyte_dry_run_aa",
      title: "Dry Run AA",
      schema: schemas.dryRunAaSchema,
      dryRun: true,
      description:
        "Raw hub dry run. Simulates triggering an autonomous agent with a JSON trigger payload. It does not sign or broadcast. Not retried by default and not marked idempotent.",
      handler: async (args) => client.dryRunAa(args.address, args.trigger)
    },
    {
      name: "obyte_execute_getter",
      title: "Execute AA Getter",
      schema: schemas.executeGetterSchema,
      description: "Raw hub read. Executes an autonomous-agent getter with optional JSON args and returns the getter result.",
      handler: async (args) => client.executeGetter(args.address, args.getter, args.args)
    },
    {
      name: "obyte_get_aa_balances",
      title: "Get AA Balances",
      schema: schemas.aaAddressSchema,
      description: "Raw hub read. Returns balances held by one autonomous agent address.",
      handler: async (args) => client.getAaBalances(args.address)
    },
    {
      name: "obyte_get_aa_state_vars",
      title: "Get AA State Vars",
      schema: schemas.getAaStateVarsSchema,
      description:
        "Raw hub read. Returns autonomous-agent state variables, optionally bounded by prefix/range. Prefix length is limited to 128 characters. Map-like output is sorted by key.",
      handler: async (args) => client.getAaStateVars(args.address, args.var_prefix, args.var_prefix_from, args.var_prefix_to)
    }
  ];
}

function symbolTools(context: RegisterContext): ToolDefinition[] {
  const { client, config } = context;
  return [
    {
      name: "obyte_get_official_token_registry_address",
      title: "Get Token Registry Address",
      schema: schemas.registrySchema,
      description:
        "Returns the selected token registry address. The mainnet default comes from obyte.js; custom and testnet registries must be explicitly trusted by the user.",
      handler: async (args) => ({
        token_registry_address: args.token_registry_address ?? getOfficialTokenRegistryAddress(config.tokenRegistryAddress),
        trust_model: "Registry mappings are metadata convenience, not proof of asset legitimacy."
      })
    },
    {
      name: "obyte_get_symbol_by_asset",
      title: "Get Symbol By Asset",
      schema: schemas.symbolByAssetSchema,
      description:
        "Resolves an Obyte asset id to a token symbol through the selected registry. base/null maps to GBYTE; unknown assets fall back to the first sanitized asset characters as in obyte.js.",
      handler: async (args) =>
        getSymbolByAsset(client, args.asset, {
          configuredRegistryAddress: config.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })
    },
    {
      name: "obyte_get_asset_by_symbol",
      title: "Get Asset By Symbol",
      schema: schemas.assetBySymbolSchema,
      description:
        "Resolves a token symbol to an Obyte asset id through the selected registry. GBYTE, MBYTE, KBYTE, and BYTE resolve to base.",
      handler: async (args) =>
        getAssetBySymbol(client, args.symbol, {
          configuredRegistryAddress: config.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })
    },
    {
      name: "obyte_get_decimals_by_symbol_or_asset",
      title: "Get Decimals By Symbol Or Asset",
      schema: schemas.decimalsSchema,
      description:
        "Returns decimals for base aliases or a registry-known token symbol/asset. base and GBYTE use 9, MBYTE 6, KBYTE 3, BYTE 0. Registry data is untrusted metadata.",
      handler: async (args) =>
        getDecimalsBySymbolOrAsset(client, args.symbol_or_asset, {
          configuredRegistryAddress: config.tokenRegistryAddress,
          tokenRegistryAddress: args.token_registry_address
        })
    }
  ];
}
