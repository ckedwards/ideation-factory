// PROTOTYPE DEMO: serves both prototypes (built into ./dist by scripts/build.mjs)
// behind HTTP basic auth.
//   /                 experiment 2: the site (home, notifications, teams, …)
//   /prototype/idea   experiment 1: the idea page
// The login comes from the BASIC_AUTH_USER and BASIC_AUTH_PASS secrets. With
// either missing, nothing is served.

const REALM = 'Ideation Factory prototypes'

export default {
  async fetch(request, env) {
    if (!env.BASIC_AUTH_USER || !env.BASIC_AUTH_PASS) {
      return new Response('Not configured: set the BASIC_AUTH_USER and BASIC_AUTH_PASS secrets.', { status: 500 })
    }
    if (!(await authorized(request, env))) {
      return new Response('Sign in to see the prototypes.', {
        status: 401,
        headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
      })
    }

    const url = new URL(request.url)
    // a page (no file extension) gets its app's index.html; the router takes it from there
    const isPage = !/\.[a-z0-9]+$/i.test(url.pathname)
    let response
    if (isPage) {
      const app = url.pathname === '/prototype/idea' || url.pathname.startsWith('/prototype/idea/') ? '/prototype/idea/index.html' : '/index.html'
      response = await env.ASSETS.fetch(new Request(new URL(app, url), request))
    } else {
      response = await env.ASSETS.fetch(request)
    }

    const headers = new Headers(response.headers)
    headers.set('X-Robots-Tag', 'noindex, nofollow')
    // behind a password: don't let shared caches keep copies
    headers.set('Cache-Control', isPage ? 'private, no-store' : 'private, max-age=3600')
    return new Response(response.body, { status: response.status, headers })
  },
}

async function authorized(request, env) {
  const header = request.headers.get('Authorization') ?? ''
  const [scheme, encoded] = header.split(' ')
  if (scheme !== 'Basic' || !encoded) return false
  let decoded
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)))
  } catch {
    return false
  }
  const at = decoded.indexOf(':')
  if (at < 0) return false
  // compare both parts in constant time (hash first so lengths don't leak)
  const [user, pass] = await Promise.all([equal(decoded.slice(0, at), env.BASIC_AUTH_USER), equal(decoded.slice(at + 1), env.BASIC_AUTH_PASS)])
  return user && pass
}

async function equal(a, b) {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  return crypto.subtle.timingSafeEqual(ha, hb)
}
