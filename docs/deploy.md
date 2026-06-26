# Deploying the backend

The reTerminal device fetches `DASHBOARD_URL` over HTTPS, so the backend needs a
public HTTPS endpoint. The backend is a normal long-running Node/Express server
(it holds an in-memory + on-disk cache), so a container host like **Railway**
(recommended) or Render fits it directly — no code changes, no serverless
caveats. Config files for both are included.

## Railway (recommended)

1. Push this repo to GitHub.
2. In Railway: **New Project** → **Deploy from GitHub repo** → pick this repo.
3. In the service **Settings**, set **Root Directory** to `backend` (the app
   lives in a subfolder). Railway then reads `backend/railway.json` and uses
   Nixpacks → `npm install` → `npm start`, with health check `/healthz`.
4. In **Variables**, add `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`).
5. Generate a public domain (**Settings → Networking → Generate Domain**). You
   get a URL like `https://inkscores-production.up.railway.app`. The device's
   `DASHBOARD_URL` is then:

   ```
   https://inkscores-production.up.railway.app/api/dashboard.json
   ```

Railway services stay running (no idle spin-down while you have credit/usage),
so refreshes are reliable and there's no cold-start vs. the device's 8s timeout.

### Persist the editorial cache (recommended)

The AI recap + hot/cold lists are generated once per game and cached on disk.
The container filesystem is **ephemeral**, so without a volume that cache is
wiped on every restart/redeploy and each game's summary gets regenerated (a new
OpenAI call, and a different sentence each time). To make it stable:

1. In the service: **Settings → Volumes → Add Volume**, mount path `/data`.
2. In **Variables**, add `EDITORIAL_CACHE_DIR=/data`.

Now each summary is generated once and survives restarts. Delete the volume's
`editorial.json` if you ever want to force regeneration.

## Render (alternative, Blueprint)

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
