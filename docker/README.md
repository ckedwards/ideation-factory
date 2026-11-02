# A sandbox to try ideaf end to end

`docker-compose.yaml` here runs two machines. Run `docker compose` from this folder.

- **server**: the ideaf server, built from this checkout, with its own Rivet Engine and data in a volume.
- **client**: Claude Code, the `ideaf` binary from `packages/cli/dist` (mounted, so a rebuild shows up at once), and a Chromium of its own. The browser runs on a virtual display inside the container, so its cookies and sign-ins stay there. You see and use it from your own browser through noVNC.

## Start

```sh
bun run --filter @ideaf/cli build          # the binary the client mounts
cd docker
docker compose up -d --build
docker compose exec client bash            # a shell on the client, in ~/work
```

Open <http://localhost:6080/vnc.html?autoconnect=1&resize=remote> to see the client's screen.

## Sign in

On the client, `ideaf auth login` opens the sign-in page in the client's Chromium (on the noVNC screen), and the code comes back to the cli as it would on a laptop. There's no email yet: the server logs the codes.

```sh
docker compose logs server | grep 'sign-in code'
```

To make yourself a site admin, set `IDEAF_SITE_ADMINS=you@example.test` where you run `docker compose up`. `IDEAF_PERSONAL_TOKENS` passes through the same way.

## Claude Code

`claude` is installed on the client. Set `ANTHROPIC_API_KEY` where you run `docker compose up`, or run `/login` in Claude Code: it opens in the client's Chromium too. Claude Code's settings, ideaf's tokens, Chromium's profile and `~/work` live in the `client-home` volume, so they survive restarts. Put a repo to try in `~/work`.

## How it fits together

- Both machines use `http://localhost:8080` as the server's URL. Tokens are issued for one URL (`IDEAF_URL`), and OAuth allows a plain-http redirect only on a loopback host, so the client forwards its `localhost:8080` to the server rather than using `http://server:8080`.
- The server isn't published on your machine, so it doesn't clash with `bun run dev` on port 8080.
- The client's `xdg-open` (`docker/client/xdg-open`) opens links in its Chromium, which runs without its sandbox: that needs user namespaces, which Docker's default seccomp profile doesn't give.

## Start over

```sh
docker compose down -v                     # removes both volumes: server data and the client's home
```

The server image copies the source: run `docker compose up -d --build` after changing the server.
