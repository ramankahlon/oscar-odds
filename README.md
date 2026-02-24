# Oscar Odds 2027

[![CI](https://github.com/ramankahlon/oscar-odds/actions/workflows/ci.yml/badge.svg)](https://github.com/ramankahlon/oscar-odds/actions/workflows/ci.yml)
![Accessibility: WCAG 2.1 AA](https://img.shields.io/badge/Accessibility-WCAG%202.1%20AA-brightgreen)

A full-stack Oscar forecasting app that combines curated contender data, external source scraping, probabilistic scoring, and explainable UI analytics for the 2027 race.

## Architecture Diagram

```mermaid
flowchart LR
  subgraph Sources[External Sources]
    LB[Letterboxd list]
    TG[TheGamer article]
    RD[Reddit r/oscarrace]
    TMDB[TMDB API / pages]
  end

  subgraph Ingestion[Ingestion + Data Quality]
    POLL[scripts/poll-sources.mjs]
    CLEAN[scraper-utils.js\nentity matching + validation]
    SIG[(data/source-signals.json)]
    OBS[(data/scrape-observability.json)]
  end

  subgraph App[Node/Express Service]
    API[server.mjs\nforecast APIs + poster lookup]
    STORE[(data/forecast-store.json)]
    METRICS[/api/health + /api/metrics]
  end

  subgraph Frontend[Browser App]
    UI[index.html + styles.css + app.js]
    MODEL[Scoring + Rebalancing\nforecast-utils.js + scoring-utils.js]
    STATE[localStorage + profile state]
  end

  LB --> POLL
  TG --> POLL
  RD --> POLL
  POLL --> CLEAN
  CLEAN --> SIG
  POLL --> OBS
  SIG --> UI
  UI --> MODEL
  MODEL --> UI
  UI <--> API
  API <--> STORE
  API --> METRICS
  UI --> STATE
  UI --> TMDB
  API --> TMDB
```

## Feature List

- Category-level nomination and winner forecasting for major Academy Awards categories.
- Contender input controls (precursor/history/buzz/strength) with instant recalculation.
- Explainability panel (`Why this %`) showing feature contribution deltas versus category averages.
- Trend analytics with nomination/winner movement lines and source-refresh impact markers.
- CSV export/import for contender data workflows.
- Multi-profile forecast workspaces with localStorage + backend persistence.
- Poster and movie-detail side panel for selected contenders.
- External source polling + normalized aggregation from Letterboxd, Reddit, and TheGamer.
- Scraper observability: source freshness, retries, failures, and run-level telemetry.
- Mobile-first odds table behavior and keyboard-accessible row navigation.
- Deploy-ready backend with health/metrics endpoints, security headers, HTTPS enforcement toggle, and optional in-process poller.

## Technical Decisions

- Single-service architecture (frontend + backend together):
  - Chosen to reduce operational overhead and simplify deployment for a portfolio project.
  - Tradeoff: tighter coupling between UI and API release cycles.

- Deterministic scoring + constrained rebalancing:
  - Uses transparent weighted features and post-processing constraints rather than opaque ML.
  - Enables explainability and direct tuning of business rules (`winner <= nomination cap`, bounded totals).

- Hybrid persistence model:
  - localStorage for resilient UX and offline-ish continuity.
  - Backend profile storage for cross-session/server-backed workflows.

- Scraper resilience before sophistication:
  - Retry/backoff, freshness tracking, and source-level observability were prioritized.
  - This made failures diagnosable and safe instead of silently degrading outputs.

- Data-quality guardrails in ingestion:
  - Added title/entity canonicalization and noisy phrase rejection to reduce false matches.
  - Prevents polluted signals from headline text and forum chatter artifacts.

- Strict TMDB poster matching:
  - Enforced release-year filtering (2026) and poster URL validation.
  - Avoids common ambiguous-title mismatches and broken poster links.

- Accessibility and UX hardening:
  - Added loading/empty/error states and keyboard navigation for forecast rows.
  - Improves usability and demonstrates production-minded frontend behavior.

## Run locally
Install dependencies:

```bash
npm install
```

Start the app server (serves UI + API):

```bash
npm run dev
```

Then visit `http://localhost:3000`.

API endpoints:
- `GET /api/health`
- `GET /api/metrics`
- `GET /api/scrape-observability`
- `GET /api/profiles`
- `GET /api/forecast/:profileId`
- `PUT /api/forecast/:profileId`
- `GET /api/tmdb-poster?title=...`

Optional for more reliable poster lookup:
- `TMDB_API_KEY`
- `TMDB_API_READ_ACCESS_TOKEN`

## Scraping and polling external sources
This project includes a polling scraper for:
- `https://letterboxd.com/000_leo/list/oscars-2027/`
- `https://reddit.com/r/oscarrace/`
- `https://www.thegamer.com/oscars-predictions-2026-2027/`

Run one scrape pass:

```bash
npm run scrape:sources
```

Run continuous polling (every 30 minutes by default):

```bash
npm run poll:sources
```

The poller writes normalized source data to `data/source-signals.json`.
Observability metrics are written to `data/scrape-observability.json` with:
- source success/failure rates
- freshness (`lastSuccessAt`, `freshnessMinutes`)
- retry attempts and consecutive failures
- rolling run history and last updated timestamps

The app polls this file every 5 minutes and applies the latest aggregate signal deltas to contender inputs.
Trend analytics snapshots are captured in the forecast payload and persisted per profile.

## Accessibility

The UI targets **WCAG 2.1 Level AA**. An Axe-based audit was performed and all Critical and
Serious violations were resolved:

| Finding | Severity | Resolution |
|---|---|---|
| `role="button"` on `<tr>` (invalid ARIA ownership) | Critical | Removed; table uses `role="grid"` + `aria-selected` on rows |
| `compareProfileSelect` unlabelled | Serious | Added `aria-label="Comparison profile"` |
| `aria-live` on large panel containers causes excessive AT announcements | Serious | Removed from outer panels; retained only on inline status elements (`appStateNotice`, `csvStatus`, `oddsLastUpdated`) |
| No skip-navigation link | Serious | Added "Skip to main content" link |
| Poster `<img>` alt text static across film changes | Serious | `alt` now set to `"<Film title> poster"` in `setPosterState()` |
| Compare table headers used `title` attribute (unreliable for AT) | Moderate | Replaced with `aria-label` |
| Search `outline: none` without `focus-visible` guard | Moderate | Scoped to `:focus`; explicit `:focus-visible` ring added |

Keyboard interaction model:
- **Tab** — moves through controls in DOM order
- **Arrow Up / Down** — navigates contender rows within the results table
- **Enter / Space** — activates a row or button

## What I Learned

- Data products fail at the seams, not in core logic:
  - Most reliability work was around ingestion quality, retries, stale data handling, and bad external links.

- Explainability is a product feature:
  - Users trust probabilistic outputs more when they can inspect driver contributions and trend movement.

- Constraint tuning matters as much as base scoring:
  - Practical caps and rebalancing rules were necessary to keep percentages realistic and stable.

- Production readiness is more than “it runs”:
  - Security headers, health/metrics endpoints, deploy config, and monitoring loops significantly improved project maturity.

- UX polish compounds:
  - Keyboard navigation, mobile table ergonomics, and explicit state messaging changed the app from demo-like to product-like.

## Files
- `index.html`: app structure and content
- `styles.css`: visual design and responsive layout
- `app.js`: data model and probability calculations
- `server.mjs`: Express server with forecast API
- `forecast-utils.js`: shared scoring/rebalancing helpers
- `forecast-utils.test.js`: unit tests for utility logic
- `scripts/poll-sources.mjs`: external source scraping + polling job
- `data/source-signals.json`: latest normalized scrape snapshot
- `render.yaml`: Render blueprint for public deployment
- `DEPLOYMENT.md`: domain/HTTPS/monitoring deployment runbook
