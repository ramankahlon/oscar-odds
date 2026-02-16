# Oscar Odds 2027

A lightweight static site that estimates nomination and winner probabilities for major 2027 Oscar categories.

## What it does
- Seeds major upcoming films and contenders.
- Uses a weighted blend of:
  - precursor signals
  - historical fit
  - industry buzz
- Outputs category-level nomination and winner percentages.
- Lets you edit each contender's inputs and campaign strength in the UI.
- Tracks contender trend lines over time for nomination/winner movement with source-update markers.
- Includes mobile-first odds table behavior and explicit loading/empty/error UX states with keyboard-accessible contender rows.

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

## Resume-focused 2-week plan
Week 1:
1. Backend/API persistence (implemented): server-side forecast storage endpoint and frontend API integration with local fallback.
2. Test harness (implemented): unit tests for forecast utility logic.

Week 2:
1. Auth + multi-profile forecast workspaces.
2. Explainability panel for each contender (`why this %` feature attribution).

## Files
- `index.html`: app structure and content
- `styles.css`: visual design and responsive layout
- `app.js`: data model and probability calculations
- `server.mjs`: Express server with forecast API
- `forecast-utils.js`: shared scoring/rebalancing helpers
- `forecast-utils.test.js`: unit tests for utility logic
- `scripts/poll-sources.mjs`: external source scraping + polling job
- `data/source-signals.json`: latest normalized scrape snapshot
