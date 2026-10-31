// Runs the real cli in process against the real server (its routes and idea
// actors on RivetKit's local engine), in temporary git repositories.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createApiClient } from '@ideaf/api'
import { main } from '@ideaf/cli/main.ts'
import { createApp } from '@ideaf/server/app.ts'
import { startTestActors } from '@ideaf/server/testing.ts'

const TOKEN = 'e2e-token'
let app: ((request: Request) => Promise<Response>) | null = null

export async function server(): Promise<(request: Request) => Promise<Response>> {
  if (app) return app
  app = createApp({ actors: await startTestActors(), devToken: TOKEN, validateOutput: true })
  return app
}

/** The typed API client, as another person or agent would use it. */
export function api() {
  return createApiClient({ baseUrl: 'http://ideaf.test', token: TOKEN, fetch: (r) => app!(r), validateOutput: true })
}

export interface Repo {
  dir: string
  /** Runs `ideaf …` here. */
  ideaf(...argv: string[]): Promise<{ exit: number; out: string; err: string; json: () => any }>
  write(path: string, content: string): Promise<void>
  read(path: string): Promise<string>
  git(...args: string[]): string
}

export async function repo(files: Record<string, string> = {}, options: { git?: boolean; token?: string | null; env?: Record<string, string> } = {}): Promise<Repo> {
  const dir = await mkdtemp(join(tmpdir(), 'ideaf-e2e-'))
  const git = (...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`)
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
  for (const [path, content] of Object.entries(files)) await write(path, content)
  const handler = await server()
  return {
    dir,
    write,
    read: (path) => readFile(join(dir, path), 'utf8'),
    git,
    async ideaf(...argv) {
      const out: string[] = []
      const err: string[] = []
      const token = options.token === undefined ? TOKEN : options.token
      const exit = await main(argv, {
        cwd: dir,
        env: { IDEAF_URL: 'http://ideaf.test', ...(token ? { IDEAF_TOKEN: token } : {}), ...options.env },
        out: (t) => out.push(t),
        err: (t) => err.push(t),
        interactive: false,
        prompt: () => null,
        fetch: handler,
      })
      return { exit, out: out.join('\n'), err: err.join('\n'), json: () => JSON.parse(out.join('\n')) }
    },
  }
}
