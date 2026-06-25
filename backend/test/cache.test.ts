import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "../src/cache.js";

describe("TtlCache", () => {
  it("returns a cached value within its TTL without re-running the loader", async () => {
    const cache = new TtlCache();
    const loader = vi.fn(async () => "fresh");

    const a = await cache.getOrLoad("k", 1000, loader);
    const b = await cache.getOrLoad("k", 1000, loader);

    expect(a).toBe("fresh");
    expect(b).toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL expires", async () => {
    let t = 0;
    const cache = new TtlCache(() => t);
    const loader = vi.fn(async () => `v${loader.mock.calls.length}`);

    await cache.getOrLoad("k", 1000, loader); // load at t=0
    t = 1500; // past TTL
    await cache.getOrLoad("k", 1000, loader); // reload

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("serves the last good value when a refresh loader throws (stale-if-error)", async () => {
    let t = 0;
    const cache = new TtlCache(() => t);

    const value = await cache.getOrLoad("k", 1000, async () => "good");
    t = 2000; // expired

    const stale = await cache.getOrLoad("k", 1000, async () => {
      throw new Error("upstream down");
    });

    expect(stale).toBe("good");
  });

  it("rethrows when the loader fails and there is no cached value", async () => {
    const cache = new TtlCache();
    await expect(
      cache.getOrLoad("k", 1000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
