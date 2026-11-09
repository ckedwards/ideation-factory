# The Rivet Engine: Rivet's own image, at the version RivetKit is pinned to
# (bun.lock's @rivetkit/engine-cli; deploy/engine.test.ts checks the two agree).
# Not the npm package's musl binary: on three nodes, with one killed, that build
# recovered in 1 of 5 runs where this image recovered in 13 of 15. Build from the
# repository's root:
#
#   docker build -f deploy/engine.Dockerfile -t ideaf-engine .
FROM rivetdev/engine:3.0.6@sha256:868535b3a3249c17111cf2ac77c98300800a2b9fc99dcb0410c4d62febc530f4
# its write-ahead log, on this machine's disk; everything durable goes on to the bucket
RUN mkdir -p /var/lib/rivet/log
VOLUME /var/lib/rivet
EXPOSE 6420 6421
ENTRYPOINT ["rivet-engine"]
CMD ["--config", "/etc/rivet"]
