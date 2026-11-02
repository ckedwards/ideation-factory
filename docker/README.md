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

On the client, `ideaf auth login` opens the sign-in page in the client's Chromium (on the noVNC screen), and the code comes back to the cli as it would on a laptop. Sign-in codes are emailed, over SMTP as in production, to Mailpit: open its inbox at http://mailpit:8025 in another tab of the client's browser. Every address arrives there, so any email works. From a shell on the client (or for Claude Code), the latest code is:

```sh
curl -s mailpit:8025/api/v1/messages | grep -o '[0-9]\{6\} is your' | head -1
```

To make yourself a site admin, set `IDEAF_SITE_ADMINS=you@example.test` where you run `docker compose up`. `IDEAF_PERSONAL_TOKENS` passes through the same way.

## Single sign-on, with Keycloak

To try single sign-on, add `docker-compose.sso.yaml`: it runs Keycloak as the organization's identity provider (OIDC) and switches the server over to it.

```sh
docker compose -f docker-compose.yaml -f docker-compose.sso.yaml up -d --build
```

On the client, `ideaf auth login` now shows "Continue with Acme", which goes to Keycloak's sign-in page. Sign in as `alice` or `bob` (the password is the same as the name); they're new here, so they confirm a handle first. Email codes only work for site admins, `admin@acme.test` by default (`IDEAF_SITE_ADMINS` changes it). Keycloak's admin console is at http://keycloak:8180 from the client's browser (`admin` / `admin`), to add people or change them. The realm is `docker/keycloak/acme-realm.json`.

Going back to email codes: `docker compose up -d` with the base file alone. Accounts made through Keycloak stay, and keep their handles.

## Claude Code

`claude` is installed on the client. Set `ANTHROPIC_API_KEY` where you run `docker compose up`, or run `/login` in Claude Code: it opens in the client's Chromium too. Claude Code's settings, ideaf's tokens, Chromium's profile and `~/work` live in the `client-home` volume, so they survive restarts. Put a repo to try in `~/work`.

## How it fits together

- Both machines use `http://localhost:8080` as the server's URL. Tokens are issued for one URL (`IDEAF_URL`), and OAuth allows a plain-http redirect only on a loopback host, so the client forwards its `localhost:8080` to the server rather than using `http://server:8080`.
- The server isn't published on your machine, so it doesn't clash with `bun run dev` on port 8080. noVNC's port can move too: `IDEAF_SANDBOX_VNC_PORT=6090`.
- The client's `xdg-open` (`docker/client/xdg-open`) opens links in its Chromium, which runs without its sandbox: that needs user namespaces, which Docker's default seccomp profile doesn't give.

## Start over

```sh
docker compose down -v                     # removes both volumes: server data and the client's home
```

The server image copies the source: run `docker compose up -d --build` after changing the server.
