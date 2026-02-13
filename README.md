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

## Run locally
Because this is a static site, open `index.html` directly, or run a local server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Scraping and polling external sources
This project includes a polling scraper for:
- `https://letterboxd.com/000_leo/list/oscars-2027/`
- `https://reddit.com/r/oscarrace/`
- `https://www.thegamer.com/oscars-predictions-2026-2027/`

Install dependencies:

```bash
npm install
```

Run one scrape pass:

```bash
npm run scrape:sources
```

Run continuous polling (every 30 minutes by default):

```bash
npm run poll:sources
```

The poller writes normalized source data to `data/source-signals.json`.
The app polls this file every 5 minutes and applies the latest aggregate signal deltas to contender inputs.

## Files
- `index.html`: app structure and content
- `styles.css`: visual design and responsive layout
- `app.js`: data model and probability calculations
- `scripts/poll-sources.mjs`: external source scraping + polling job
- `data/source-signals.json`: latest normalized scrape snapshot
