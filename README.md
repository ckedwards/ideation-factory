# Ideation Factory

Review and edit ideas written in Markdown, together with agents, so comments stay with the text they're about. Licensed under Apache-2.0.

> **Alpha software.** Nothing has shipped yet, and there are no migrations during the alpha: schemas and APIs change in place, so data from an earlier build won't carry over to a later one.

## Docs

- [The idea](docs/idea.md) and the [market analysis](docs/market-analysis.md)
- [Architecture](docs/architecture.md) and the [cli](docs/cli.md)
- [MVP design](docs/mvp/architecture.md): [backend](docs/mvp/architecture-backend.md), [front end](docs/mvp/architecture-frontend.md), [cli and skills](docs/mvp/architecture-cli.md), [core](docs/mvp/core.md), [scale concerns](docs/mvp/scale-concerns.md), and the [Rivet](docs/mvp/spike-rivet.md) and [Better Auth](docs/mvp/spike-better-auth.md) spikes
- [Implementation plan](docs/implementation-plan.md): where to start, and in what order

The prototypes are in `experiments/`. To try ideaf end to end, with Claude Code on a client machine, see the [docker sandbox](docker/README.md).

## Contributing

Commit messages follow [CONTRIBUTING.md](CONTRIBUTING.md) (adapted from Angular's guidelines), checked by a commit-msg hook that `bun install` turns on, and by CI. Agents read [AGENTS.md](AGENTS.md).

## Code

Bun workspaces, all TypeScript:

```
packages/
  core/     schemas, edit commands, Markdown blocks, anchoring, hashing, links
  api/      each operation defined once: HTTP routes, MCP tools, a typed client
  server/   the Bun app: HTTP and MCP, auth, the idea and directory actors
  ui/       the building blocks: React components, design tokens and themes
  web/      the React app: routes, pages, their components and data loading
  cli/      ideaf
  e2e/      end-to-end tests: the cli against the real server
```

You need [Bun](https://bun.sh), and Node for Vite and Storybook. Docker is only for the [Rivet spike](docs/mvp/spike-rivet.md).

```
bun install
bun run dev          # the app and its API on http://localhost:8080
bun run typecheck
bun run test
bun run engine:stop  # stop the local Rivet Engine
```

**The web app** is http://localhost:8080. `bun run dev` runs Vite for it behind the server, which passes it the pages' requests, so the app, its API and sign-in share one address, as in production; changes show at once. Built (`bun run --filter @ideaf/web build`), the server serves it from `packages/web/dist`, or the folder in `web.dir`.

**Signing in.** The web app sends you to the sign-in page, http://localhost:8080/login: enter any email, and use the code the dev server prints in its log (it emails codes only when SMTP is set up, below). The first time, pick a handle. Sign in with other emails to try several people.

**Installing the cli.** Each release has it for Linux and macOS, on x64 and arm64, as one file with nothing else to install. With [mise](https://mise.jdx.dev):

```sh
mise use -g github:ckedwards/ideation-factory      # ideaf, the newest release; mise upgrade for the next
```

Or download `ideaf-<os>-<arch>.tar.gz` from the [release page](https://github.com/ckedwards/ideation-factory/releases/latest), check it against `SHA256SUMS`, and put `ideaf` on your `PATH`. On macOS, a copy downloaded in a browser needs `xattr -d com.apple.quarantine ideaf` first, as it isn't signed. Releases from `v0.1.1` have it; `ideaf --version` says which one you have.

The cli signs in with **`ideaf auth login`**: it opens your browser to sign in, and to choose what this sign-in may do (who acts with it, read only or not, and which teams or ideas it reaches; flags like `--bot planbot --team core --read-only` fill those in). With no browser of its own (over SSH, say) or with `--no-browser`, it shows a link to open on any device and asks for the code that page shows. Its tokens are kept in the OS keychain and refreshed as needed; `ideaf auth status` shows the sign-in and `ideaf auth logout` ends it.

**In CI**, where nobody can sign in, use a personal token instead. They're a stopgap, and only site admins can make them by default, so start the dev server with your email in `site_admins` (or `IDEAF__AUTH__PERSONAL_TOKENS=on` for everyone), then make one on the sign-in page. It starts `ideaf_`, is shown once, and goes in `IDEAF_TOKEN` (which wins over `ideaf auth login`) or a request's bearer token:

```
IDEAF__SITE_ADMINS=you@example.com bun run dev
export IDEAF_TOKEN=ideaf_…
curl -H "authorization: Bearer $IDEAF_TOKEN" -X POST localhost:8080/api/ideas \
  -d '{"title":"Demo","files":[{"path":"plan.md","content":"# Plan\n\nHello.\n"}]}'
# → {"idea":"i…","version":1}
```

**Settings.** The server reads them from `ideaf.yaml`, and its secrets from `secrets.yaml` beside it: `/etc/ideaf/` unless `IDEAF_CONFIG` and `IDEAF_SECRETS` name other files. Every key can also be set by its environment variable, named for its path: `files.s3.bucket` is `IDEAF__FILES__S3__BUCKET`. Each source overrides the one before: the defaults, `ideaf.yaml`, `secrets.yaml`, then the environment. Secrets (`auth.secret`, `auth.scim_token`, `auth.sso.oidc.client_secret`, `engine.token`, `email.smtp_url`, `files.s3.secret_access_key`) belong in `secrets.yaml`, the environment, or a file of their own named by `<key>_file`, as Docker and Kubernetes hand them out; one written in `ideaf.yaml` works, with a warning. Everything is checked when the server starts, and a mistake names its key and where it came from. [`deploy/ideaf.schema.json`](deploy/ideaf.schema.json) describes every key, for editors that complete and check YAML; [`deploy/vm/resources/ideaf.yaml.example`](deploy/vm/resources/ideaf.yaml.example) is a deployment's.

In production, set `auth.secret` (at least 32 random characters) and `url` (the public URL); `site_admins` lists the site admins' emails, and `auth.personal_tokens` (`on`, `admins` or `off`; `admins` by default) decides who may use personal tokens. Turning them off refuses existing ones too. Behind a load balancer or reverse proxy, list its addresses in `trusted_proxies` (IPs or CIDR ranges, comma-separated): sign-in's rate limits count per client, and only a request through one of those has its client taken from `X-Forwarded-For`. A proxy on the same machine is `trusted_proxies: [127.0.0.1, '::1']`. The proxy must add the client to `X-Forwarded-For`: Caddy and Traefik do by default, and nginx does with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. Left unset, every client behind the proxy shares one count, and the server logs a warning saying what to set.

**Deploying.** From our published builds: on VMs or bare metal for production, with Docker Compose on one machine to try it (`deploy/compose/`), and on Kubernetes later. See `deploy/README.md`.

**The engine and files.** In development the server starts its own Rivet Engine and keeps files in `.data/`. A deployment runs the engine on its own (`rivet-engine --config …`, with an `auth.admin_token`, a `storage.log_directory` and an `object_storage` bucket or folder) and names it in `engine.endpoint` (`http://engine:6420`), with its admin token in `engine.token`; the server makes the engine's node pools it joins. Files go in a bucket when `files.s3.bucket` is set: `files.s3.endpoint` for anything but AWS (`http://seaweedfs:8333`), `files.s3.region`, `files.s3.access_key_id` and `files.s3.secret_access_key` (or the machine's own credentials), `files.s3.prefix` (`files/` by default), and `files.s3.virtual_hosted: on` for bucket-in-hostname URLs; otherwise in `data/files`, which only suits one machine. A new engine takes about a minute before it can serve; until then the server exits (status 1) when it starts, so run it under something that starts it again (the Compose files' restart policy, or systemd's `Restart=on-failure`).

**People who leave.** Without SCIM, a site admin deactivates them on the server: they're signed out everywhere and their writes stop at once. Their ideas and comments stay.

```
bun packages/server/src/admin.ts deactivate <handle>
bun packages/server/src/admin.ts reactivate <handle>
bun packages/server/src/admin.ts release-handle <@person or team>   # frees a squatted handle; links through it stop working
```

**Email.** Sign-in codes go out over SMTP, so any provider works (Amazon SES, Postmark, Mailgun, Resend, Google Workspace, your own server): set `email.smtp_url` (`smtps://user:password@host:465`, or `smtp://…:587` for STARTTLS) and `email.from` (`Ideation Factory <sign-in@example.com>`). Without them the server writes codes to its log, which production refuses unless `IDEAF__EMAIL__MODE=log` says so (say, behind single sign-on, where only site admins use codes). Notification emails go over the same server, from `email.notify_from` (`Ideation Factory <notifications@example.com>`, so mail rules can tell them from sign-in codes; `email.from` without it); `IDEAF__EMAIL__NOTIFICATIONS=off` turns them off.

**MCP.** Agents connect to the hosted MCP server at `https://<your deployment>/mcp` (for Claude Code: `claude mcp add --transport http ideaf https://<your deployment>/mcp`) and sign in in the browser, choosing on the consent page whether the agent acts as you or as a bot for you. Any MCP client that publishes a Client ID Metadata Document can sign in; `mcp.client_hosts` (comma-separated, like `claude.ai,vscode.dev`) allows only those hosts' clients. A personal token in an `Authorization: Bearer` header works too, for clients set up without a browser.

**Signing keys.** Access tokens are signed with a key kept in the directory, its private half encrypted with `auth.secret`. It's replaced every 30 days by itself, and a replaced key keeps verifying the tokens it signed for a day. To replace it now, or to withdraw every key if one may have leaked (outstanding access tokens then stop working within a minute, and clients refresh), run on the server:

```
bun packages/server/src/admin.ts rotate-signing-key [--emergency]
```

**Single sign-on.** To sign people in with your organization's identity provider instead of email codes, set `auth.sso.mode` to `oidc` or `saml`, `auth.sso.domains` to the email domains that may sign in (comma-separated), and optionally `auth.sso.name` (the sign-in page says "Continue with <name>") and `IDEAF__AUTH__SSO__AUTO_CREATE=off` (to refuse people who have no account yet; it's on by default). Then:

- **OIDC:** `auth.sso.oidc.issuer`, `auth.sso.oidc.client_id` and `auth.sso.oidc.client_secret`. Register `<url>/api/auth/sso/callback/ideaf-sso` as the client's redirect URI.
- **SAML:** `auth.sso.saml.metadata`, a file with the provider's metadata XML. Give the provider our metadata, `<url>/api/auth/sso/saml2/sp/metadata?providerId=ideaf-sso`. If it wants signed requests, add our key and certificate as files in `auth.sso.saml.sp_key` and `auth.sso.saml.sp_cert`.

People are matched on their email, so switching keeps everyone's ideas and tokens, and someone new picks a handle on their first visit. That trusts the provider's emails: use a provider where people can't set their own email (as with Okta, Entra or Google Workspace, where it comes from the company directory), or someone could set a colleague's address and reach their account. Email codes and passkeys are then off, except an email code for site admins, for when the provider is down. **SCIM:** with `auth.scim_token` (at least 32 characters) set, the provider's SCIM client, at `<url>/api/auth/scim/v2` with that bearer token, can add people ahead of their first sign-in and deactivate people removed there. To try it locally, the docker sandbox has a Keycloak ([docker/README.md](docker/README.md)).

With the dev server running and the cli signed in, it works like this (`bun run --filter @ideaf/cli build` makes `packages/cli/dist/ideaf`, or run `bun packages/cli/src/main.ts`):

```
ideaf start docs --title "Offline mode"   # an idea from the Markdown in docs/
ideaf show --blocks                       # sections and blocks with their IDs
ideaf edit batch.json --dry-run           # what a batch would do, and to each comment
ideaf edit batch.json                     # one new version
ideaf pull                                # the result into your files (3-way merge)
ideaf sync                                # your local edits back up, with their bases
```

The API is under `/api`, and every route is described at `/api/openapi.json`. From code, use the typed client: `createApiClient({ baseUrl, token })` from `@ideaf/api`.

The Markdown size limits default to 256 KB per file and 2 MB per idea; `limits.max_file_bytes` and `limits.max_idea_bytes` change them (until the site admin page exists).

**Several worktrees at once** (for example one per agent): each worktree gets its own data folder, Rivet Engine port and dev server port, so they never share an engine or each other's actors. The main worktree uses the defaults (engine 6420, server 8080); a linked worktree gets fixed ports derived from its path. `bun run worktree` shows them, and `eval "$(bun scripts/worktree.ts env)"` sets `url` and the rest in a shell. `bun run dev`, `bun run test` and `bun run engine:stop` use them automatically, and `engine:stop` only stops this worktree's engines. Tests get an engine of their own, with fresh data in `.data/test` for every run, stopped when they finish.

```
git worktree add ../ideation-factory-auth -b spike/better-auth
cd ../ideation-factory-auth && bun install && bun run worktree
```

In development RivetKit starts a local Rivet Engine itself and keeps its data in `.data/` (in each worktree), with file contents in `.data/files/`; delete that folder to start fresh. Use `bun run test` rather than plain `bun test`: the actor tests refuse to start without this worktree's settings. The dev engine keeps running after the server exits; `bun run engine:stop` stops it.
