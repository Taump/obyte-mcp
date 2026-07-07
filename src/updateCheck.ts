import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";

/**
 * Lightweight npm-registry version check so agents can tell users when a newer
 * obyte-mcp is published. Fail-silent, 3s timeout, one request per process,
 * opt-out via OBYTE_NO_UPDATE_CHECK (or the conventional NO_UPDATE_NOTIFIER).
 */

export interface UpdateStatus {
  current: string;
  latest: string | null;
  /** true = newer version published; false = up to date; null = check disabled or failed. */
  update_available: boolean | null;
  note?: string;
}

const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_TIMEOUT_MS = 3_000;

let cached: Promise<UpdateStatus> | undefined;

export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OBYTE_NO_UPDATE_CHECK?.trim()) || Boolean(env.NO_UPDATE_NOTIFIER?.trim());
}

export function checkForUpdate(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<UpdateStatus> {
  if (isUpdateCheckDisabled(env)) {
    return Promise.resolve({
      current: PACKAGE_VERSION,
      latest: null,
      update_available: null,
      note: "Update check disabled via OBYTE_NO_UPDATE_CHECK."
    });
  }
  cached ??= fetchLatest(fetchImpl);
  return cached;
}

/** Test hook: clears the per-process cache. */
export function resetUpdateCheckCache(): void {
  cached = undefined;
}

async function fetchLatest(fetchImpl: typeof fetch): Promise<UpdateStatus> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(REGISTRY_URL, {
        headers: { Accept: "application/json", "User-Agent": `${PACKAGE_NAME}/${PACKAGE_VERSION} (update check)` },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return checkFailed();

    const payload = (await response.json()) as { version?: unknown };
    const latest = typeof payload?.version === "string" ? payload.version : null;
    if (!latest) return checkFailed();

    const updateAvailable = compareVersions(latest, PACKAGE_VERSION) > 0;
    const status: UpdateStatus = { current: PACKAGE_VERSION, latest, update_available: updateAvailable };
    if (updateAvailable) {
      status.note = `A newer obyte-mcp ${latest} is published (running ${PACKAGE_VERSION}). Unpinned npx configs pick it up on the next client restart; tell the user an update is available.`;
    }
    return status;
  } catch {
    return checkFailed();
  }
}

function checkFailed(): UpdateStatus {
  return {
    current: PACKAGE_VERSION,
    latest: null,
    update_available: null,
    note: "Update check failed (offline or registry unreachable); this does not affect Obyte tools."
  };
}

/** Compares the numeric major.minor.patch parts; prerelease tails are ignored. */
function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .split(".")
      .slice(0, 3)
      .map((part) => {
        const numeric = Number.parseInt(part, 10);
        return Number.isFinite(numeric) ? numeric : 0;
      });
  const [aParts, bParts] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) {
    const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
