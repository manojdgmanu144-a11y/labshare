# ── Stage 1: install server production deps ──────────────────
FROM node:20-slim AS deps-server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 2: install client deps ─────────────────────────────
# Vite 8 + @vitejs/plugin-react 6 require Node >= 22.
FROM node:22-slim AS deps-client
WORKDIR /app/client
COPY client/package*.json ./
# Use npm install (not npm ci) so npm can regenerate any Linux-specific
# optional native entries that may be absent from a Windows-generated lockfile.
RUN npm install --ignore-scripts

# ── Stage 3: build the Vite frontend ─────────────────────────
# VITE_* vars are public (anon key + project URL) and baked into
# the JS bundle at build time by Vite.  Pass them as build args.
FROM deps-client AS build-client
WORKDIR /app/client
COPY client/ ./
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN npm run build

# ── Stage 4: lean runtime image ──────────────────────────────
FROM node:20-slim AS runtime

# Run as non-root for Cloud Run security best-practice
RUN addgroup --system --gid 1001 appgroup \
 && adduser  --system --uid 1001 --ingroup appgroup appuser

WORKDIR /app

# Server code + its production node_modules
COPY --from=deps-server  /app/server/node_modules ./server/node_modules
COPY server/              ./server/

# Pre-built static client
COPY --from=build-client /app/client/dist         ./client/dist

# Cloud Run injects PORT at runtime (default 8080)
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER appuser

# Healthcheck so Cloud Run knows when the container is ready
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/api/health', r => process.exit(r.statusCode===200?0:1))"

CMD ["node", "server/index.js"]
