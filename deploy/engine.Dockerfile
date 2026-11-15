# The Rivet Engine: Rivet's own image, at the version RivetKit is pinned to
# (bun.lock's @rivetkit/engine-cli; deploy/engine.test.ts checks the two agree).
# Not the npm package's musl binary: on three nodes, with one killed, that build
# recovered in 1 of 5 runs where this image recovered in 13 of 15. CI publishes it as
# ghcr.io/<owner>/<repo>/engine (.github/workflows/images.yml). Build from the repository's root:
#
#   docker build -f deploy/engine.Dockerfile -t ideaf-engine .
FROM rivetdev/engine:3.1.1@sha256:55cdfe9a92c0ee2f7d3ce5f388dab2ef8e0be1bab8e3f1adb7ba972f862e25d4
# its write-ahead log, on this machine's disk; everything durable goes on to the bucket
RUN mkdir -p /var/lib/rivet/log
# no crash reports to Rivet unless a deployment turns them on (RIVET__TELEMETRY__ENABLED=true)
ENV RIVET__TELEMETRY__ENABLED=false
VOLUME /var/lib/rivet
EXPOSE 6420 6421
ENTRYPOINT ["rivet-engine"]
CMD ["--config", "/etc/rivet"]
