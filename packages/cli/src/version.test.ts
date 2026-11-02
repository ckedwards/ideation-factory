// ideaf --version and ideaf version: the version in the cli's package.json.
import { expect, test } from 'bun:test'
import pkg from '../package.json' with { type: 'json' }
import { memoryStore } from './credentials.ts'
import type { Io } from './io.ts'
import { main } from './main.ts'

async function run(...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    cwd: process.cwd(),
    env: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    interactive: false,
    ask: async () => null,
    confirm: async () => false,
    choose: async () => null,
    credentials: async () => memoryStore(),
    openBrowser: async () => false,
  }
  const exit = await main(argv, io)
  return { exit, out: out.join('\n'), err: err.join('\n') }
}

test('--version, -v and version print the package version, and --json works with each', async () => {
  for (const argv of [['--version'], ['-v'], ['version']]) {
    expect(await run(...argv)).toEqual({ exit: 0, out: `ideaf ${pkg.version}`, err: '' })
    const json = await run(...argv, '--json')
    expect(json.exit).toBe(0)
    expect(JSON.parse(json.out)).toEqual({ version: pkg.version })
  }
})
