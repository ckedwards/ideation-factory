#!/bin/sh
# The client's desktop: a virtual display with a window manager, shown over
# VNC through noVNC on port 6080; and the server, forwarded to localhost:8080.
#
# The server is forwarded rather than reached as http://server:8080 because
# its tokens are issued for one URL (IDEAF_URL), and OAuth allows a plain-http
# redirect only on a loopback host: localhost:8080 works for both the cli and
# the browser in here.
set -eu

mkdir -p "$HOME/work" "$HOME/.config/chromium"
# left over if the container was stopped rather than removed
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 "$HOME"/.config/chromium/Singleton*

Xvfb :99 -screen 0 1440x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for _ in $(seq 100); do
  if [ -e /tmp/.X11-unix/X99 ]; then
    break
  fi
  sleep 0.1
done
openbox >/tmp/openbox.log 2>&1 &
x11vnc -display :99 -localhost -forever -shared -nopw -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
socat TCP-LISTEN:8080,bind=127.0.0.1,fork,reuseaddr TCP:server:8080 &

exec "$@"
