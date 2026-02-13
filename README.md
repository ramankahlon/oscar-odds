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

## Files
- `index.html`: app structure and content
- `styles.css`: visual design and responsive layout
- `app.js`: data model and probability calculations
