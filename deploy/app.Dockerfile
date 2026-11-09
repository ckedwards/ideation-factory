# The ideaf app for a deployment: the server, with the web app built in. It
# runs on an engine of its own (RIVET_ENDPOINT) with files in a bucket
# (IDEAF_S3_BUCKET); see deploy/README.md. Build from the repository's root:
#
#   docker build -f deploy/app.Dockerfile -t ideaf-app .
FROM oven/bun:1.4.3 AS build
WORKDIR /app
# the workspace's package.json files first, so the install is cached while only source changes
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
COPY tsconfig*.json ./
RUN bun run --filter @ideaf/web build

# what runs: production dependencies only, the packages' source, and the built web app
FROM oven/bun:1.4.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/e2e/package.json packages/e2e/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.3
WORKDIR /app
COPY --from=deps /app /app
COPY --from=build /app/packages/api packages/api
COPY --from=build /app/packages/core packages/core
COPY --from=build /app/packages/server packages/server
COPY --from=build /app/packages/web/dist packages/web/dist
COPY tsconfig*.json ./
COPY deploy/app-entrypoint.sh /usr/local/bin/app-entrypoint
# when this image was built: the node version, which rises with each build
RUN date +%s > /app/build-version
ENV NODE_ENV=production \
    PORT=8080 \
    IDEAF_DATA=/data \
    IDEAF_WEB_DIR=/app/packages/web/dist
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=120s \
  CMD ["bun", "-e", "process.exit((await fetch('http://localhost:8080/health').catch(() => null))?.ok ? 0 : 1)"]
ENTRYPOINT ["/usr/local/bin/app-entrypoint"]
CMD ["bun", "packages/server/src/main.ts"]
