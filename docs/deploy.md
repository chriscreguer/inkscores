# Deploying the backend

The reTerminal device fetches `DASHBOARD_URL` over HTTPS, so the backend needs a
public HTTPS endpoint. This repo ships a [Render](https://render.com) Blueprint
(`render.yaml`) for a one-click deploy, but any Node host works.

## Render (Blueprint)

1. Push this repo to GitHub (already done if you cloned from there).
2. In Render: **New +** → **Blueprint** → select this repo. Render reads
   `render.yaml` and creates the `inkscores-backend` web service
   (`rootDir: backend`, `npm install`, `npm start`, health check `/healthz`).
3. Open the service → **Environment** → add `OPENAI_API_KEY` (and optionally
   `OPENAI_MODEL`). The key is never committed.
4. After the first deploy you get a URL like
   `https://inkscores-backend.onrender.com`. Your device's `DASHBOARD_URL` is:

   ```
   https://inkscores-backend.onrender.com/api/dashboard.json
   ```

5. Sanity-check it in a browser:
   - `…/healthz` → `{"ok":true}`
   - `…/api/dashboard.json` → the live dashboard JSON
   - `…/preview` → the device-accurate preview

## Free-tier cold starts (important)

Render's **free** web services spin down after ~15 minutes idle and take
~30–60s to wake. The firmware's HTTP timeout is **8s**, so the first poll after
an idle period will time out — the device then renders its last cached payload
and retries on its next wake. That's tolerable (the dashboard is glanceable, not
live), but for reliable refreshes either:

- use a paid always-on instance (no spin-down), **or**
- keep it warm with a free uptime monitor pinging `/healthz` every ~10 minutes.

## Notes

- The server binds `process.env.PORT` (Render sets this automatically).
- Editorial recaps are cached to `backend/.cache/` (ephemeral on Render — it
  regenerates after a redeploy, which is fine since it's keyed per game).
- `tsx` runs the TypeScript directly in production (it's a runtime dependency),
  so there's no separate build/compile step to maintain.
