# ─────────────────────────────────────────────────────────────────────────────
# HempForge — multi-stage production image
# Build:  vite build (SPA) + esbuild server bundle (--packages=external)
# Runtime: node dist/server.cjs serves API + SPA from dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install all deps (esbuild/vite/tsx are devDeps used at build time)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build SPA + server bundle
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Runtime needs node_modules because the server bundle is built with
# --packages=external (requires package.json's "dependencies" at runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Built artifacts
COPY --from=builder /app/dist ./dist

# Seed data for the local-DB fallback (demo path). Must be valid JSON.
COPY local-db-fallback.json ./

# Runtime dirs (vault/local-research are mounted as volumes at runtime).
RUN mkdir -p local-research vault

# Non-root user. node_modules stays root-owned but world-readable; only the
# writable spots need chown (keeps this instant even on slow Windows-mounted
# build contexts). /app dir itself must be writable so the local-DB fallback
# can create local-db-fallback.json.tmp.
RUN useradd -m -u 10001 hempforge \
    && mkdir -p data .vite-cache \
    && chown hempforge:hempforge /app /app/data /app/.vite-cache /app/local-research /app/vault /app/local-db-fallback.json
USER hempforge

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.mjs"]
