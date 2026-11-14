# RivetKit's native module with the fix for rivet-dev/rivet#5991 (rivet-dev/rivet#5992), as build.sh
# makes it, in an image of its own that holds only the module (/rivetkit-napi.linux-x64-gnu.node),
# for app.Dockerfile here to copy in. Built on Rivet's own builder (Debian bullseye), so it loads
# on any newer glibc, like Rivet's released modules. The rivetkit-fix workflow builds it, by hand:
# one per RivetKit version, as the build takes a while.
#
#   docker build -f packages/load/rivetkit-fix/module.Dockerfile --build-arg RIVETKIT_VERSION=3.1.1 .
FROM ghcr.io/rivet-dev/rivet/builder-base-linux-gnu:0e33ceb98@sha256:6409c7b708380fb59bfbc209edf283f678c3ba2f0d0772e3b351b288032d1381 AS build
ARG RIVETKIT_VERSION
COPY packages/load/rivetkit-fix/rearm-one-waiter.patch /fix.patch
RUN git clone -q --depth 1 --branch "v${RIVETKIT_VERSION:?}" https://github.com/rivet-dev/rivet.git /src
WORKDIR /src
# a release the patch no longer fits stops here, rather than building the module without the fix
RUN git apply /fix.patch && \
    RUST_TOOLCHAIN="$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)" && \
    rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal && \
    rustup default "$RUST_TOOLCHAIN" && \
    rustup target add x86_64-unknown-linux-gnu
# release, with symbols and line tables kept, like the module that was measured, so it can be profiled
RUN RUSTFLAGS="--cfg tokio_unstable" CARGO_PROFILE_RELEASE_DEBUG=line-tables-only CARGO_PROFILE_RELEASE_STRIP=none \
    cargo build -p rivetkit-napi --release --target x86_64-unknown-linux-gnu && \
    cp target/x86_64-unknown-linux-gnu/release/librivetkit_napi.so /rivetkit-napi.linux-x64-gnu.node

FROM scratch
COPY --from=build /rivetkit-napi.linux-x64-gnu.node /rivetkit-napi.linux-x64-gnu.node
