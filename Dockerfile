# syntax=docker/dockerfile:1

# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Installs all dependencies (devDeps included — esbuild lives there), builds
# the browser bundle, then prunes devDependencies so the node_modules folder
# is ready to copy cleanly into the runtime stage.
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Generate app.js (esbuild is a devDependency, so this must run before pruning)
RUN npm run build:client

# Strip devDependencies in-place so the runtime stage copies a lean node_modules
RUN npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Lean production image. Native bindings in node_modules are compatible because
# both stages share the same base image (node:20-alpine).
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="Oscar Odds" \
      org.opencontainers.image.description="Academy Awards nomination and win probability forecast server"

WORKDIR /app

# Pruned production node_modules from the builder (no devDeps, native modules intact)
COPY --from=builder /app/node_modules   ./node_modules
COPY package*.json                      ./

# tsconfig.json is read by tsx at startup for module-resolution settings
COPY --from=builder /app/tsconfig.json  .

# Server entry point and its one local import
COPY --from=builder /app/server.ts      .
COPY --from=builder /app/logger.ts      .

# scraper-utils.ts is imported by scripts/poll-sources.ts, which the server
# spawns as a child process when ENABLE_SOURCE_POLLER=true
COPY --from=builder /app/scraper-utils.ts  .
COPY --from=builder /app/scripts           ./scripts

# Static assets served by Express and the API spec loaded at startup
COPY --from=builder /app/index.html    .
COPY --from=builder /app/styles.css    .
COPY --from=builder /app/openapi.yaml  .

# Browser bundle produced by esbuild in the builder stage (gitignored on host)
COPY --from=builder /app/app.js        .

# Create the data directory so a bare `docker run` (no volume) doesn't crash on
# startup. A compose volume mount will overlay this with the host directory.
RUN mkdir -p data && chown -R node:node /app

# Drop to the built-in non-root user for better container security
USER node

ENV NODE_ENV=production
EXPOSE 3000

# Uses the /api/health endpoint added to the server.
# wget is included in node:20-alpine by default.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npm", "start"]
