# Public Deployment Guide

This app serves frontend + backend from one Node service (`server.mjs`).

## 1) Deploy service (Render)

1. Push this repo to GitHub.
2. In Render, create a new Blueprint deploy and select this repo.
3. Render will detect `render.yaml` and provision the `oscar-odds` web service.
4. Add environment variables in Render:
   - `TMDB_API_KEY` (optional but recommended)
   - `TMDB_API_READ_ACCESS_TOKEN` (optional)
5. Confirm health check:
   - `GET /api/health`

The service is configured to run source polling in-process:
- `ENABLE_SOURCE_POLLER=true`
- `SOURCE_POLL_INTERVAL_MINUTES=30`

## 2) Domain + HTTPS

1. In Render service settings, add your custom domain (for example: `oscarodds.yourdomain.com`).
2. Create the DNS record from your DNS provider using Render-provided values.
3. Wait for TLS issuance (Render-managed HTTPS certificate).
4. Keep `FORCE_HTTPS=true` to redirect plain HTTP to HTTPS.

## 3) Monitoring

### App-level monitoring endpoints
- `GET /api/health`: uptime and poller runtime state
- `GET /api/metrics`: request counts by method/status + poller runtime state
- `GET /api/scrape-observability`: scrape success/failure and freshness telemetry

### GitHub uptime workflow
This repo includes `.github/workflows/uptime-monitor.yml` (runs every 10 minutes).

Set these repository secrets:
- `APP_HEALTH_URL` (example: `https://oscarodds.yourdomain.com/api/health`)
- `APP_METRICS_URL` (example: `https://oscarodds.yourdomain.com/api/metrics`)

If either request fails, the workflow run fails and can trigger notifications.

## 4) Optional Docker deploy target

Build:
```bash
docker build -t oscar-odds:latest .
```

Run:
```bash
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e FORCE_HTTPS=false \
  -e ENABLE_SOURCE_POLLER=true \
  -e SOURCE_POLL_INTERVAL_MINUTES=30 \
  oscar-odds:latest
```
