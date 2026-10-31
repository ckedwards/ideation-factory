#!/usr/bin/env bun
// Per-worktree development settings, so several worktrees (and several agents)
// can run the server and the tests at once without sharing a Rivet Engine.
//
// RivetKit starts one local engine per port and keeps it running. Two worktrees
// on the same engine would hand each other's actors to whichever process asked,
// running the wrong code. So each worktree gets its own:
//
// - data folder: <worktree>/.data (actors under .rivetkit/, files under files/)
// - engine port: 6420 in the main worktree; in a linked worktree a fixed port
//   from its path (the engine also uses that port + 1 and + 10)
// - dev server port: 8080 in the main worktree; engine port + 5 elsewhere
// - and RivetKit's optional services sidecar off (it always binds 8642)
//
//   bun scripts/worktree.ts info          the ports and paths for this worktree
//   bun scripts/worktree.ts env           `export …` lines for a shell
//   bun scripts/worktree.ts exec -- cmd   run cmd with those settings
//   bun scripts/worktree.ts stop          stop this worktree's engine only
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

function git(args: string[]): string | null {
  const run = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return run.exitCode === 0 ? run.stdout.toString().trim() : null
}

export interface WorktreeSettings {
  root: string
  linked: boolean
  enginePort: number
  serverPort: number
  env: Record<string, string>
}

export function settings(): WorktreeSettings {
  const root = realpathSync(git(['rev-parse', '--show-toplevel']) ?? process.cwd())
  const gitDir = git(['rev-parse', '--absolute-git-dir'])
  const commonDir = git(['rev-parse', '--git-common-dir'])
  const linked = Boolean(gitDir && commonDir && realpathSync(gitDir) !== realpathSync(resolve(root, commonDir)))
  let enginePort = 6420
  let serverPort = 8080
  if (linked) {
    // 1,500 slots of 20 ports from 20000: the engine uses +0, +1 and +10, the server +5
    let hash = 2166136261
    for (const ch of root) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619)
    enginePort = 20000 + ((hash >>> 0) % 1500) * 20
    serverPort = enginePort + 5
  }
  const data = join(root, '.data')
  return {
    root,
    linked,
    enginePort,
    serverPort,
    env: {
      RIVETKIT_STORAGE_PATH: data,
      IDEAF_DATA: data,
      RIVET_RUN_ENGINE_PORT: String(enginePort),
      RIVET_RUN_SERVICES: '0',
      PORT: String(serverPort),
      IDEAF_URL: `http://localhost:${serverPort}`,
    },
  }
}

/** Process IDs listening on a TCP port. */
function listeners(port: number): number[] {
  const lsof = Bun.spawnSync(['lsof', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { stdout: 'pipe', stderr: 'pipe' })
  if (lsof.exitCode === 0 || lsof.stdout.length > 0) return lsof.stdout.toString().split('\n').filter(Boolean).map(Number)
  const ss = Bun.spawnSync(['ss', '-ltnpH', `sport = :${port}`], { stdout: 'pipe', stderr: 'pipe' })
  return [...ss.stdout.toString().matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))
}

function processName(pid: number): string {
  const ps = Bun.spawnSync(['ps', '-o', 'comm=', '-p', String(pid)], { stdout: 'pipe', stderr: 'pipe' })
  return ps.stdout.toString().trim()
}

async function stop(s: WorktreeSettings): Promise<number> {
  const engines = [...new Set(listeners(s.enginePort))].filter((pid) => processName(pid).startsWith('rivet-engine'))
  if (engines.length === 0) {
    console.log(`No engine running for this worktree (port ${s.enginePort}).`)
    return 0
  }
  for (const pid of engines) process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 50 && engines.some(alive); i++) await Bun.sleep(100)
  for (const pid of engines.filter(alive)) process.kill(pid, 'SIGKILL')
  console.log(`Stopped this worktree's engine (port ${s.enginePort}, pid ${engines.join(', ')}).`)
  return 0
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  const s = settings()
  switch (command) {
    case 'info':
      console.log(`${s.linked ? 'Linked' : 'Main'} worktree: ${s.root}`)
      console.log(`  data       ${s.env.IDEAF_DATA}`)
      console.log(`  engine     http://127.0.0.1:${s.enginePort}`)
      console.log(`  server     http://localhost:${s.serverPort} (bun run dev)`)
      console.log('Run `eval "$(bun scripts/worktree.ts env)"` to use these from a shell (curl, ideaf).')
      break
    case 'env':
      for (const [name, value] of Object.entries(s.env)) console.log(`export ${name}=${JSON.stringify(value)}`)
      break
    case 'exec': {
      const argv = rest[0] === '--' ? rest.slice(1) : rest
      if (argv.length === 0) {
        console.error('usage: bun scripts/worktree.ts exec -- <command>')
        process.exit(2)
      }
      const child = Bun.spawn(argv, { stdio: ['inherit', 'inherit', 'inherit'], env: { ...process.env, ...s.env } })
      process.exit(await child.exited)
      break
    }
    case 'stop':
      process.exit(await stop(s))
      break
    default:
      console.error('usage: bun scripts/worktree.ts info | env | exec -- <command> | stop')
      process.exit(2)
  }
}
