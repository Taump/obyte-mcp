import { beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_VERSION } from "../src/constants.js";
import { checkForUpdate, isUpdateCheckDisabled, resetUpdateCheckCache } from "../src/updateCheck.js";

function registryFetch(version: string) {
  return vi.fn(async () => new Response(JSON.stringify({ version }), { status: 200 })) as unknown as typeof fetch;
}

describe("updateCheck", () => {
  beforeEach(() => resetUpdateCheckCache());

  it("reports an available update when the registry has a newer version", async () => {
    const status = await checkForUpdate(registryFetch("99.0.0"), {});
    expect(status).toMatchObject({ current: PACKAGE_VERSION, latest: "99.0.0", update_available: true });
    expect(status.note).toContain("99.0.0");
  });

  it("reports up to date for the same version", async () => {
    const status = await checkForUpdate(registryFetch(PACKAGE_VERSION), {});
    expect(status.update_available).toBe(false);
  });

  it("does not flag older published versions", async () => {
    const status = await checkForUpdate(registryFetch("0.0.1"), {});
    expect(status.update_available).toBe(false);
  });

  it("fails silent on network errors", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const status = await checkForUpdate(failing, {});
    expect(status.update_available).toBeNull();
    expect(status.latest).toBeNull();
  });

  it("caches the result per process", async () => {
    const fetchMock = registryFetch("99.0.0");
    await checkForUpdate(fetchMock, {});
    await checkForUpdate(fetchMock, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can be disabled via env without any network call", async () => {
    const fetchMock = registryFetch("99.0.0");
    expect(isUpdateCheckDisabled({ OBYTE_NO_UPDATE_CHECK: "1" })).toBe(true);
    const status = await checkForUpdate(fetchMock, { OBYTE_NO_UPDATE_CHECK: "1" });
    expect(status.update_available).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
