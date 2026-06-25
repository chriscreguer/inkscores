import express, { type Express, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import {
  resolveDashboardResponse,
  type DashboardQuery,
} from "./dashboardEndpoint.js";
import {
  createDefaultAdapters,
  createDefaultFeaturedServices,
  type AdapterRegistry,
  type FeaturedServices,
} from "./service.js";
import { PREVIEW_HTML } from "./preview.js";
import type { Dashboard } from "./types.js";
import mlbMock from "./mock/dashboard.mlb.json" with { type: "json" };
import mixedMock from "./mock/dashboard.mixed.json" with { type: "json" };
import liveMock from "./mock/dashboard.live.json" with { type: "json" };
import nbaMock from "./mock/dashboard.nba.json" with { type: "json" };
import nflMock from "./mock/dashboard.nfl.json" with { type: "json" };
import ncaafMock from "./mock/dashboard.ncaaf.json" with { type: "json" };
import ncaambMock from "./mock/dashboard.ncaamb.json" with { type: "json" };
import madnessMock from "./mock/dashboard.madness.json" with { type: "json" };
import offseasonMock from "./mock/dashboard.offseason.json" with { type: "json" };
import errorMock from "./mock/dashboard.error.json" with { type: "json" };
import mlbCfbMock from "./mock/dashboard.mlb-cfb.json" with { type: "json" };
import mlbNbaMock from "./mock/dashboard.mlb-nba.json" with { type: "json" };
import nbaCfbMock from "./mock/dashboard.nba-cfb.json" with { type: "json" };
import nbaCbbMock from "./mock/dashboard.nba-cbb.json" with { type: "json" };
import winterMock from "./mock/dashboard.winter.json" with { type: "json" };
import featuredMock from "./mock/dashboard.featured.json" with { type: "json" };
import featuredCubsIdeaMock from "./mock/dashboard.featured-cubs-idea.json" with { type: "json" };
import logos from "./logos.json" with { type: "json" };

// Load backend/.env (e.g. OPENAI_API_KEY) if present, before any service reads
// process.env. Native to Node ≥20.12 — no dependency. Missing file is fine.
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the ambient environment
}

const MOCKS: Record<string, Dashboard> = {
  mlb: mlbMock as unknown as Dashboard,
  live: liveMock as unknown as Dashboard,
  nba: nbaMock as unknown as Dashboard,
  nfl: nflMock as unknown as Dashboard,
  ncaaf: ncaafMock as unknown as Dashboard,
  ncaamb: ncaambMock as unknown as Dashboard,
  madness: madnessMock as unknown as Dashboard,
  mixed: mixedMock as unknown as Dashboard,
  offseason: offseasonMock as unknown as Dashboard,
  error: errorMock as unknown as Dashboard,
  "mlb-cfb": mlbCfbMock as unknown as Dashboard,
  "mlb-nba": mlbNbaMock as unknown as Dashboard,
  "nba-cfb": nbaCfbMock as unknown as Dashboard,
  "nba-cbb": nbaCbbMock as unknown as Dashboard,
  winter: winterMock as unknown as Dashboard,
  featured: featuredMock as unknown as Dashboard,
  "featured-cubs-idea": featuredCubsIdeaMock as unknown as Dashboard,
};

function loadMock(name: string): Dashboard | undefined {
  return MOCKS[name];
}

export interface AppOptions {
  adapters?: AdapterRegistry;
  featured?: FeaturedServices;
  now?: () => Date;
}

export function createApp(options: AppOptions = {}): Express {
  const now = options.now ?? (() => new Date());
  const adapters = options.adapters ?? createDefaultAdapters(now);
  const featured = options.featured ?? createDefaultFeaturedServices(now);
  const app = express();

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Browser preview of the dashboard at 800x480, mimicking the ePaper panel.
  const sendPreview = (_req: Request, res: Response) => {
    res.type("html").send(PREVIEW_HTML);
  };
  app.get("/", sendPreview);
  app.get("/preview", sendPreview);

  // The quantized logo bitmaps (palette index per pixel) so the preview can
  // render the true device output rather than the full-colour CDN logos.
  app.get("/preview/logos.json", (_req: Request, res: Response) => {
    res.json(logos);
  });
  app.use(
    "/preview/team-logos",
    express.static(fileURLToPath(new URL("./mock/logos/", import.meta.url))),
  );

  app.get("/api/dashboard.json", async (req: Request, res: Response) => {
    const query = req.query as DashboardQuery;
    const { dashboard, cacheControlSeconds } = await resolveDashboardResponse({
      query,
      adapters,
      featured,
      now: now(),
      loadMock,
    });

    res.set(
      "Cache-Control",
      `public, max-age=${cacheControlSeconds}, stale-if-error=86400`,
    );
    res.json(dashboard);
  });

  return app;
}

// Start the server unless imported for tests.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  createApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`InkScores backend listening on http://localhost:${port}`);
    // eslint-disable-next-line no-console
    console.log(`  Preview:  http://localhost:${port}/preview`);
    // eslint-disable-next-line no-console
    console.log(`            http://localhost:${port}/preview?mock=mlb`);
    // eslint-disable-next-line no-console
    console.log(`            http://localhost:${port}/preview?debug=all`);
    // eslint-disable-next-line no-console
    console.log(`  JSON:     http://localhost:${port}/api/dashboard.json`);
  });
}
