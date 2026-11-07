// The web app's pages, built (a folder of files) and in development (passed
// on to Vite's dev server).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devWebApp, staticWebApp } from './web.ts'

const get = (path: string, init?: RequestInit) => new Request(`http://ideas.test${path}`, init)

describe('the built app', () => {
  let dir: string
  let parent: string
  beforeAll(async () => {
    parent = await mkdtemp(join(tmpdir(), 'ideaf-web-'))
    dir = join(parent, 'dist')
    await mkdir(join(dir, 'assets'), { recursive: true })
    await writeFile(join(dir, 'index.html'), '<!doctype html><div id="app"></div>')
    await writeFile(join(dir, 'assets', 'main-a1b2c3.js'), 'console.log(1)')
    await writeFile(join(dir, 'favicon.svg'), '<svg/>')
    await writeFile(join(parent, 'secret.txt'), 'not for the web')
  })
  afterAll(() => rm(parent, { recursive: true, force: true }))

  test('a file is served as it is; one named after its contents is kept for good', async () => {
    const web = staticWebApp(dir)
    const script = await web(get('/assets/main-a1b2c3.js'))
    expect(await script.text()).toBe('console.log(1)')
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const icon = await web(get('/favicon.svg'))
    expect(icon.headers.get('cache-control')).toBe('no-cache')
  })

  test('any other path is a page: the app, for its router to show', async () => {
    const web = staticWebApp(dir)
    for (const path of ['/', '/teams/mobile', '/ideas/i123?file=plan.md']) {
      const page = await web(get(path))
      expect(page.status).toBe(200)
      expect(page.headers.get('content-type')).toContain('text/html')
      expect(await page.text()).toContain('<div id="app">')
    }
  })

  test('a missing script is missing, not a page', async () => {
    expect((await staticWebApp(dir)(get('/assets/gone-ffffff.js'))).status).toBe(404)
  })

  test('nothing outside the folder, however the path is written', async () => {
    const web = staticWebApp(dir)
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      expect(await (await web(get(path))).text()).not.toContain('not for the web')
    }
  })

  test('only GET; and without a build, it says how to make one', async () => {
    expect((await staticWebApp(dir)(get('/', { method: 'POST' }))).status).toBe(405)
    const unbuilt = await staticWebApp(join(parent, 'nothing'))(get('/teams'))
    expect(unbuilt.status).toBe(503)
    expect(await unbuilt.text()).toContain('bun run --filter @ideaf/web build')
  })
})

describe('in development', () => {
  test("requests go on to Vite's dev server, path and query kept", async () => {
    const vite = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        return new Response(`vite: ${url.pathname}${url.search}`, { headers: { 'content-type': 'text/javascript' } })
      },
    })
    try {
      const response = await devWebApp(`http://localhost:${vite.port}`)(get('/src/main.tsx?t=1'))
      expect(await response.text()).toBe('vite: /src/main.tsx?t=1')
      expect(response.headers.get('content-type')).toBe('text/javascript')
    } finally {
      await vite.stop()
    }
  })

  test('without it running, it says how to start it', async () => {
    const response = await devWebApp('http://localhost:1')(get('/'))
    expect(response.status).toBe(502)
    expect(await response.text()).toContain('bun run dev')
  })
})
