type Now = () => number;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Minimal in-memory cache with per-key TTLs and stale-if-error behavior.
 *
 * `getOrLoad` returns a cached value while fresh; once expired it runs the
 * loader, and if the loader throws it falls back to the last good value (if
 * any) so a flaky upstream never takes down the dashboard. The clock is
 * injectable for deterministic tests.
 */
export class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  constructor(private now: Now = () => Date.now()) {}

  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const existing = this.store.get(key) as Entry<T> | undefined;
    if (existing && this.now() < existing.expiresAt) {
      return existing.value;
    }

    try {
      const value = await loader();
      this.store.set(key, { value, expiresAt: this.now() + ttlMs });
      return value;
    } catch (err) {
      if (existing) return existing.value; // stale-if-error
      throw err;
    }
  }

  /** Read a cached value ignoring TTL (used as a last-resort fallback). */
  peek<T>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  clear(): void {
    this.store.clear();
  }
}

/** Cache TTLs (ms) by data freshness context, per the manifesto. */
export const CACHE_TTLS = {
  liveGame: 60_000,
  gameDay: 300_000,
  activeSeason: 1_800_000,
  offseason: 21_600_000,
} as const;
