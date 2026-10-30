# Prototype demo

Both prototypes as one password-protected site on Cloudflare, for showing people where the design is. It's throwaway, like the prototypes.

- `/`: experiment 2, the site (home, notifications, teams, groups, settings, site admin, sign-up preview).
- `/prototype/idea`: experiment 1, the idea page. "Offline-first sync for the field app" links there, and **← site** links back.
- `/prototype/idea?idea=mvp`: the MVP architecture docs (`mvp/`) as an idea in the **Dogfood** team. The docs are read when the demo is built, so run `npm run deploy` again after changing them.

It's a Cloudflare Worker with static assets. Every request goes through `src/worker.js` first, which checks HTTP basic auth before serving anything. With no password set, it serves nothing.

The demo build keeps the prototype switches (site admin, sign-up, state, external images), since they're how people explore. Everything still lives in the browser: each visitor gets their own copy of the canned data, and a reload resets it.

## Try it locally

```sh
npm --prefix experiments/demo install
npm --prefix experiments/demo run dev     # builds both prototypes, then serves them on http://localhost:8787
```

The local login is in `.dev.vars` (`demo` / `local-only-password`). That file is never uploaded.

## Put it on Cloudflare

```sh
cd experiments/demo
npx wrangler login                        # once; opens a browser
npm run deploy                            # builds both prototypes and deploys the worker
npx wrangler secret put BASIC_AUTH_USER   # the username to share
npx wrangler secret put BASIC_AUTH_PASS   # a long, random password
```

Until both secrets are set, the site answers every request with an error, so deploying first is safe.

- **Address:** Wrangler prints it, something like `https://ideaf-prototype-demo.<your-subdomain>.workers.dev`.
- **Updating:** run `npm run deploy` again. The secrets stay.
- **Search and caching:** pages are marked `noindex`, and shared caches don't keep copies.
- **Changing the password:** put a new `BASIC_AUTH_PASS`.
- **Taking it down:** `npx wrangler delete`.

## Files

| File | What it does |
|---|---|
| `scripts/build.mjs` | Builds both prototypes with the demo settings and merges them into `dist/` (experiment 1's page at `prototype/idea/index.html`) |
| `src/worker.js` | Basic auth (constant-time), then serves the right app's page for each URL |
| `wrangler.jsonc` | Worker and static-assets config |
