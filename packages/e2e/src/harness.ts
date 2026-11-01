// Runs the real cli in process against the real server (its routes and idea
// actors on RivetKit's local engine), in temporary git repositories.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createApiClient } from '@ideaf/api'
import { memoryStore } from '@ideaf/cli/credentials.ts'
import { main } from '@ideaf/cli/main.ts'
import { createApp } from '@ideaf/server/app.ts'
import { signIn, startTestActors, TEST_URL, testAuth } from '@ideaf/server/testing.ts'

/** The person a test is when it doesn't say. */
const DEFAULT = 'dev'
let app: ((request: Request) => Promise<Response>) | null = null

export async function server(): Promise<(request: Request) => Promise<Response>> {
  if (app) {
    return app
  }
  app = createApp({ actors: await startTestActors(), auth: testAuth, validateOutput: true })
  return app
}

/**
 * IDEAF_TOKEN for a person (by handle), signing them up the first time; the
 * default person without one. An access token from their session, so the
 * server checks it by signature; personal tokens (checked in the directory on
 * every request) are covered by auth.test.ts.
 */
export async function token(handle = DEFAULT): Promise<string> {
  return (await signIn(await server(), handle)).jwt
}

/** A person's personal token (ideaf_…), as CI would use. */
export async function personalToken(handle = DEFAULT): Promise<string> {
  return (await signIn(await server(), handle)).token
}

/** The typed API client, as another person or agent would use it (by handle, or the default dev user). */
export function api(handle = DEFAULT) {
  return createApiClient({
    baseUrl: TEST_URL,
    token: async () => (await signIn(await server(), handle)).jwt,
    fetch: (r) => app!(r),
    validateOutput: true,
  })
}

export interface Repo {
  dir: string
  /** Runs `ideaf …` here. */
  ideaf(...argv: string[]): Promise<{ exit: number; out: string; err: string; json: () => any }>
  write(path: string, content: string): Promise<void>
  read(path: string): Promise<string>
  git(...args: string[]): string
}

export async function repo(
  files: Record<string, string> = {},
  options: {
    git?: boolean
    /** IDEAF_TOKEN (from token() or personalToken()), null for none; the default person's without it. */
    token?: string | Promise<string> | null
    env?: Record<string, string>
    /** Pretend a person is at a terminal, answering prompts with these in turn (a number picks from a list). */
    answers?: string[]
    /**
     * A browser signed in as this person (by handle), approving \`ideaf auth
     * login\` with what the cli asked for. `local`: it opens here and hands the
     * code to the cli's listener on 127.0.0.1. `remote`: there's no browser
     * here, so it's opened elsewhere and the code pasted when the cli asks.
     */
    browser?: { as: string; mode?: 'local' | 'remote' }
  } = {},
): Promise<Repo> {
  const dir = await mkdtemp(join(tmpdir(), 'ideaf-e2e-'))
  const git = (...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })
    if (run.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`)
    }
    return run.stdout.toString().trim()
  }
  if (options.git !== false) {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'e2e@example.com')
    git('config', 'user.name', 'E2E')
  }
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  for (const [path, content] of Object.entries(files)) {
    await write(path, content)
  }
  const handler = await server()
  const defaultToken = options.token === undefined ? token() : null
  // this "machine's" sign-ins: never the real keychain
  const credentials = memoryStore()
  let lastOutput: string[] = []
  return {
    dir,
    write,
    read: (path) => readFile(join(dir, path), 'utf8'),
    git,
    async ideaf(...argv) {
      const out: string[] = []
      const err: string[] = []
      lastOutput = out
      const token = options.token === undefined ? await defaultToken : await options.token
      const exit = await main(argv, {
        cwd: dir,
        env: { IDEAF_URL: TEST_URL, ...(token ? { IDEAF_TOKEN: token } : {}), ...options.env },
        out: (t) => out.push(t),
        err: (t) => err.push(t),
        interactive: options.answers !== undefined,
        // each prompt is recorded in the output, with its options numbered from 1
        ask: async (question) => {
          out.push(`? ${question}`)
          if (question === 'Code' && options.browser) {
            // open the link the cli printed elsewhere, and paste what the page shows
            const link = lastOutput.join('\n').match(/https?:\/\/\S+\/oauth2\/authorize\?\S+/)?.[0]
            const shown = new URL(await approve(link!, options.browser.as))
            return `${shown.searchParams.get('code')}.${shown.searchParams.get('state')}`
          }
          return options.answers?.shift() ?? null
        },
        confirm: async (question) => {
          out.push(`? ${question} [y/N]`)
          return /^y(es)?$/i.test(options.answers?.shift() ?? '')
        },
        choose: async (question, choices) => {
          out.push(`? ${question}`)
          choices.forEach((c, i) => out.push(`  ${i + 1}) ${c.label}${c.hint ? ` (${c.hint})` : ''}`))
          const answer = Number(options.answers?.shift())
          return Number.isInteger(answer) ? answer - 1 : null
        },
        fetch: handler,
        credentials: async () => credentials,
        openBrowser: async (url) => {
          if (options.browser?.mode === 'remote' || !options.browser) {
            return false
          }
          // the browser lands on the cli's own listener, for real
          void approve(url, options.browser.as)
            .then((back) => fetch(back))
            .catch((error) => console.error('the pretend browser failed:', error))
          return true
        },
      })
      return { exit, out: out.join('\n'), err: err.join('\n'), json: () => JSON.parse(out.join('\n')) }
    },
  }
}

/**
 * A person's browser approving a sign-in: the authorize link, the consent page
 * (choosing what the cli asked for, as the page starts from it), and consent.
 * Returns where the browser is sent next, with the code.
 */
async function approve(link: string, handle: string): Promise<string> {
  const app = await server()
  const { cookie } = await signIn(app, handle)
  const authorize = await app(new Request(link, { headers: { cookie }, redirect: 'manual' }))
  const consent = new URL(authorize.headers.get('location')!, TEST_URL)
  const asked = consent.searchParams
  const list = (value: string | null) => (value ? value.split(',') : [])
  const limits = {
    teams: list(asked.get('ideaf_teams')),
    ideas: list(asked.get('ideaf_ideas')),
    noTeam: asked.get('ideaf_no_team') === '1',
  }
  const post = (path: string, body: unknown) =>
    app(
      new Request(`${TEST_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TEST_URL, cookie },
        body: JSON.stringify(body),
      }),
    )
  const chose = await post('/api/auth/ideaf/token-grant', {
    purpose: asked.get('ideaf_bot') ? (asked.get('ideaf_purpose') ?? 'bot-for-me') : 'me',
    ...(asked.get('ideaf_bot') ? { bot: asked.get('ideaf_bot') } : {}),
    readOnly: asked.get('ideaf_read_only') === '1',
    limits: limits.teams.length || limits.ideas.length || limits.noTeam ? limits : null,
    forConsent: true,
  })
  if (!chose.ok) {
    throw new Error(`choosing the token grant failed: ${await chose.text()}`)
  }
  // the signed part of the query, as the consent page hands it back
  const names = new Set(asked.getAll('ba_param'))
  const signed = new URLSearchParams()
  for (const [name, value] of asked.entries()) {
    if (name === 'sig' || name === 'ba_param' || names.has(name)) {
      signed.append(name, value)
    }
  }
  const given = (await (
    await post('/api/auth/oauth2/consent', { accept: true, oauth_query: signed.toString() })
  ).json()) as {
    url: string
  }
  return given.url
}
