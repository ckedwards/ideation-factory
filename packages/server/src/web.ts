// The web app's pages: every path that isn't the API, sign-in or /health.
//
// Built, the app is static files (packages/web/dist). A file is served as it
// is, and any other path gets index.html, where the app's router takes over.
// In development the server passes these requests on to the app's Vite dev
// server instead, so the browser still talks only to this server, as it does
// in production: one origin for the pages, the API, and sign-in's cookies and
// passkeys.
import { stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'

export type WebApp = (request: Request) => Promise<Response>

/** Vite puts the built app's code and styles here, each file named after a hash of its contents. */
const ASSETS = '/assets/'

/** The built app, from a folder (the web package's dist). */
export function staticWebApp(dir: string): WebApp {
  const root = normalize(dir)
  const index = join(root, 'index.html')
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Pages are only fetched with GET.', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('That address is malformed.', { status: 400 })
    }
    const path = normalize(join(root, pathname))
    // never outside the folder, whatever the path says
    if (path.startsWith(root + sep) && (await isFile(path))) {
      return new Response(Bun.file(path), {
        headers: {
          // a file named after its contents never changes; anything else (the icon, say) is checked again
          'cache-control': pathname.startsWith(ASSETS) ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      })
    }
    // a missing script or stylesheet is missing, not a page
    if (pathname.startsWith(ASSETS)) {
      return new Response('No such file.', { status: 404 })
    }
    if (!(await isFile(index))) {
      return new Response(
        'The web app isn’t built. Build it with `bun run --filter @ideaf/web build`, or run `bun run dev` to work on it.',
        { status: 503 },
      )
    }
    // the app itself, for its router to show the page; checked again each time, so a new build is picked up
    return new Response(Bun.file(index), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    })
  }
}

/** The app's Vite dev server, at a URL (web.dev_url, which `bun run dev` sets). */
export function devWebApp(base: string): WebApp {
  return async (request) => {
    const url = new URL(request.url)
    let response: Response
    try {
      response = await fetch(new URL(url.pathname + url.search, base), {
        method: request.method,
        headers: request.headers,
        redirect: 'manual',
      })
    } catch {
      return new Response(
        `The web app’s dev server isn’t running at ${base}. Start it and the server together with \`bun run dev\`.`,
        { status: 502 },
      )
    }
    // fetch has already decompressed the body
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(response.body, { status: response.status, headers })
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
