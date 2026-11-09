# The Rivet Engine, the version RivetKit is pinned to (bun.lock), from its npm
# package: a static (musl) binary in a small image. Build from the repository's root:
#
#   docker build -f deploy/engine.Dockerfile -t ideaf-engine .
FROM oven/bun:1.4.3 AS fetch
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/e2e/package.json packages/e2e/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile --ignore-scripts \
  && cp "$(find node_modules/.bun -path '*@rivetkit/engine-cli-linux-*-musl/rivet-engine' -type f | head -1)" /rivet-engine

FROM alpine:3.22
COPY --from=fetch /rivet-engine /usr/local/bin/rivet-engine
# its write-ahead log, on this machine's disk; everything durable goes on to the bucket
RUN mkdir -p /var/lib/rivet/log
VOLUME /var/lib/rivet
EXPOSE 6420 6421
ENTRYPOINT ["rivet-engine"]
CMD ["--config", "/etc/rivet"]
