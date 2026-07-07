import { z } from "zod/v4";
import { MAX_JSON_PAYLOAD_BYTES } from "./constants.js";
import { jsonByteLength } from "./jsonUtils.js";

const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)])
);

const boundedJson = jsonValue.refine((value) => jsonByteLength(value) <= MAX_JSON_PAYLOAD_BYTES, {
  message: `JSON payload must not exceed ${MAX_JSON_PAYLOAD_BYTES} bytes`
});

export const stringValue = z.string().min(1).max(4096);
export const address = z.string().min(1).max(128);
export const unit = z.string().min(1).max(128);
export const asset = z.string().min(1).max(128);
export const symbol = z.string().min(1).max(64);
export const varPrefix = z.string().min(1).max(128);
export const optionalRegistry = z.string().min(1).max(128).optional();

export const emptySchema = z.object({}).strict();
export const networkInfoSchema = emptySchema;
export const getWitnessesSchema = z.object({ update: z.boolean().optional().default(false) }).strict();
export const getJointSchema = z.object({ unit }).strict();
export const addressesSchema = z.object({ addresses: z.array(address).min(1).max(20) }).strict();
export const getDefinitionSchema = z.object({ address }).strict();
export const getDataFeedSchema = z
  .object({
    oracles: z.array(address).min(1).max(10),
    feed_name: stringValue,
    ifnone: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
  })
  .strict();
export const getHistorySchema = z
  .object({
    addresses: z.array(address).min(1).max(20),
    witnesses: z.array(address).min(1).max(20).optional(),
    update_witnesses: z.boolean().optional().default(false)
  })
  .strict();
export const getAttestationSchema = z.object({ attestor_address: address, field: stringValue, value: stringValue }).strict();
export const getAttestationsSchema = z.object({ address }).strict();
export const triggerUnitSchema = z.object({ trigger_unit: unit }).strict();
export const aaOrAasSchema = z
  .object({
    aa: address.optional(),
    aas: z.array(address).min(1).max(20).optional()
  })
  .strict()
  .refine((value) => Boolean(value.aa) !== Boolean(value.aas), { message: "Provide exactly one of aa or aas" });
export const baseAaOrAasSchema = z
  .object({
    base_aa: address.optional(),
    base_aas: z.array(address).min(1).max(20).optional()
  })
  .strict()
  .refine((value) => Boolean(value.base_aa) !== Boolean(value.base_aas), { message: "Provide exactly one of base_aa or base_aas" });
export const dryRunAaSchema = z.object({ address, trigger: boundedJson }).strict();
export const executeGetterSchema = z.object({ address, getter: stringValue, args: boundedJson.optional() }).strict();
export const aaAddressSchema = z.object({ address }).strict();
export const getAaStateVarsSchema = z
  .object({
    address,
    var_prefix: varPrefix.optional(),
    var_prefix_from: varPrefix.optional(),
    var_prefix_to: varPrefix.optional()
  })
  .strict();

export const registrySchema = z.object({ token_registry_address: optionalRegistry }).strict();
export const symbolByAssetSchema = z.object({ asset: z.union([asset, z.null()]), token_registry_address: optionalRegistry }).strict();
export const assetBySymbolSchema = z.object({ symbol, token_registry_address: optionalRegistry }).strict();
export const decimalsSchema = z.object({ symbol_or_asset: stringValue, token_registry_address: optionalRegistry }).strict();
export const resolveAssetSchema = z.object({ value: stringValue, token_registry_address: optionalRegistry }).strict();

export const analyzeAddressSchema = z
  .object({
    address,
    include_history: z.boolean().optional().default(false),
    include_definition: z.boolean().optional().default(true),
    include_attestations: z.boolean().optional().default(true)
  })
  .strict();
export const analyzeUnitSchema = z.object({ unit, include_aa_response_chain: z.boolean().optional().default(true) }).strict();
export const analyzeAaSchema = z
  .object({
    address,
    state_var_prefix: varPrefix.optional(),
    include_balances: z.boolean().optional().default(true),
    include_responses: z.boolean().optional().default(false)
  })
  .strict();
export const prepareAaDryRunSchema = dryRunAaSchema;
export const portfolioSummarySchema = z
  .object({
    addresses: z.array(address).min(1).max(20),
    token_registry_address: optionalRegistry,
    resolve_symbols: z.boolean().optional().default(true)
  })
  .strict();
