#!/usr/bin/env bun
// ideaf: the Ideation Factory cli. A small table of commands drives parsing
// and --help. Prompts only appear when a person is at a terminal; agents get
// --json output and stable exit codes.
import { parseArgs } from 'node:util'
import { edit } from './commands/edit.ts'
import { pull } from './commands/pull.ts'
import { show } from './commands/show.ts'
import { start } from './commands/start.ts'
import { sync } from './commands/sync.ts'
import { unlock } from './commands/unlock.ts'
import { CliError, type Context, createContext, EXIT, fromApiError } from './context.ts'
import { type Io, processIo } from './io.ts'

type Flag = { type: 'string' | 'boolean'; short?: string; description: string }

type Command = {
  name: string
  usage: string
  summary: string
  flags: Record<string, Flag>
  run(ctx: Context, flags: Record<string, string | boolean | undefined>, args: string[], io: Io): Promise<number>
}

const IDEA: Flag = { type: 'string', description: 'act on this idea instead of the one this working tree is on' }

const commands: Command[] = [
  {
    name: 'start',
    usage: 'ideaf start [path] --title <title> [--team <team>] [--description <text>]',
    summary: "Start an idea from the Markdown files in path (default: this folder), and make it this working tree's idea",
    flags: {
      title: { type: 'string', description: 'the idea’s title (asked for at a terminal if missing)' },
      team: { type: 'string', description: 'start it in this team (its defaults decide who can see it); without one it’s private to you' },
      description: { type: 'string', description: 'a short description' },
    },
    run: (ctx, f, args) =>
      start(ctx, { ...(typeof f.title === 'string' ? { title: f.title } : {}), ...(typeof f.team === 'string' ? { team: f.team } : {}), ...(typeof f.description === 'string' ? { description: f.description } : {}) }, args[0]),
  },
  {
    name: 'sync',
    usage: 'ideaf sync [path] [--force]',
    summary: 'Upload the Markdown that changed since your last sync or pull. Refuses with "pull first" if the idea moved on',
    flags: { idea: IDEA, force: { type: 'boolean', description: 'upload even if the idea moved on (its newer changes show as undone)' } },
    run: (ctx, f, args) => sync(ctx, { ...(typeof f.idea === 'string' ? { idea: f.idea } : {}), force: f.force === true }, args[0]),
  },
  {
    name: 'pull',
    usage: 'ideaf pull',
    summary: 'Bring the latest version into your files, merging with your local edits (conflicts are left in the files, like git)',
    flags: { idea: IDEA },
    run: (ctx, f) => pull(ctx, typeof f.idea === 'string' ? { idea: f.idea } : {}),
  },
  {
    name: 'show',
    usage: 'ideaf show --blocks [--version <n>]',
    summary: "The structured view: each file's sections and blocks with their IDs, and the open comments. Read it before building a batch",
    flags: { idea: IDEA, blocks: { type: 'boolean', description: 'sections and blocks with IDs' }, version: { type: 'string', description: 'an earlier version' } },
    run: (ctx, f) => show(ctx, { ...(typeof f.idea === 'string' ? { idea: f.idea } : {}), blocks: f.blocks === true, ...(typeof f.version === 'string' ? { version: f.version } : {}) }),
  },
  {
    name: 'edit',
    usage: 'ideaf edit <batch.json | -> [--dry-run]',
    summary: 'Edit the idea in place with a batch of commands (one new version). --dry-run shows the diff and what happens to each comment',
    flags: { idea: IDEA, 'dry-run': { type: 'boolean', description: 'show what would happen, changing nothing' } },
    run: (ctx, f, args) => edit(ctx, { ...(typeof f.idea === 'string' ? { idea: f.idea } : {}), 'dry-run': f['dry-run'] === true }, args[0], () => Bun.stdin.text()),
  },
  {
    name: 'unlock',
    usage: 'ideaf unlock [--force]',
    summary: "Remove the idea's lock, left by an ideaf that crashed or was interrupted (it says who held it)",
    flags: { idea: IDEA, force: { type: 'boolean', description: 'remove it even if the ideaf holding it is still running' } },
    run: (ctx, f) => unlock(ctx, { ...(typeof f.idea === 'string' ? { idea: f.idea } : {}), force: f.force === true }),
  },
  {
    name: 'version',
    usage: 'ideaf version',
    summary: 'Print the version',
    flags: {},
    run: async (ctx) => {
      ctx.say('ideaf 0.0.0')
      ctx.result({ version: '0.0.0' })
      return EXIT.ok
    },
  },
]

const GLOBAL: Record<string, Flag> = {
  json: { type: 'boolean', description: 'print the result as JSON (for scripts and agents)' },
  help: { type: 'boolean', short: 'h', description: 'show help' },
}

function help(io: Io, command?: Command): void {
  if (command) {
    io.out(`${command.summary}.\n\nUsage: ${command.usage}\n`)
    for (const [name, flag] of Object.entries({ ...command.flags, ...GLOBAL })) io.out(`  --${name.padEnd(14)}${flag.description}`)
    return
  }
  io.out('Usage: ideaf <command> [options]\n')
  for (const c of commands) io.out(`  ${c.name.padEnd(9)}${c.summary}`)
  io.out(`
Environment: IDEAF_URL (default http://localhost:8080) and IDEAF_TOKEN.
Exit codes: 0 ok, 1 error, 2 usage or invalid input, 3 pull first, 4 conflict,
5 not found, 6 not signed in or not allowed, 7 merge conflicts left in files,
8 local edits not synced, 9 server unreachable, 10 another ideaf is busy with the idea.`)
}

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    help(io, commands.find((c) => c.name === rest[0]))
    return EXIT.ok
  }
  const command = commands.find((c) => c.name === name)
  if (!command) {
    io.err(`ideaf: unknown command "${name}". Run "ideaf --help".`)
    return EXIT.usage
  }

  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] }
  try {
    parsed = parseArgs({ args: rest, options: { ...command.flags, ...GLOBAL }, allowPositionals: true, strict: true }) as typeof parsed
  } catch (error) {
    io.err(`ideaf ${name}: ${(error as Error).message}. Run "ideaf ${name} --help".`)
    return EXIT.usage
  }
  if (parsed.values.help) {
    help(io, command)
    return EXIT.ok
  }

  const json = parsed.values.json === true
  try {
    const ctx = createContext(io, json)
    return await command.run(ctx, parsed.values, parsed.positionals, io)
  } catch (raw) {
    const error = fromApiError(raw)
    if (json) io.out(JSON.stringify({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } }, null, 2))
    else {
      io.err(`ideaf ${name}: ${error.message}`)
      if (error.code === 'pull_first') io.err('Run `ideaf pull`, then sync again (or `ideaf sync --force` to overwrite).')
      if (error.code === 'conflict') {
        for (const c of ((error.details as { conflicts?: Array<{ step: number; message: string }> } | undefined)?.conflicts ?? [])) io.err(`  step ${c.step}: ${c.message}`)
      }
    }
    return error.exit
  }
}

export { CliError }

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
