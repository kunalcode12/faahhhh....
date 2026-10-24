# Beaufort

Beaufort is a small web app for the day-ahead desk of a UK energy supplier. The desk buys tomorrow's
power in the GB day-ahead auctions, and how much it needs depends on how much wind there will be. The
app answers two questions about national wind generation:

1. **What did the forecast say when we had to bid?** For any delivery day, it shows the NESO wind
   forecast that was actually available before the auction closed, hour by hour, plus a calibrated
   version and an 80% range.
2. **How far should we trust it?** It scores those forecasts against metered output: typical
   error, bias, tail risk, and how the error changes with lead time, time of day and wind level.

The data is limited to what the brief allows: national wind outturn (Elexon `FUELHH`) and wind
forecasts (Elexon `WINDFOR`), for purchase decisions made in January 2026. A decision on day X buys
power for day X+1, so that means **delivery days 2 January to 1 February 2026**.

**Live app:** https://beaufort-tau.vercel.app · **API docs:** https://beaufort-api-u9j4.onrender.com/api/docs

The API runs on Render's free plan, which sleeps when idle. If nobody has used it for a while, the
first page load can take about a minute while it wakes up.

![Day-ahead view](docs/images/day-ahead.png)

## What's in it

- **Day-ahead** (`/`): pick a delivery day and an auction (EPEX 60-min at 09:20, N2EX at 09:50,
  EPEX 30-min at 15:30). You get the forecast run that was published before that gate, the
  calibrated forecast with its P10–P90 range, the metered outturn, and how the forecast moved across
  every run published in the two days before delivery. Left/right arrow keys step through days.
- **Accuracy** (`/accuracy`): error statistics for any range of delivery days, either "at the auction
  gate" (what you could actually bid on) or at a fixed lead time of 0–48 hours. It includes charts
  by lead time, hour of day and wind level, the error distribution, a day-by-day table, and a short
  list of takeaways worked out from the numbers.
- **Method** (`/method`): plain-English definitions, assumptions and data health.

Every view is a URL (`/?date=2026-01-15&gate=0950`), so a view can be shared as a link. Every chart has
a table view, and the tables export to CSV.

## What the data says

Numbers below are for the N2EX gate (09:50) over all 31 delivery days:

- The typical hourly miss (mean absolute error) is **2.0 GW**, about 18% of the wind energy
  actually delivered. One hour in ten misses by more than 4.2 GW.
- The forecast **runs hot**. It was too high in 84% of hours, by 1.7 GW on average, and the gap grows
  with wind speed. When it forecast 20–22 GW, only 78% turned up, against 98% at 6–8 GW. Metered output
  never went above about 18 GW while forecasts reached 21 GW. That pattern fits curtailment from grid
  constraints, which matters because the expensive mistake for a buyer is counting on wind that doesn't
  arrive.
- Scaling each day's forecast by what the previous 14 settled days actually delivered brings the
  typical miss down to **1.3 GW (−35%)**. This uses only data available at the gate. 82% of hours land
  inside the 80% range built from the same history, so the range is honest.
- Fresher forecasts help, but not much. The miss grows from about 1.7 GW for a run published an hour
  ahead to 2.4 GW for one published 48 hours ahead.

## Running it

### With Docker

```bash
docker compose up --build
```

- App: http://localhost:3000
- API docs (Swagger): http://localhost:8000/api/docs

The backend image includes a data snapshot, so it starts in about a second and doesn't need Elexon to be up.

### Without Docker

You need Python 3.12+ and Node 20.9+ (I used Python 3.13/3.15 and Node 24).

Backend, in one terminal:

