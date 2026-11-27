# Spike: Better Auth for sign-in, tokens and MCP

**Status:** planned. Throwaway code; the answer goes into [backend](architecture-backend.md). Runs alongside the [Rivet spike](spike-rivet.md), on the same platform.

## The question

Should Ideation Factory use [Better Auth](https://better-auth.com) for sign-in (email codes and passkeys), sessions and tokens, and as the OAuth authorization server for MCP?

## Why we're asking

The backend runs on Bun with Rivet actors, on infrastructure the customer chooses (see the [overview](architecture.md)). We need:

- **Email codes and passkeys,** no passwords, plus our own account rules.
- **15-minute signed access tokens** for every request, checked by signature alone, so authentication never touches the directory actor.
- **An MCP authorization server** with OAuth 2.1, and **CIMD** (Client ID Metadata Documents), which the 2026-07-28 MCP spec recommends, with Dynamic Client Registration deprecated.

Better Auth covers all of that in one TypeScript library:
- **Sign-in:** email one-time codes, passkeys, usernames.
- **Tokens:** JWT signing with a key set (JWKS), and API keys.
- **MCP:** an OAuth 2.1 provider with an MCP plugin that issues **JWT access tokens**.
- **CIMD,** with a safe fetch transport for Node.

Writing our own OAuth server is ruled out. Cloudflare's `workers-oauth-provider` only runs on Workers, so it doesn't apply.

## What it needs to show

1. It runs **on Bun**, with its storage in our **directory actor** (see below).
2. **MCP works end to end with real clients,** including CIMD, using 15-minute JWT access tokens and no storage read per request.
3. **Our account rules fit** through configuration or hooks, without patching the library.

If 1 and 2 hold, it's our MCP authorization server. If 3 holds too, it's our whole auth layer.

## Setup

A small Bun app in `experiments/spike-better-auth/`, inside the Rivet spike's app if that's running:

- **Better Auth v1.8 (beta).**
- **Storage:** Better Auth talks to a database through an adapter. We have no database server, only the directory actor's SQLite. Two ways to try, in order:
  1. **A custom adapter** whose reads and writes call the directory actor's actions. Better Auth supports custom adapters.
  2. **Better Auth's own SQLite adapter, run inside the directory actor,** with the HTTP handler forwarding its calls there.

  Record which works, and what each costs.
- **Plugins** (names per the docs today; confirm before starting, since 1.8 is beta):
  - email one-time codes;
  - passkeys;
  - usernames (for handles);
  - JWT (signing keys and `/jwks`);
  - OAuth 2.1 provider plus `@better-auth/mcp` and `@better-auth/cimd`;
  - API keys (for personal tokens), if it fits.
- **A stub MCP server** with one or two tools (for example `list_ideas` and `add_comment`), protected by the issued tokens.
- **A minimal consent page** where the token's purpose is chosen ("me", "a bot for me" plus a bot name, or "a bot").
- **A fake email sender** that logs codes, so no real email is needed.

## Experiments

Each has a pass condition. Record results in Findings, below.

### Runs on Bun, stored in the directory actor

- [ ] **Starts under Bun** with the plugins above. **Pass:** no Node-only APIs block it, or the workarounds are small and recorded.
- [ ] **Storage through the directory actor** (either approach above). **Pass:** sign-up, sign-in, sessions and tokens all work, and the schema lives in the directory actor's SQLite.
- [ ] **Schema migrations** generate and apply. **Pass:** no manual SQL beyond what its migration tooling produces, adapted to run inside the actor.

### MCP, end to end

- [ ] **Discovery:** authorization server metadata (RFC 8414) and protected resource metadata (RFC 9728), and a `WWW-Authenticate` header pointing at it on a 401. **Pass:** the MCP Inspector discovers and signs in without manual configuration.
- [ ] **Authorization code with PKCE (S256 only),** exact redirect URI matching, `iss` in the response (RFC 9207), and resource indicators (RFC 8707), so tokens are bound to our server. **Pass:** each is enforced. Try a missing PKCE verifier, the wrong redirect URI and the wrong resource, and each is rejected.
- [ ] **Access tokens are JWTs with a 15-minute lifetime,** checked by signature against `/jwks`. **Pass:** a request to the stub MCP server makes **zero directory calls** for authentication.
- [ ] **Refresh tokens** rotate, and reusing an old one is rejected. **Pass:** reuse fails and, ideally, revokes that grant.
- [ ] **Token claims carry the purpose** (and bot name) chosen on the consent screen. **Pass:** the MCP stub can label actions "🤖 planbot on behalf of Riley" from the token alone.
- [ ] **Real clients:** Claude Code, Claude.ai (connectors), VS Code, ChatGPT, and the MCP Inspector. **Pass:** each connects and calls a tool. Note which register with CIMD, and which still need Dynamic Client Registration.
- [ ] **Dynamic Client Registration:** off by default (it's deprecated). **Decide** whether to enable it for older clients, based on the client results.

### CIMD

- [ ] **The Node transport under Bun:** `@better-auth/cimd/node` resolves the hostname once, refuses non-public addresses, pins the connection and refuses redirects. **Pass:** it runs under Bun, and a CIMD URL that resolves to a private address (`10.x`, `127.x`, `169.254.x`, IPv6 local) is refused. Desk check: the transport pins the address through `node:https`'s `lookup` option, and Bun's `node:https` client has been built on `node:net` (which honors `lookup`) since mid-2026 (Bun PR #31587), so it should work on a current Bun. If it doesn't, record what's missing; writing the equivalent with Bun's DNS and socket APIs is the fallback.
- [ ] **Host allowlist** with `isMetadataDocumentUrlAllowed()`. **Pass:** with the allowlist on, a client from an unlisted host is refused. A deployment could choose this as a stricter option.
- [ ] **Metadata caching:** check `metadataRevalidationInterval` and the fetch limits. **Pass:** repeat sign-ins don't refetch every time, and a flood of client IDs can't make us fetch without limit.

### Our account rules

- [ ] **No passwords:** email codes and passkeys only. **Pass:** password sign-up and sign-in are off.
- [ ] **A passkey can only be added right after an email-code sign-in,** never from an older session. **Pass:** a hook refuses passkey registration unless the session was just created by an email code.
- [ ] **The primary email can't be changed.** **Pass:** the change-email path is off.
- [ ] **Handles:** unique, 2–39 characters, lowercase letters, numbers and `. - _` in the middle, with reserved words refused, and not changeable. **Pass:** enforced by configuration or a hook.
- [ ] **Personal tokens with a purpose:** a bot name, at most a year, stored hashed, shown once, and never carrying site admin powers. The cli exchanges one for a 15-minute JWT. **Pass:** the API keys plugin (or a hook) does it, and the exchange returns a JWT our API accepts without a directory call.
- [ ] **Site admin tokens:** separate, need a reason, at most 30 days, every use logged. **Pass:** possible without patching; otherwise note what's missing.
- [ ] **Revocation within 15 minutes:** revoke a token, sign out a session, and mark a user inactive. **Pass:** no new short-lived tokens are issued at once, and existing ones expire within 15 minutes.
- [ ] **Writes refused at once for inactive users.** **Pass:** a write path (like the stub's `add_comment`) checks current status through a hook or middleware.
- [ ] **Rate limiting:** check what Better Auth limits on its own (sign-in, email codes, token and registration endpoints), and where it keeps its counters (memory, the database, or a secondary store). **Pass:** the limits don't write to the directory actor on every request. If they would, configure memory storage or note what's needed (see concern 3 in [scale concerns](scale-concerns.md)).

### The cli

- [ ] **`ideaf auth login`** from a terminal: the device authorization flow (RFC 8628) if Better Auth supports it, or a browser sign-in with a redirect back to a local port. **Pass:** the cli ends up with a long-lived token in `Bun.secrets` and can exchange it for 15-minute JWTs.

### Stretch

- [ ] **Single sign-on** (SAML/OIDC) with automatic account creation, against a test identity provider.
- [ ] **DPoP-bound tokens** (RFC 9449) with a client that supports them.

## What to measure

| Measure | Target |
|---|---|
| Directory calls to authenticate an MCP or API request | 0 |
| Directory calls per client to refresh | 1 per 15 minutes |
| Auth check time (signature verification) | Well under 1 ms |
| Directory calls per sign-in | Recorded; sign-ins are rare, but each goes through the one directory actor |
| Lines of glue code (adapter, hooks, transport, consent page) | Recorded |

## Deciding

- **Go (MCP):** it runs on Bun with storage in the directory actor, MCP works with the major clients using 15-minute JWTs and no auth read, and the CIMD transport runs under Bun.
- **Go further (all auth):** our account rules fit without patching, and the personal-token exchange works.
- **No-go:** it won't run on Bun, its storage can't reasonably live in the directory actor, the MCP flow fails with the major clients, or key rules would need patching. Then we look for another maintained OAuth library for MCP; we don't write our own.

## Risks

- **The MCP plugin is beta (v1.8).** APIs may change before stable, so we'd follow it through upgrades.
- **Storage through an actor is unusual for Better Auth.** If the adapter is awkward, sign-in becomes one more source of directory traffic to watch.
- **Hooks might not reach every rule.** For example "passkeys only right after an email code", or token purposes. Patching the library would be a no-go.
- **A bigger dependency:** adopting it for all of auth means following a large library's releases and security advisories.
- **Security review:** whatever we choose, the sign-in and token paths get an outside review before launch.

## Time limit

**One week.** Stop early on a clear no-go (it won't run on Bun with the directory actor, or MCP fails with the major clients).

## Findings

**Status (2026-10-31, day 1):** everything ran except the real clients and DPoP. Single sign-on, treated here as a main sign-in mode rather than a stretch goal (most companies will use it), ran against a real identity provider. The code is in `experiments/spike-better-auth/`. `src/flow.ts` drives every check over HTTP, the way a browser, an MCP client and the cli would, and its output is in `results-*.txt`. ✅ pass, ◐ partly checked, ⏳ not yet run.

**Verdict so far: go, for MCP and for all of auth, single sign-on included.** It runs on Bun with its tables in a directory actor. The MCP flow works with 15-minute JWTs and no auth read per request. Every account rule fits with configuration, hooks and one small plugin of our own, with no patching. OIDC, SAML and SCIM all worked against Keycloak, and they **need approach 2** (native transactions). The one open item is connecting the real clients (below).

**Versions.** MCP and CIMD aren't beta-only any more: `@better-auth/mcp` and `@better-auth/cimd` shipped in the stable 1.7 line (1.7.0, 2026-08-18). The spike pins **1.7.14** exactly: `better-auth`, `@better-auth/oauth-provider`, `@better-auth/mcp`, `@better-auth/cimd`, `@better-auth/passkey`, `@better-auth/api-key`, `@better-auth/sso` and `@better-auth/scim` (all MIT). The SSO plugin brings `samlify`, `@xmldom/xmldom` and `fast-xml-parser` for SAML. Email codes, usernames, JWT and device login are in `better-auth/plugins` and `@better-auth/oauth-provider`. Alongside it: `rivetkit` 2.3.31, `@modelcontextprotocol/sdk` 1.32.2 and Bun 1.4.3. 1.8 is at beta.3. Its notes so far change device-code approval and polling, and its MCP docs move to MCP SDK v2, so we stay on 1.7 until 1.8 is stable.

### Runs on Bun, stored in the directory actor

- ✅ **Starts under Bun** with every plugin listed, passkeys included. There were no Node-only blockers and no workarounds.
- ✅ **Storage through the directory actor: both approaches work,** and each passes the whole flow (49 of 49 checks). **Approach 2 is the better fit:** about a fifth of the directory traffic, real transactions, and Better Auth's own migrations.

  | | 1. Custom adapter calling the actor | 2. Better Auth inside the actor |
  |---|---|---|
  | Where Better Auth runs | App nodes; each adapter operation is one actor action | The directory actor; app nodes forward `/api/auth/*` and the OAuth metadata to it as an action |
  | Glue | Adapter (55 lines) plus our SQL for its ten operations (181 lines) | A Kysely dialect over `c.db` (142 lines) plus forwarding (about 60) |
  | Schema | Better Auth's `getMigrations` run against an empty SQLite to make `schema.sql`, applied in `onMigrate` | `getMigrations` run in `onMigrate` itself |
  | Transactions | None; its race-sensitive steps (`consumeOne`, `incrementOne`) are single statements | Yes; Kysely's begin/commit are mapped onto `c.db.transaction` (one per sign-in) |
  | Directory calls per sign-in (send a code, then sign in) | 11 (13 for a sign-up) | 2 |
  | Per refresh | 7 (10 without caching the JWKS and resource) | 1 |
  | Per personal-token exchange | 3, plus 1 status read | 2, plus 1 status read |
  | Session read / email-code sign-in (local, over a connection) | 7 ms / 26 ms | 4 ms / 17 ms |
  | Rate-limit counters | In memory on each app node, so limits multiply with nodes | In memory in the actor: one count for the site |
  | Single sign-on and SCIM | **Doesn't work:** SCIM refuses to start, and the SSO `resolveUser` hook refuses to run, without native transactions | Works |
  | Schema changes later | `schema.sql` is applied once; adding a column (as SSO did) needs our own migration step | `getMigrations` adds new tables and columns on the next start |

  **What approach 2 costs:** all auth work runs on the directory actor's node: CIMD fetches to the internet, sending email, hashing and signing. Its in-memory state (rate-limit counters, the CIMD cache) is lost when the actor moves. App nodes need a small RPC for server-side `auth.api` calls (the token exchange). The **Postgres escape hatch** is simple either way: Better Auth runs on the app nodes against Postgres through its own Kysely adapter.
- ✅ **Schema migrations** come from Better Auth's own tooling in both approaches, with no hand-written SQL. Approach 2 runs `getMigrations` inside `onMigrate`, which needs no transaction of its own (see the Rivet spike's savepoint note).
- **Found on the way, for the Rivet spike and step 5:** a stateless action call (`handle.action()`) costs about **88 ms** on the local engine, whatever it does. The same call **over a connection** (`handle.connect()`, a WebSocket) costs **1.6 ms**. The first runs here took 270 ms per session read and over a second per sign-in. Both approaches now keep one connection per app node.

### Tables for step 6

Better Auth 1.7.14 with these plugins needs **15 tables**, plus **1 for single sign-on and 7 for SCIM** (23 in all). Every column, type and index is in `experiments/spike-better-auth/schema.md`, generated from SQLite.

| Table | From | What it holds |
|---|---|---|
| `user` | core, plus the username plugin and our `inactive` and `handleConfirmed` | id, name, email (unique), emailVerified, image, createdAt, updatedAt, username (unique), displayUsername, inactive, handleConfirmed |
| `session` | core, plus our two fields | id, token (unique), userId, expiresAt, ipAddress, userAgent, createdAt, updatedAt, signInMethod, oauthPurpose |
| `account` | core | Per-provider credentials (password, social tokens). Required by the schema but unused here: email-code users get no account row |
| `verification` | core | One-time codes: identifier, value, expiresAt; deleted on use |
| `jwks` | JWT | Signing keys: public key, private key (encrypted with the auth secret), alg, crv, expiresAt |
| `passkey` | passkeys | userId, credentialID, publicKey, counter, deviceType, backedUp, transports, aaguid, name |
| `apikey` | API keys | configId (`personal` or `admin`), name, prefix, start, key (SHA-256), referenceId (user), expiresAt, metadata (purpose, bot, reason), enabled, plus unused refill and rate-limit counters |
| `oauthClient` | OAuth provider | One row per client, including CIMD clients (`clientDiscoveryId = cimd`): clientId (the CIMD URL), redirectUris, grant types, auth method, … |
| `oauthResource`, `oauthClientResource` | OAuth provider | The MCP resource, and which clients may ask for it (RFC 8707) |
| `oauthConsent` | OAuth provider | clientId, userId, scopes, resources, referenceId (our purpose) |
| `oauthRefreshToken` | OAuth provider | token (hashed), clientId, userId, sessionId, referenceId, scopes, resources, expiresAt, revoked, rotation fields |
| `oauthAccessToken` | OAuth provider | Opaque access tokens only; empty with JWT access tokens |
| `oauthClientAssertion` | OAuth provider | Replay guard for `private_key_jwt` assertions |
| `deviceCode` | device login | deviceCode, userCode, userId, status, clientId, scope, resources, expiresAt, polling fields |
| `ssoProvider` | SSO | A provider registered at runtime: issuer, providerId, domain, userId (the admin who added it), oidcConfig or samlConfig as JSON. Empty when the provider is set in config |
| `scimUser`, `scimSubject`, `scimConnectionBinding`, `scimIdentityTombstone`, `scimGroup`, `scimGroupMember`, `scimProjectionGrant` | SCIM | The provider's view of each person (externalId, userName, emails, active) linked to `user.id`, plus groups and lifecycle bookkeeping |

**Mapping onto a minimal directory user** (ID, handle, name, email, inactive): ID ← `user.id`; handle ← `user.username`; name ← `user.name` (not null, `''` when not given); email ← `user.email`; inactive ← our `inactive` field. Better Auth also needs `emailVerified`, `image`, `createdAt` and `updatedAt`, and the username plugin adds `displayUsername` (set to the handle). `user.modelName` and `user.fields` can point Better Auth at step 5's users table and its column names, and `advanced.database.generateId` sets our ID format. All the other tables are Better Auth's own, so step 6 only maps the user.

### MCP, end to end

- ◐ **Discovery:** RFC 8414 authorization server metadata (with `client_id_metadata_document_supported`, S256 only, and `authorization_response_iss_parameter_supported`), RFC 9728 protected resource metadata at `/.well-known/oauth-protected-resource/mcp`, and a 401 carrying `WWW-Authenticate: Bearer resource_metadata=…`. All checked by script, and Claude Code, VS Code and the MCP Inspector each found the metadata from the 401 alone (the Inspector then stops: it needs Dynamic Client Registration).
- ✅ **PKCE (S256 only), exact redirect URIs, `iss` and resource indicators** are each enforced. Each of these was refused:
  - authorizing without a challenge;
  - `plain` PKCE;
  - a token request without a verifier, or with the wrong one;
  - a redirect URI that wasn't registered (the error goes to our own error page, never to that URI);
  - an unknown resource at authorize, and a different resource at the token endpoint.

  Codes are single use, and **reusing a code also revokes the tokens it issued.** Loopback redirects match on any port (RFC 8252).
- ✅ **Access tokens are 15-minute EdDSA JWTs.** 200 MCP calls made **zero directory calls**, and a signature check takes **about 0.1 ms** (jose, Ed25519, Bun). The audience is the MCP resource, plus the userinfo endpoint when `openid` is asked for. `createMcpProtectedRequestHandler` does the check, with `jwksUrl`, issuer, audience and an algorithm allowlist.
- ✅ **Refresh tokens rotate.** Reusing an old one after the grace period is refused **and revokes the whole grant**: the newer refresh token stops working too. `mcp()` sets a 30-second `refreshTokenReuseInterval`, so a retry within 30 s gets the same response back. That's on purpose, for clients that retry. Set it to `0` for strict reuse detection.
- ✅ **The token carries the purpose and bot name** chosen on the consent screen. The stub labels a comment "🤖 planbot on behalf of Riley" from the token alone, and the purpose survives refresh. How it works:
  1. The consent page posts the choice to one endpoint of ours, which stores it on the session.
  2. `postLogin.consentReferenceId` returns that choice, so Better Auth keeps it as the consent's `referenceId`.
  3. `customAccessTokenClaims` turns the `referenceId` back into `purpose` and `bot` claims.

  One caveat: a re-authorization that skips the consent screen reuses the session's last choice, so we should always ask for consent when the purpose matters.
- ◐ **Real clients** (checked on 27 November against the local test site, `scripts/test-ui.sh`):
  - ✅ **Claude Code** signs in with its CIMD document (`https://claude.ai/oauth/claude-code-client-metadata`), lists the 25 tools and calls them. A comment it added is labeled with the bot: `{user, bot: "claude-code", purpose: "bot-for-me"}`.
  - ✅ **VS Code's own MCP client** (`.vscode/mcp.json`, the Local chat) signs in from the browser and calls whoami. It doesn't sign in on its own when a chat starts the server: start it from **MCP: List Servers** and accept the prompt.
  - ✗ **The Copilot CLI session in VS Code** is a separate client. Its sign-in failed with "State does not match" on Copilot's side: our server returns the `state` it's given (`auth/oauth.test.ts`), and the other clients check it. Probably an older sign-in tab finishing last.
  - ✗ **The MCP Inspector** (v2.17) needs Dynamic Client Registration, which stays off. A personal token in the header works at `/mcp` instead (`mcp.test.ts`), though not yet tried from the Inspector.
  - ⏳ **Claude.ai and ChatGPT** aren't checked yet: they need a public HTTPS URL.

  **A client's name is what it claims.** With no sign-in of its own, Copilot's agent found Claude Code's client ID in Claude Code's logs and signed in with it from its own loopback port. That's allowed: loopback redirects match on any port (RFC 8252), so a desktop client's CIMD document can't tell it from an imitation. The consent page said Claude Code, and its work would have been labeled as Claude Code. whoami now returns the bot and purpose with the person, so an agent can see the label its work will carry.

- **Dynamic Client Registration: leave it off.** All four named clients use CIMD. It's a config flag if a client we need turns out to lack CIMD: `allowDynamicClientRegistration`, plus `allowUnauthenticatedClientRegistration` for open registration. Its endpoint is rate-limited to 5 a minute by default.

### CIMD

- ✅ **The Node transport works under Bun 1.4.3.** Bun's `node:https` honors `lookup`: pinning example.com to an unroutable address made no connection. With the real address pinned, TLS still checks the hostname, through SNI and the certificate. These were refused:
  - `127.0.0.1`, `10.x`, `169.254.169.254`, `[::1]` and `localhost`;
  - public names resolving to `127.x` and `100.64.x`;
  - plain `http`.

  Redirects come back to the caller unfollowed. This machine's resolver drops private answers for public names, so `10.x`, `192.168.x`, link-local and IPv6-local names couldn't be tested live. Instead, the address check the transport applies to every DNS answer was run on 21 private and special-use addresses (IPv4 and IPv6, including mapped, NAT64 and 6to4); it refused all 21 and allowed public ones.
- ✅ **Host allowlist:** with `isMetadataDocumentUrlAllowed` limited to `vscode.dev`, VS Code is accepted. Claude Code is refused before anything is fetched.
- ✅ **Caching and limits:**
  - A fetched document is cached in memory, by default for 60 minutes and up to 1,000 entries; five repeat authorizations fetched nothing.
  - **Per origin:** 60 new client IDs on one origin, sent from 60 IPs, caused exactly 30 fetches, then `429`. Defaults: 30 a minute per origin, 120 a minute in all, 16 at once.
  - **Per IP:** the provider's own limit of 30 authorizations a minute applies before that.

  Each *valid* new document creates an `oauthClient` row, so client rows grow with the number of distinct real clients.

### Our account rules

- ✅ **No passwords:** email and password is off by default; sign-up and sign-in with a password are refused.
- ✅ **A passkey only right after an email-code sign-in:** a session hook records how each session was created. A `before` hook on the two passkey registration endpoints refuses unless the session came from an email code within the last 5 minutes. A 10-minute-old session is refused. The full WebAuthn ceremony isn't exercised (it needs an authenticator); the registration options and the refusal are.
- ✅ **The primary email can't change:** both change-email paths are off by default and refuse.
- ✅ **Handles:** the username plugin gives 2–39 characters, our validator, immutability and uniqueness ("Username is already taken", a clean 400). **Its validator only runs on password sign-up and `update-user`,** so on email-code sign-up the handle is enforced by our `databaseHooks.user.create.before`. Invalid, reserved and missing handles were each refused.
- ✅ **Personal tokens with a purpose:** the API key plugin's `personal` configuration gives an `ideaf_` prefix, a required name, at most a year, a stored SHA-256 hash, and the key shown once. A hook allows only our purposes and bot names, and refuses any `site_admin` claim. **The exchange is about 40 lines of ours:** verify the key, check the user's status, sign a 15-minute JWT. That JWT verifies by signature alone. Verifying a key writes its `lastRequest` (one write per exchange). The plugin's per-key rate limit is off, or it would count every use in the directory.
- ✅ **Site admin tokens:** a second `admin` configuration, at most 30 days. A hook allows only site admins and requires a reason, and the exchange logs every use (the stand-in for an audit log). It needs no patching.
- ✅ **Revocation within 15 minutes:**
  - A revoked personal token gets no new JWT.
  - A signed-out session gets no new JWT.
  - An **inactive** user gets no refresh, no exchange, no session JWT and no sign-in (403).
  - JWTs already issued keep reading until they expire.

  "Inactive" is our own field. Setting it deletes the user's sessions and revokes their refresh tokens, and the user is checked again in `customAccessTokenClaims`, the JWT plugin's `definePayload` and the session-create hook. (Returning `false` from that hook gives a 500; throwing `APIError` gives a clean 403.)
- ✅ **Writes refused at once for inactive users:** the stub's `add_comment` reads the user's current status (one directory read, on writes only). Reads with an existing JWT still work.
- ✅ **Rate limiting:** on by default, in memory, with rules per path:
  - email codes 3 a minute per IP;
  - authorize 30 a minute;
  - token 20 a minute;
  - registration 5 a minute.

  Nothing is written to the directory. Behind a load balancer it needs `advanced.ipAddress.ipAddressHeaders` (`X-Forwarded-For`); without it, every client shares one bucket.

### The cli

- ◐ **`ideaf auth login` by device flow (RFC 8628):** `oauthDeviceAuthorization()` from `@better-auth/oauth-provider` issues real OAuth tokens: a 15-minute JWT and a refresh token. The verification page must claim the code (`GET /device?user_code=…`, signed in) before approving it. The cli side, keeping the token in `Bun.secrets`, isn't built yet. The other path, a personal token exchanged for a JWT, works (above).

### Single sign-on

One identity provider for the whole deployment, set by the site admin; no tenants. Checked against **Keycloak 26.8.1** in a container, through its real login form, by `src/sso-flow.ts` (35 of 35 checks, `results-sso.txt`). `src/kc-setup.ts` sets up the realm.

- ✅ **OIDC and SAML 2.0 both work** with `@better-auth/sso`. OIDC was set in config (`defaultSSO`, install-time). SAML was added at runtime by a site admin from the provider's metadata (`POST /sso/register`, stored in `ssoProvider`), as a Site admin page would; our SP metadata is served for the admin to give the provider.
- ✅ **Switching an existing deployment keeps accounts:** alice signed up with an email code and made a personal token, then signed in through OIDC and SAML. Both reached the same account (matched on primary email), with her handle kept, and her token still worked.
- ✅ **Who gets in** is decided by one hook of ours, `resolveUser`, which runs inside the sign-in's transaction and can link, refuse or let Better Auth create the account. Ours (about 30 lines):
  1. A provider subject seen before → that account.
  2. Otherwise, match on primary email.
  3. Otherwise, create an account if automatic creation is on; with it off, a new person is refused ("ask a site admin to invite you") and existing accounts still sign in.

  It also refuses **emails outside the allowed domains** (no account is made) and **inactive accounts**.
- ✅ **New accounts:** name from the provider, a handle suggested from the email (`carol.jones+x@` → `carol.jones-x`, with `-2` when taken), marked unconfirmed. On first visit the person keeps or changes it once (`/ideaf/confirm-handle`); a second change and a taken handle are refused.
- ✅ **Email changes at the provider:** same account (matched by subject), and the primary email follows. If the new email belongs to another account, sign-in is refused.
- ✅ **Email codes and passkeys are off while SSO is on,** except an email code for site admins, as the way in when the provider is down. Sessions record `signInMethod: sso`.
- ✅ **Only site admins can add a provider,** and only one (`providersLimit`). By default any signed-in user could register up to 10, which, with email matching, would let them sign in as others.
- ✅ **MCP clients under SSO:** authorize → our login page → Keycloak → back → consent → a 15-minute JWT for the right user. Better Auth carries a pending authorization through social sign-in but **not through SSO**, so the login page sends the browser back to the original authorize URL (`callbackURL`), which then continues as usual.
- ✅ **SAML security:**
  - the response is posted to our ACS cross-site without our cookies (as browsers do with SameSite=Lax) and works;
  - a captured response replayed in another browser is refused (InResponseTo validation);
  - a response edited to name another email is refused, and so is one with its signatures stripped.
- ✅ **SCIM deprovisioning** with `@better-auth/scim` (bearer token per connection, `/api/auth/scim/v2/Users`):
  - a person created by SCIM gets an account ahead of their first sign-in;
  - SCIM for someone who already has an account links to it (no duplicate);
  - `active: false` marks them **inactive, deletes their sessions and revokes their refresh tokens** (our `identity.reconcileUser`, in SCIM's transaction); SSO sign-in and token exchange are then refused, and reactivating lets them back in.

  Keycloak doesn't push SCIM itself, so the checks call the endpoints as Okta or Entra would.
- **Needs approach 2.** SCIM refuses to start without native transactions, and so does SSO's `resolveUser`. With approach 1 the server doesn't start with SCIM loaded.

**Learned on the way:**
- **SAML registration names are easy to get wrong:** the top-level `issuer` becomes *our* SP entity ID (it replaces `samlConfig.issuer`), not the provider's.
- **Keycloak's metadata asks for signed requests,** and a mismatch shows up as a bare 500 (from `samlify`). With `authnRequestsSigned` and an SP key it works. The **SP private key is then stored in plain text** in `ssoProvider.samlConfig`: keep it in config or secrets, not in the table.
- **A provider on a private address** (an internal IdP, or Keycloak on localhost) is refused unless its origin is in `trustedOrigins`.
- Provider discovery and token calls go out from wherever Better Auth runs: the directory actor's node in approach 2.

### Stretch

- ⏳ **DPoP** wasn't tried, though the metadata advertises it (`dpop_signing_alg_values_supported`).

### Measures

| Measure | Target | Approach 1 | Approach 2 |
|---|---|---|---|
| Directory calls to authenticate an MCP or API request | 0 | 0 | 0 |
| Directory calls per client to refresh | 1 per 15 minutes | 7 | 1 |
| Auth check time (signature verification) | Well under 1 ms | about 0.1 ms | about 0.1 ms |
| Directory calls per sign-in | Recorded | 11 (13 for a sign-up) | 2 |
| Lines of glue code | Recorded | about 880 (see below) | about 790 |

The glue code is the same in both approaches except for storage. Shared:
- the configuration and rules, with the consent and exchange endpoints (282 lines, with comments; 452 with single sign-on and SCIM);
- the server, with the MCP stub and the exchange (200 lines, including spike-only endpoints);
- the pages (46 lines);
- the directory actor (117 lines).

Storage adds 236 lines for approach 1 (adapter and SQL), or 142 for approach 2 (the dialect; its forwarding is counted in the server and actor). The CIMD transport is the library's own.

**Also noted:**
- Signing keys are stored in the `jwks` table, encrypted with the auth secret. The JWT plugin's `adapter.getJwks` and `createJwk` let them come from secrets instead, as the backend doc plans. The spike uses them to cache keys for 5 minutes.
- Registering a client through the admin API needs a signed-in session.
- RivetKit logs "SQLite transaction is unnamed" warnings that are only noise.

## Sources

- [Better Auth MCP plugin (v1.8 beta)](https://better-auth.com/docs/beta/plugins/mcp)
- [Better Auth CIMD plugin and transport contract](https://better-auth.com/docs/beta/plugins/cimd)
- [MCP authorization spec, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
