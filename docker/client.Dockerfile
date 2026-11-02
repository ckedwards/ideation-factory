# A client machine for docker/docker-compose.yaml: Claude Code, the ideaf binary
# (mounted from packages/cli/dist), and a browser of its own. Chromium runs on
# a virtual display inside the container, so its sign-ins stay here; you see
# and use it through noVNC at http://localhost:6080.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git less procps ripgrep socat \
      chromium fonts-dejavu-core \
      xvfb x11vnc openbox novnc websockify \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Claude Code, installed outside the home volume so a rebuild updates it
RUN curl -fsSL https://claude.ai/install.sh | HOME=/opt/claude bash \
 && chmod -R a+rX /opt/claude \
 && ln -s "$(readlink -f /opt/claude/.local/bin/claude)" /usr/local/bin/claude

COPY docker/client/xdg-open /usr/local/bin/xdg-open
COPY docker/client/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/xdg-open /usr/local/bin/entrypoint \
 && useradd --create-home --uid 1000 --shell /bin/bash dev

USER dev
WORKDIR /home/dev/work
# the ideaf binary is mounted at /opt/ideaf
ENV PATH=/opt/ideaf:$PATH \
    DISPLAY=:99 \
    BROWSER=/usr/local/bin/xdg-open \
    DISABLE_AUTOUPDATER=1
EXPOSE 6080
ENTRYPOINT ["entrypoint"]
CMD ["sleep", "infinity"]
