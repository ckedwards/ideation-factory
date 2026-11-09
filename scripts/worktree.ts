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
// - the web app's Vite dev server: 8081 in the main worktree; engine port + 6
//   elsewhere. The dev server passes the pages' requests on to it, so the
//   browser only ever talks to the dev server, as it would in production
// - and RivetKit's optional services sidecar off (it always binds 8642)
//
// Tests get an engine of their own (engine port + 2, data in .data/test),
// started fresh for every run and stopped afterwards, so a run never sees an
// earlier run's data and never touches the dev server's.
//
//   bun scripts/worktree.ts info          the ports and paths for this worktree
//   bun scripts/worktree.ts env           `export …` lines for a shell
//   bun scripts/worktree.ts exec -- cmd   run cmd with those settings
//   bun scripts/worktree.ts test -- cmd   run tests on a fresh test engine
//   bun scripts/worktree.ts stop          stop this worktree's engines only
import { realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

function git(args: string[]): string | null {
  const run = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return run.exitCode === 0 ? run.stdout.toString().trim() : null
}

export interface WorktreeSettings {
  root: string
  linked: boolean
  enginePort: number
  testEnginePort: number
  serverPort: number
  webPort: number
  env: Record<string, string>
  testEnv: Record<string, string>
}

export function settings(): WorktreeSettings {
  const root = realpathSync(git(['rev-parse', '--show-toplevel']) ?? process.cwd())
  const gitDir = git(['rev-parse', '--absolute-git-dir'])
  // absolute: git gives it relative to the current folder, which for a package's script isn't the root
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const linked = Boolean(gitDir && commonDir && realpathSync(gitDir) !== realpathSync(resolve(root, commonDir)))
  let enginePort = 6420
  let serverPort = 8080
  let webPort = 8081
  if (linked) {
    // 1,500 slots of 20 ports from 20000: the engine uses +0, +1 and +10, the server +5, the web app +6
    let hash = 2166136261
    for (const ch of root) {
      hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619)
    }
    enginePort = 20000 + ((hash >>> 0) % 1500) * 20
    serverPort = enginePort + 5
    webPort = enginePort + 6
  }
  const data = join(root, '.data')
  // the engine uses its port, + 1 and + 10; + 2, + 3 and + 12 don't overlap
  const testEnginePort = enginePort + 2
  const testData = join(data, 'test')
  return {
    root,
    linked,
    enginePort,
    testEnginePort,
    serverPort,
    webPort,
    testEnv: {
      RIVETKIT_STORAGE_PATH: testData,
      IDEAF_DATA: testData,
      RIVET_RUN_ENGINE_PORT: String(testEnginePort),
      RIVET_RUN_SERVICES: '0',
    },
    env: {
      RIVETKIT_STORAGE_PATH: data,
      IDEAF_DATA: data,
      RIVET_RUN_ENGINE_PORT: String(enginePort),
      RIVET_RUN_SERVICES: '0',
      PORT: String(serverPort),
      IDEAF_URL: `http://localhost:${serverPort}`,
      IDEAF_WEB_DEV_PORT: String(webPort),
      IDEAF_WEB_DEV_URL: `http://localhost:${webPort}`,
    },
  }
}

/** Process IDs listening on a TCP port. */
function listeners(port: number): number[] {
  const lsof = Bun.spawnSync(['lsof', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { stdout: 'pipe', stderr: 'pipe' })
  if (lsof.exitCode === 0 || lsof.stdout.length > 0) {
    return lsof.stdout.toString().split('\n').filter(Boolean).map(Number)
  }
  const ss = Bun.spawnSync(['ss', '-ltnpH', `sport = :${port}`], { stdout: 'pipe', stderr: 'pipe' })
  return [...ss.stdout.toString().matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))
}

function processName(pid: number): string {
  const ps = Bun.spawnSync(['ps', '-o', 'comm=', '-p', String(pid)], { stdout: 'pipe', stderr: 'pipe' })
  return ps.stdout.toString().trim()
}

/** The ports an engine on `port` listens on: its own, + 1 (peers) and + 10. */
const enginePorts = (port: number) => [port, port + 1, port + 10]

/**
 * Stops the engine on a port, if it's a Rivet Engine, and waits until all its
 * ports are free: one shutting down may close its own port before the others,
 * and a new engine started meanwhile can't bind them. Returns the process IDs
 * stopped.
 */
async function stopEngine(port: number): Promise<number[]> {
  const engines = [...new Set(enginePorts(port).flatMap(listeners))].filter((pid) =>
    processName(pid).startsWith('rivet-engine'),
  )
  for (const pid of engines) {
    process.kill(pid, 'SIGTERM')
  }
  for (let i = 0; i < 50 && engines.some(alive); i++) {
    await Bun.sleep(100)
  }
  for (const pid of engines.filter(alive)) {
    process.kill(pid, 'SIGKILL')
  }
  for (let i = 0; i < 50 && enginePorts(port).some((p) => listeners(p).length > 0); i++) {
    await Bun.sleep(100)
  }
  return engines
}

async function stop(s: WorktreeSettings): Promise<number> {
  const stopped = [...(await stopEngine(s.enginePort)), ...(await stopEngine(s.testEnginePort))]
  console.log(
    stopped.length
      ? `Stopped this worktree's engines (pid ${stopped.join(', ')}).`
      : `No engine running for this worktree (ports ${s.enginePort}, ${s.testEnginePort}).`,
  )
  return 0
}

/** Runs a test command on a fresh test engine, and stops it afterwards. */
async function test(s: WorktreeSettings, argv: string[]): Promise<number> {
  await stopEngine(s.testEnginePort)
  rmSync(s.testEnv.RIVETKIT_STORAGE_PATH!, { recursive: true, force: true })
  const child = Bun.spawn(argv, { stdio: ['inherit', 'inherit', 'inherit'], env: { ...process.env, ...s.testEnv } })
  const code = await child.exited
  await stopEngine(s.testEnginePort)
  return code
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
      console.log(`  server     http://localhost:${s.serverPort} (bun run dev): the API and the web app`)
      console.log(`  web        Vite on http://localhost:${s.webPort}, behind the server`)
      console.log(`  tests      engine on ${s.testEnginePort}, fresh data in ${s.testEnv.IDEAF_DATA} (bun run test)`)
      console.log('Run `eval "$(bun scripts/worktree.ts env)"` to use these from a shell (curl, ideaf).')
      break
    case 'env':
      for (const [name, value] of Object.entries(s.env)) {
        console.log(`export ${name}=${JSON.stringify(value)}`)
      }
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
    case 'test': {
      const argv = rest[0] === '--' ? rest.slice(1) : rest
      process.exit(await test(s, argv.length ? argv : ['bun', 'test']))
      break
    }
    case 'stop':
      process.exit(await stop(s))
      break
    default:
      console.error('usage: bun scripts/worktree.ts info | env | exec -- <command> | test [-- <command>] | stop')
      process.exit(2)
  }
}