```bash
cd backend
python -m venv env
env\Scripts\activate            # Windows. On macOS/Linux: source env/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

Frontend, in another:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The frontend forwards `/api/*` to `http://127.0.0.1:8000`; set
`BACKEND_URL` if the API runs somewhere else. Both apps read their settings from environment variables;
the `.env.example` files list them all.

### Refreshing the data

`backend/data/snapshot.json.gz` is produced by the same ingestion code the app uses:

```bash
cd backend
python -m app.cli ingest     # about 3 seconds: fetches, validates, de-duplicates, writes the snapshot
python -m app.cli info       # prints what's in it
```

If the snapshot is missing, the API fetches from Elexon on startup and saves one (`DATA_MODE=auto`, the
default).

## Tests and checks

```bash
# backend
cd backend
ruff check . && ruff format --check .
mypy app main.py                 # strict mode
pytest --cov                     # 81 tests, 98% coverage

# frontend
cd frontend
npm run check                    # eslint + typecheck + 46 tests
npm run build
```

CI (`.github/workflows/ci.yml`) runs all of that, then builds both Docker images and smoke-tests the
stack. `make check` does the same locally on macOS/Linux.

## Files and directories

```
.
├── backend/                     FastAPI service (Python)
│   ├── app/
│   │   ├── main.py              app factory: middleware, error handlers, routes, data loading at startup
│   │   ├── cli.py               python -m app.cli ingest | info
│   │   ├── core/                settings, JSON logging, error format, HTTP middleware, rate limiting
│   │   ├── domain/              pure logic: settlement calendar, in-memory data store,
│   │   │                        "which forecast counts", metrics, calibration, auction presets
│   │   ├── ingestion/           Elexon client (retries/backoff), validation and clean-up, snapshot file
│   │   ├── services/            day-ahead and accuracy use cases, dataset lifecycle, /meta
│   │   ├── schemas/             response models: the API contract
│   │   └── api/                 routes and shared request parameters
│   ├── data/snapshot.json.gz    outturn + every forecast run, 3 Dec 2025 to 1 Feb 2026 (222 KB)
│   ├── tests/                   unit tests, API tests, golden-number tests on the real data
│   ├── scripts/loadtest.py      small load generator
│   ├── main.py                  shim so `uvicorn main:app` also works
│   ├── Dockerfile               container image (Docker Compose and Render)
│   ├── pyproject.toml           project metadata, ruff/mypy/pytest config
│   ├── requirements.txt         pinned runtime dependencies (requirements-dev.txt adds tools)
│   └── .env.example             every setting, with defaults
├── frontend/                    Next.js 16 app (React 19, TypeScript)
│   ├── app/                     pages (/, /accuracy, /method), layout, error and 404 pages,
│   │                            api/[...path]/route.ts: proxy to the backend
│   ├── components/
│   │   ├── ui/                  buttons, segmented control, stat tiles, skeletons, error panels
│   │   ├── charts/              chart kit (legend, tooltip, table view) and the charts themselves
│   │   ├── day-ahead/           the day-ahead page
│   │   ├── accuracy/            the accuracy page
│   │   ├── method/              live data-health panel
│   │   └── layout/              header, footer, offline banner, progress bar
│   ├── lib/                     API client + Zod schemas + query definitions, retry policy,
│   │                            formatting, URL state, chart scales, plain-English insights, hooks
│   ├── tests/                   Vitest + Testing Library
│   ├── Dockerfile               standalone Next.js server image
│   ├── next.config.ts           Cache Components, security headers, standalone output for Docker
│   └── AGENTS.md                notes Next.js writes for coding agents
├── docs/
│   ├── ARCHITECTURE.md          how it's built, file by file, and why
│   ├── DESIGN.md                product and UI decisions, the data analysis, how to pitch it
│   ├── DEVELOPMENT_PRACTICES.md testing, typing, performance work, security, conventions
│   ├── architecture.excalidraw  hand-drawn system diagram (open it at excalidraw.com)
│   └── images/                  screenshots
├── docker-compose.yml           the whole stack locally
├── render.yaml                  Render deployment of the backend (free plan, Docker)
├── vercel.json                  alternative: frontend and backend in one Vercel project
├── Makefile                     shortcuts for macOS/Linux
└── .github/workflows/ci.yml     CI pipeline
```

## API

All under `/api`, documented at `/api/docs`. Responses are JSON, errors are
[problem details](https://www.rfc-editor.org/rfc/rfc9457), and data responses carry ETags and cache headers.

| Endpoint | What it returns |
|---|---|
| `GET /api/v1/meta` | coverage, auction presets, defaults, data health |
| `GET /api/v1/day-ahead/{date}?gate=09:50&lookback_days=14` | the forecast available at the gate for one delivery day, calibrated forecast, P10–P90, outturn |
| `GET /api/v1/day-ahead/{date}/vintages?gate=09:50` | every forecast run for that day and how it changed |
| `GET /api/v1/accuracy/summary?start&end&mode=gate\|horizon&gate&horizon_hours` | error statistics and breakdowns |
| `GET /api/v1/accuracy/series?...` | forecast vs actual time series |
| `GET /api/v1/accuracy/horizons?start&end` | error by lead time, 0–48 h, across every run |
| `GET /api/health/live`, `/api/health/ready` | liveness and readiness probes |

## Deploying

The live setup is the **backend on Render** (free plan, Docker) and the **frontend on Vercel**.

### Backend on Render

`render.yaml` is a Render Blueprint. It builds `backend/Dockerfile` and runs it on the free plan in
Frankfurt, with `/api/health/ready` as the health check.

1. In Render: *New → Blueprint*, connect GitHub and pick this repo, then *Apply*.
2. When the deploy is live, `https://<your-service>.onrender.com/api/health/ready` should return
   `{"status":"ready", ...}`.

### Frontend on Vercel

1. *Add New → Project*, import the same repo, and set the **Root Directory to `frontend`**.
2. Add the environment variable `BACKEND_URL` = the Render URL (no trailing slash).
3. Deploy.

The frontend's `/api/*` route forwards to `BACKEND_URL`, so the browser never talks to Render
directly and there's no CORS to configure.

**About the free plan:** Render puts the backend to sleep after 15 minutes without traffic, and the
first request afterwards takes about a minute. The proxy waits and retries while it wakes, and the
page tells the user what's happening, so a cold start shows a slow load rather than an error.

### Alternative: everything on Vercel

`vercel.json` also describes a single Vercel project using
[Vercel Services](https://vercel.com/docs/services): `/api/*` to FastAPI, everything else to Next.js.
To use it, import the repo with the Root Directory left at the repo root.

## Decisions worth knowing about

- **"Decisions made in January"** means delivery days 2 Jan – 1 Feb. The snapshot also holds outturn
  and forecasts from 3 December. It's used only to calibrate early-January days with the history a
  trader would really have had; the app never shows those days.
- **Which forecast counts:** the latest run published strictly before the gate on the day before
  delivery. A run published at the exact moment the auction closes is too late to act on.
- **Hourly vs half-hourly:** WINDFOR is hourly and FUELHH half-hourly. Errors are scored on the hour,
  where both exist, and nothing is interpolated. The charts still show the half-hourly outturn.
- **Snapshot instead of a database:** the data is small (about 40k rows) and historical, so it lives in
  memory with indexes. A typical request takes 1–4 ms to compute the first time and under 0.2 ms after
  that. Details are in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Use of AI tools

I used an AI coding assistant (Claude Code, by Anthropic) throughout this project. I used it to
explore the Elexon data, talk through design options, and write and review much of the code, the
tests and these docs. The analysis behind the product decisions (forecast bias, the calibration
backtest) was done with it on the real data. I ran the tests, the load test and the visual checks
myself before accepting anything, and the scope and design calls are mine.
