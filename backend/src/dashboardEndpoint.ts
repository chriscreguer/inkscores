import {
  buildLiveDashboard,
  type AdapterRegistry,
  type FeaturedServices,
} from "./service.js";
import { DEFAULT_TIMEZONE } from "./config.js";
import type { Dashboard, Sport } from "./types.js";

const DEBUG_SPORTS: Sport[] = ["mlb", "nba", "ncaaf", "ncaamb"];

export interface DashboardQuery {
  mock?: string;
  debug?: string;
}

export interface ResolveOptions {
  query: DashboardQuery;
  adapters: AdapterRegistry;
  now: Date;
  /** Load a static mock dashboard by name (mlb | mixed). */
  loadMock: (name: string) => Dashboard | undefined;
  /** Featured services (real playoff tables + editorial) for MLB-only views. */
  featured?: FeaturedServices;
  /** Test seam to force the live build to throw. */
  buildOverride?: typeof buildLiveDashboard;
}

export interface DashboardResponse {
  dashboard: Dashboard;
  cacheControlSeconds: number;
}

/** A valid, contract-shaped fallback the device can always render. */
function degradedDashboard(now: Date): Dashboard {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    timezone: DEFAULT_TIMEZONE,
    refreshAfterSeconds: 3600,
    sections: [
      {
        type: "message",
        id: "data-error",
        title: "Sports data unavailable",
        body: "Showing cached data if available.",
      },
    ],
    footer: "Data issue",
  };
}

/**
 * Resolve a dashboard for an HTTP request. Handles mock and debug query modes
 * and guarantees a valid contract response even on total failure — the device
 * must never receive a raw error.
 */
export async function resolveDashboardResponse(
  options: ResolveOptions,
): Promise<DashboardResponse> {
  const { query, now } = options;

  // Mock mode: serve a static fixture, no upstream calls.
  if (query.mock) {
    const mock = options.loadMock(query.mock);
    if (mock) {
      return { dashboard: mock, cacheControlSeconds: mock.refreshAfterSeconds };
    }
  }

  const build = options.buildOverride ?? buildLiveDashboard;

  try {
    const debug = query.debug?.toLowerCase();
    const debugShowAll = debug === "all";
    const debugSports =
      debug && DEBUG_SPORTS.includes(debug as Sport) ? [debug as Sport] : undefined;

    const dashboard = await build({
      now,
      adapters: options.adapters,
      ...(options.featured ? options.featured : {}),
      ...(debugShowAll ? { debugShowAll: true } : {}),
      ...(debugSports ? { debugSports } : {}),
    });

    return { dashboard, cacheControlSeconds: dashboard.refreshAfterSeconds };
  } catch {
    const dashboard = degradedDashboard(now);
    return { dashboard, cacheControlSeconds: dashboard.refreshAfterSeconds };
  }
}
