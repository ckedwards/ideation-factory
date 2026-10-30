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

_To be filled in during the spike._

## Sources

- [Better Auth MCP plugin (v1.8 beta)](https://better-auth.com/docs/beta/plugins/mcp)
- [Better Auth CIMD plugin and transport contract](https://better-auth.com/docs/beta/plugins/cimd)
- [MCP authorization spec, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
