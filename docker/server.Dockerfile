# The ideaf server for docker/docker-compose.yaml: one app node, which starts its own
# local Rivet Engine (as in development) with its data in /data.
FROM oven/bun:1.4.3

WORKDIR /app
# the workspace's package.json files first, so the install is cached while
# only source changes
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/e2e/package.json packages/e2e/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages packages

ENV IDEAF__PORT=8080 \
    IDEAF__DATA=/data \
    RIVETKIT_STORAGE_PATH=/data \
    RIVET_RUN_ENGINE_PORT=6420 \
    RIVET_RUN_SERVICES=0
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=3s --start-period=60s \
  CMD ["bun", "-e", "process.exit((await fetch('http://localhost:8080/health').catch(() => null))?.ok ? 0 : 1)"]
CMD ["bun", "packages/server/src/main.ts"]
