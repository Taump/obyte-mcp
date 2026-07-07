import { PACKAGE_NAME, PACKAGE_VERSION, WITNESSES_CACHE_TTL_MS } from "./constants.js";
import { ObyteMcpError } from "./errors.js";
import { ConcurrencyLimiter } from "./limiter.js";
import type { RuntimeConfig } from "./types.js";

type FetchLike = typeof fetch;

export interface HubRequestOptions {
  retry?: boolean;
}

export interface WitnessesCacheInfo {
  hasValue: boolean;
  expiresAt?: string;
  ttlMs: number;
}

interface WitnessesCacheEntry {
  key: string;
  value: unknown;
  expiresAtMs: number;
}

export class ObyteHttpClient {
  private readonly limiter: ConcurrencyLimiter;
  private witnessesCache?: WitnessesCacheEntry;
  retryCount = 0;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.limiter = new ConcurrencyLimiter(config.maxConcurrency);
  }

  getWitnessesCacheInfo(): WitnessesCacheInfo {
    const now = Date.now();
    const cache = this.witnessesCache;
    if (!cache || cache.expiresAtMs <= now || cache.key !== this.cacheKey()) {
      return { hasValue: false, ttlMs: WITNESSES_CACHE_TTL_MS };
    }
    return {
      hasValue: true,
      expiresAt: new Date(cache.expiresAtMs).toISOString(),
      ttlMs: WITNESSES_CACHE_TTL_MS
    };
  }

  async getLastMci(): Promise<unknown> {
    return this.request("get_last_mci");
  }

  async getPeers(): Promise<unknown> {
    return this.request("get_peers");
  }

  async getWitnesses(update = false): Promise<unknown> {
    const now = Date.now();
    const cache = this.witnessesCache;
    if (!update && cache && cache.key === this.cacheKey() && cache.expiresAtMs > now) {
      return cache.value;
    }
    const witnesses = await this.request("get_witnesses");
    this.witnessesCache = {
      key: this.cacheKey(),
      value: witnesses,
      expiresAtMs: now + WITNESSES_CACHE_TTL_MS
    };
    return witnesses;
  }

  async getJoint(unit: string): Promise<unknown> {
    const data = await this.request("get_joint", { unit });
    return isRecord(data) && "joint" in data ? data.joint : data;
  }

  async getBalances(addresses: string[]): Promise<unknown> {
    return this.request("get_balances", { addresses });
  }

  async getProfileUnits(addresses: string[]): Promise<unknown> {
    return this.request("get_profile_units", { addresses });
  }

  async getDefinition(address: string): Promise<unknown> {
    return this.request("get_definition", { address });
  }

  async getDataFeed(oracles: string[], feed_name: string, ifnone?: string | number | boolean | null): Promise<unknown> {
    return this.request("get_data_feed", { oracles, feed_name, ifnone });
  }

  async getHistory(addresses: string[], witnesses?: string[], updateWitnesses = false): Promise<unknown> {
    const witnessesList = witnesses ?? (await this.getWitnesses(updateWitnesses));
    return this.request("get_history", { addresses, witnesses: witnessesList });
  }

  async getAttestation(attestor_address: string, field: string, value: string): Promise<unknown> {
    return this.request("get_attestation", { attestor_address, field, value });
  }

  async getAttestations(address: string): Promise<unknown> {
    return this.request("get_attestations", { address });
  }

  async getAaResponseChain(trigger_unit: string): Promise<unknown> {
    return this.request("get_aa_response_chain", { trigger_unit });
  }

  async getAaResponses(aaOrAas: string | string[]): Promise<unknown> {
    return this.request("get_aa_responses", typeof aaOrAas === "string" ? { aa: aaOrAas } : { aas: aaOrAas });
  }

  async getAasByBaseAas(aaOrAas: string | string[]): Promise<unknown> {
    return this.request("get_aas_by_base_aas", typeof aaOrAas === "string" ? { base_aa: aaOrAas } : { base_aas: aaOrAas });
  }

  async dryRunAa(address: string, trigger: unknown): Promise<unknown> {
    return this.request("dry_run_aa", { address, trigger }, { retry: false });
  }

  async executeGetter(address: string, getter: string, args?: unknown): Promise<unknown> {
    const data = await this.request("execute_getter", { address, getter, args });
    return isRecord(data) && "result" in data ? data.result : data;
  }

  async getAaBalances(address: string): Promise<unknown> {
    const data = await this.request("get_aa_balances", { address });
    return isRecord(data) && "balances" in data ? data.balances : data;
  }

  async getAaStateVars(address: string, var_prefix?: string, var_prefix_from?: string, var_prefix_to?: string): Promise<unknown> {
    return this.request("get_aa_state_vars", { address, var_prefix, var_prefix_from, var_prefix_to });
  }

  async request(path: string, body: Record<string, unknown> = {}, options: HubRequestOptions = {}): Promise<unknown> {
    const retry = options.retry ?? true;
    const maxAttempts = retry ? 2 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.limiter.run(() => this.requestOnce(path, body));
        this.retryCount += attempt - 1;
        return result;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableError(error)) break;
        await sleep(backoffMs(attempt));
      }
    }

    if (lastError instanceof ObyteMcpError) throw lastError;
    throw new ObyteMcpError("NETWORK_ERROR", "Hub request failed", { path });
  }

  private async requestOnce(path: string, body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.hubAddress}/${path}`, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": `${PACKAGE_NAME}/${PACKAGE_VERSION}`
        },
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const parsed = parseJson(errorBody);
        const message = isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : "unknown error";
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new ObyteMcpError(retryable ? "NETWORK_ERROR" : "HUB_ERROR", message, { status: response.status, path });
      }

      const payload = (await response.json()) as unknown;
      if (isRecord(payload) && payload.error) {
        throw new ObyteMcpError("HUB_ERROR", String(payload.error), { path });
      }
      return isRecord(payload) && "data" in payload ? payload.data : payload;
    } catch (error) {
      if (error instanceof ObyteMcpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ObyteMcpError("TIMEOUT", `Hub request timed out after ${this.config.timeoutMs}ms`, { path });
      }
      throw new ObyteMcpError("NETWORK_ERROR", error instanceof Error ? error.message : "Network error", { path });
    } finally {
      clearTimeout(timeout);
    }
  }

  private cacheKey(): string {
    return `${this.config.network}:${this.config.hubAddress}`;
  }
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRetryableError(error: unknown): boolean {
  return error instanceof ObyteMcpError && (error.code === "TIMEOUT" || error.code === "NETWORK_ERROR");
}

function backoffMs(attempt: number): number {
  const base = attempt === 1 ? 250 : 750;
  return base + Math.floor(Math.random() * 100);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
