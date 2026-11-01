// Runs the real cli in process against the real server (its routes and idea
// actors on RivetKit's local engine), in temporary git repositories.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createApiClient } from '@ideaf/api'
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
 * default person without one. An access token, which the cli uses as is: a
 * personal token would be exchanged on every run, and auth.test.ts covers that.
 */
export async function token(handle = DEFAULT): Promise<string> {
  return (await signIn(await server(), handle)).jwt
}

/** A person's personal token (ideaf_…), for testing the cli's exchange. */
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
  return {
    dir,
    write,
    read: (path) => readFile(join(dir, path), 'utf8'),
    git,
    async ideaf(...argv) {
      const out: string[] = []
      const err: string[] = []
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
      })
      return { exit, out: out.join('\n'), err: err.join('\n'), json: () => JSON.parse(out.join('\n')) }
    },
  }
}
