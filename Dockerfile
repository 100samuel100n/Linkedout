# Multi-stage build → a small runtime image around Next.js's standalone
# output (see next.config.mjs).
#
# No local data volume is needed anymore: the identity/content stores are
# PostgreSQL (lib/db/pg-client.js) and media/avatars/verification docs
# are Backblaze B2 object storage (lib/storage.js) — both external to
# this container, which is what makes it safe to run more than one
# instance of this image at once (see fly.toml / DEPLOYMENT.md).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# package-lock.json can drift from package.json; `npm ci` hard-fails on drift, so fall back to a normal install.
RUN npm ci || npm install

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Dummy build-time values so `next build` doesn't fail collecting route
# metadata for routes that call getStripe()/etc. — real values are
# injected at runtime via `fly secrets` / your platform's env config, not
# baked into the image.
ENV IDENTITY_SIGNING_SECRET=build-time-placeholder
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# ffmpeg for video/audio transcoding (lib/transcode.js) — not installed
# by node:22-slim by default. Without this, uploads still work fine
# (transcode.js falls back to storing the original file untouched), but
# nothing actually gets compressed/normalized. If you're on a platform
# that doesn't let you customize the Dockerfile (a managed PaaS without
# Docker support), this feature simply won't run there — it needs this
# line, or an equivalent system package install, somewhere in the
# container's build.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Standalone output doesn't include public/ or .next/static — copy them in
# explicitly, per Next.js's own deployment docs.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
# Docker sets a HOSTNAME env var to the container's own ID by default, and
# Next.js's standalone server reads that to decide which interface to bind
# to — so without this, it binds to something like "a1b2c3d4e5f6:3000"
# instead of all interfaces, which is unreachable from outside the
# container (this exact symptom: the process logs "Ready" successfully,
# but every request from a reverse proxy in front of it gets a 502/refused
# connection). Forcing HOSTNAME=0.0.0.0 here, via `exec env`, overrides
# whatever the platform's container runtime sets, so this holds regardless
# of which host (Railway, Fly, plain Docker, etc.) runs the image.
CMD ["/bin/sh", "-c", "exec env HOSTNAME=0.0.0.0 node server.js"]
