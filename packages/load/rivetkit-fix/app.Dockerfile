# The app's published image with RivetKit's native module swapped for the one with the fix for
# rivet-dev/rivet#5991 (module.Dockerfile), for benchmarks (packages/load/DEPLOYMENT.md): the same
# build otherwise, so its node version is the app image's. Not for production: people run the app
# image, with RivetKit as published.
ARG APP_IMAGE
ARG MODULE_IMAGE
FROM ${MODULE_IMAGE} AS module
FROM ${APP_IMAGE}
ARG RIVETKIT_VERSION
COPY --from=module /rivetkit-napi.linux-x64-gnu.node /app/node_modules/.bun/@rivetkit+rivetkit-napi-linux-x64-gnu@${RIVETKIT_VERSION}/node_modules/@rivetkit/rivetkit-napi-linux-x64-gnu/rivetkit-napi.linux-x64-gnu.node
