#!/usr/bin/env bun
// ideaf: the Ideation Factory cli. A small table of commands drives parsing
// and --help. Prompts only appear when a person is at a terminal; agents get
// --json output and stable exit codes.
import { parseArgs } from 'node:util'
import { change } from './commands/change.ts'
import * as comments from './commands/comment.ts'
import { edit } from './commands/edit.ts'
import { list as listIdeas } from './commands/list.ts'
import { move } from './commands/move.ts'
import { pull } from './commands/pull.ts'
import { share } from './commands/share.ts'
import { show } from './commands/show.ts'
import { WHO } from './commands/subjects.ts'
import * as containers from './commands/teams.ts'
import { start } from './commands/start.ts'
import { sync } from './commands/sync.ts'
import { unlock } from './commands/unlock.ts'
import { CliError, type Context, createContext, EXIT, fromApiError } from './context.ts'
import { type Io, processIo } from './io.ts'

type Flag = { type: 'string' | 'boolean'; short?: string; multiple?: boolean; description: string }
type Values = Record<string, string | boolean | string[] | undefined>

type Command = {
  name: string
  usage: string
  summary: string
  flags: Record<string, Flag>
  run(ctx: Context, flags: Values, args: string[], io: Io): Promise<number>
}

/** A command made of subcommands, like `ideaf team add`. */
type Family = { name: string; summary: string; subcommands: Command[] }

const str = (f: Values, name: string) => (typeof f[name] === 'string' ? (f[name] as string) : undefined)
const list = (f: Values, name: string) => (Array.isArray(f[name]) ? (f[name] as string[]) : [])

const IDEA: Flag = { type: 'string', description: 'act on this idea instead of the one this working tree is on' }

/** The membership subcommands, the same for teams and groups. */
function family(kind: containers.Kind): Family {
  const k = kind
  const cursor: Flag = { type: 'string', description: 'the next page, from the last list' }
  const sub = (
    name: string,
    args: string[],
    summary: string,
    run: (ctx: Context, a: string[], f: Values) => Promise<number>,
    flags: Record<string, Flag> = {},
    extra = '',
  ): Command => {
    const usage = `ideaf ${k} ${name}${args.map((a) => ` <${a}>`).join('')}${extra}`
    return { name, usage, summary, flags, run: (ctx, f, a) => run(ctx, containers.need(a, args, usage), f) }
  }
  return {
    name: kind,
    summary:
      kind === 'team'
        ? "Teams: list, create, members, joining and settings (an idea in a team gets the team's defaults)"
        : 'Groups: list, create, members and joining (ideas can be shared with a group)',
    subcommands: [
      {
        name: 'list',
        usage: `ideaf ${k} list [search]`,
        summary: `${kind === 'team' ? 'Teams' : 'Groups'} by handle, optionally matching a search`,
        flags: { cursor },
        run: (ctx, f, a) => containers.list(ctx, k, a.join(' ') || undefined, str(f, 'cursor')),
      },
      sub(
        'show',
        [k],
        `A ${k}'s name and members${k === 'team' ? ', who can create ideas in it, and its defaults' : ''}`,
        (ctx, [ref]) => containers.show(ctx, k, ref!),
      ),
      sub(
        'create',
        ['handle'],
        `Create a ${k}, with you as its admin (${k}s are invite only)`,
        (ctx, [handle], f) =>
          containers.create(ctx, k, handle!, {
            ...(str(f, 'name') ? { name: str(f, 'name')! } : {}),
            ...(str(f, 'description') ? { description: str(f, 'description')! } : {}),
          }),
        {
          name: { type: 'string', description: `the ${k}'s name (asked for at a terminal if missing)` },
          description: { type: 'string', description: 'a short description' },
        },
        ' --name <name> [--description <text>]',
      ),
      sub(
        'members',
        [k],
        `A ${k}'s members and their roles`,
        (ctx, [ref], f) => containers.members(ctx, k, ref!, str(f, 'cursor')),
        {
          cursor,
        },
      ),
      sub(
        'add',
        [k, 'person'],
        `Add someone to a ${k} (maintainers and admins), or change their role (admins)`,
        (ctx, [ref, person], f) => containers.add(ctx, k, ref!, person!, str(f, 'role')),
        { role: { type: 'string', description: 'admin, maintainer or member (the default)' } },
        ' [--role <role>]',
      ),
      sub(
        'remove',
        [k, 'person'],
        `Remove someone from a ${k}; their access through it ends at once`,
        (ctx, [ref, person]) => containers.remove(ctx, k, ref!, person!),
      ),
      sub('leave', [k], `Leave a ${k}`, (ctx, [ref]) => containers.leave(ctx, k, ref!)),
      sub('join', [k], `Ask to join a ${k}: its maintainers and admins decide`, (ctx, [ref]) =>
        containers.join(ctx, k, ref!),
      ),
      sub('requests', [k], `People waiting to join a ${k}`, (ctx, [ref]) => containers.requests(ctx, k, ref!)),
      sub('approve', [k, 'person'], `Let someone into a ${k}`, (ctx, [ref, person]) =>
        containers.decide(ctx, k, ref!, person!, true),
      ),
      sub('deny', [k, 'person'], `Turn down someone's request to join a ${k}`, (ctx, [ref, person]) =>
        containers.decide(ctx, k, ref!, person!, false),
      ),
      ...(kind === 'team'
        ? [
            sub(
              'settings',
              ['team'],
              'Show or change who can create ideas in a team, and what new ideas in it start with (admins; existing ideas keep their access)',
              (ctx, [ref], f) =>
                containers.settings(ctx, ref!, {
                  ...(str(f, 'create') ? { create: str(f, 'create')! } : {}),
                  ...(str(f, 'members') ? { members: str(f, 'members')! } : {}),
                  public: f.public === true,
                  private: f.private === true,
                  group: list(f, 'group'),
                  removeGroup: list(f, 'remove-group'),
                }),
              {
                create: { type: 'string', description: 'who can create ideas in it: anyone, members or maintainers' },
                members: {
                  type: 'string',
                  description: "new ideas' access for the team's members: none, view or edit",
                },
                public: { type: 'boolean', description: 'new ideas start public (everyone can view)' },
                private: { type: 'boolean', description: "new ideas don't start public" },
                group: {
                  type: 'string',
                  multiple: true,
                  description: 'new ideas start shared with this group: <group>[=view|edit] (repeatable)',
                },
                'remove-group': {
                  type: 'string',
                  multiple: true,
                  description: 'stop sharing new ideas with this group',
                },
              },
              ' [--create <who>] [--members <access>] [--public | --private] [--group <group>[=edit]]…',
            ),
          ]
        : []),
    ],
  }
}

const stdin = () => Bun.stdin.text()

/** ideaf comment …: comment threads, mostly for agents and skills. */
const comment: Family = {
  name: 'comment',
  summary: 'Comments: list and read threads, comment on a file, section or quote, reply, resolve',
  subcommands: [
    {
      name: 'list',
      usage: 'ideaf comment list [--all] [--version <n>]',
      summary: 'The open comment threads: what each is on, its state, and its replies',
      flags: {
        idea: IDEA,
        all: { type: 'boolean', description: 'resolved threads too' },
        version: { type: 'string', description: 'as of an earlier version' },
      },
      run: (ctx, f) =>
        comments.list(ctx, {
          ...(str(f, 'idea') ? { idea: str(f, 'idea')! } : {}),
          all: f.all === true,
          ...(str(f, 'version') ? { version: str(f, 'version')! } : {}),
        }),
    },
    {
      name: 'show',
      usage: 'ideaf comment show <comment> [--version <n>]',
      summary: 'One thread in full, with its replies',
      flags: { idea: IDEA, version: { type: 'string', description: 'as of an earlier version' } },
      run: (ctx, f, a) =>
        comments.show(
          ctx,
          {
            ...(str(f, 'idea') ? { idea: str(f, 'idea')! } : {}),
            ...(str(f, 'version') ? { version: str(f, 'version')! } : {}),
          },
          containers.need(a, ['comment'], 'ideaf comment show <comment>')[0]!,
        ),
    },
    {
      name: 'add',
      usage: 'ideaf comment add <body | -> (--quote <text> [--file <file>] | --section <id> | --file <file>)',
      summary:
        'Comment on the latest version: on a quote from the text, a section (IDs from `ideaf show --blocks`), or a whole file. "-" reads the body from stdin',
      flags: {
        idea: IDEA,
        quote: {
          type: 'string',
          description: 'the text it’s on, as it reads (without Markdown); it must match once, or pass --occurrence',
        },
        occurrence: { type: 'string', description: 'which match of --quote, from 1' },
        section: { type: 'string', description: 'the section it’s on, by its heading’s ID' },
        file: { type: 'string', description: 'the file it’s on (ID or path), or where to look for --quote' },
      },
      run: (ctx, f, a) =>
        comments.add(
          ctx,
          {
            ...(str(f, 'idea') ? { idea: str(f, 'idea')! } : {}),
            ...(str(f, 'quote') !== undefined ? { quote: str(f, 'quote')! } : {}),
            ...(str(f, 'occurrence') ? { occurrence: str(f, 'occurrence')! } : {}),
            ...(str(f, 'section') ? { section: str(f, 'section')! } : {}),
            ...(str(f, 'file') ? { file: str(f, 'file')! } : {}),
          },
          containers.need(a, ['body'], 'ideaf comment add <body> --quote <text>')[0]!,
          stdin,
        ),
    },
    {
      name: 'reply',
      usage: 'ideaf comment reply <comment> <body | ->',
      summary: 'Reply to a thread. "-" reads the body from stdin',
      flags: { idea: IDEA },
      run: (ctx, f, a) => {
        const [id, body] = containers.need(a, ['comment', 'body'], 'ideaf comment reply <comment> <body>')
        return comments.reply(ctx, str(f, 'idea') ? { idea: str(f, 'idea')! } : {}, id!, body!, stdin)
      },
    },
    {
      name: 'resolve',
      usage: 'ideaf comment resolve <comment>…',
      summary: 'Mark threads resolved',
      flags: { idea: IDEA },
      run: (ctx, f, a) => comments.resolve(ctx, str(f, 'idea') ? { idea: str(f, 'idea')! } : {}, a, true),
    },
    {
      name: 'reopen',
      usage: 'ideaf comment reopen <comment>…',
      summary: 'Reopen resolved threads',
      flags: { idea: IDEA },
      run: (ctx, f, a) => comments.resolve(ctx, str(f, 'idea') ? { idea: str(f, 'idea')! } : {}, a, false),
    },
  ],
}

const commands: Array<Command | Family> = [
  {
    name: 'start',
    usage: 'ideaf start [path] --title <title> [--team <team>] [--description <text>]',
    summary:
      "Start an idea from the Markdown files in path (default: this folder), and make it this working tree's idea",
    flags: {
      title: { type: 'string', description: 'the idea’s title (asked for at a terminal if missing)' },
      team: {
        type: 'string',
        description: 'start it in this team (its defaults decide who can see it); without one it’s private to you',
      },
      description: { type: 'string', description: 'a short description' },
    },
    run: (ctx, f, args) =>
      start(
        ctx,
        {
          ...(typeof f.title === 'string' ? { title: f.title } : {}),
          ...(typeof f.team === 'string' ? { team: f.team } : {}),
          ...(typeof f.description === 'string' ? { description: f.description } : {}),
        },
        args[0],
      ),
  },
  {
    name: 'list',
    usage: 'ideaf list [--anyone] [--server] [--team <team>] [--owner <person>] [--status <status>] [--search <words>]',
    summary:
      "This repository's ideas, this working tree's first; or, with --server or a filter, the ideas you can see. Yours unless --anyone",
    flags: {
      anyone: { type: 'boolean', description: 'whoever owns them, not just yours' },
      server: { type: 'boolean', description: 'ideas on the server you can see, not just this repository’s' },
      team: { type: 'string', description: 'ideas in this team (on the server)' },
      owner: { type: 'string', description: 'ideas this person owns (on the server)' },
      status: { type: 'string', description: 'ideas with this status (on the server)' },
      search: { type: 'string', description: 'ideas whose titles match, closest first (on the server)' },
      cursor: { type: 'string', description: 'the next page, from the last --server list' },
    },
    run: (ctx, f) =>
      listIdeas(ctx, {
        anyone: f.anyone === true,
        server: f.server === true,
        ...(str(f, 'team') !== undefined ? { team: str(f, 'team')! } : {}),
        ...(str(f, 'owner') !== undefined ? { owner: str(f, 'owner')! } : {}),
        ...(str(f, 'status') !== undefined ? { status: str(f, 'status')! } : {}),
        ...(str(f, 'search') !== undefined ? { search: str(f, 'search')! } : {}),
        ...(str(f, 'cursor') !== undefined ? { cursor: str(f, 'cursor')! } : {}),
      }),
  },
  {
    name: 'change',
    usage: 'ideaf change [<idea>] [--title <words>] [--here] [--anyone]',
    summary:
      "Make another idea this working tree's, switching to its branch; one not in this repository yet is pulled here. Asks which at a terminal",
    flags: {
      title: {
        type: 'string',
        description: 'the idea whose title has these words (this repository’s first, then the server’s)',
      },
      here: { type: 'boolean', description: 'work on it in this working tree, on this branch, without switching' },
      anyone: { type: 'boolean', description: 'choose from everyone’s ideas in this repository, not just yours' },
    },
    run: (ctx, f, a) =>
      change(
        ctx,
        {
          ...(str(f, 'title') !== undefined ? { title: str(f, 'title')! } : {}),
          here: f.here === true,
          anyone: f.anyone === true,
        },
        a.length > 1 ? containers.need(a, ['idea'], 'ideaf change [<idea>]')[0] : a[0],
      ),
  },
  {
    name: 'sync',
    usage: 'ideaf sync [path] [--force]',
    summary:
      'Upload the Markdown that changed since your last sync or pull. Refuses with "pull first" if the idea moved on',
    flags: {
      idea: IDEA,
      force: { type: 'boolean', description: 'upload even if the idea moved on (its newer changes show as undone)' },
    },
    run: (ctx, f, args) =>
      sync(ctx, { ...(typeof f.idea === 'string' ? { idea: f.idea } : {}), force: f.force === true }, args[0]),
  },
  {
    name: 'pull',
    usage: 'ideaf pull',
    summary:
      'Bring the latest version into your files, merging with your local edits (conflicts are left in the files, like git)',
    flags: { idea: IDEA },
    run: (ctx, f) => pull(ctx, typeof f.idea === 'string' ? { idea: f.idea } : {}),
  },
  {
    name: 'show',
    usage: 'ideaf show --blocks [--version <n>]',
    summary:
      "The structured view: each file's sections and blocks with their IDs, and the open comments. Read it before building a batch",
    flags: {
      idea: IDEA,
      blocks: { type: 'boolean', description: 'sections and blocks with IDs' },
      version: { type: 'string', description: 'an earlier version' },
    },
    run: (ctx, f) =>
      show(ctx, {
        ...(typeof f.idea === 'string' ? { idea: f.idea } : {}),
        blocks: f.blocks === true,
        ...(typeof f.version === 'string' ? { version: f.version } : {}),
      }),
  },
  {
    name: 'edit',
    usage: 'ideaf edit <batch.json | -> [--dry-run]',
    summary:
      'Edit the idea in place with a batch of commands (one new version). --dry-run shows the diff and what happens to each comment',
    flags: { idea: IDEA, 'dry-run': { type: 'boolean', description: 'show what would happen, changing nothing' } },
    run: (ctx, f, args) =>
      edit(
        ctx,
        { ...(typeof f.idea === 'string' ? { idea: f.idea } : {}), 'dry-run': f['dry-run'] === true },
        args[0],
        () => Bun.stdin.text(),
      ),
  },
  {
    name: 'unlock',
    usage: 'ideaf unlock [--force]',
    summary: "Remove the idea's lock, left by an ideaf that crashed or was interrupted (it says who held it)",
    flags: {
      idea: IDEA,
      force: { type: 'boolean', description: 'remove it even if the ideaf holding it is still running' },
    },
    run: (ctx, f) => unlock(ctx, { ...(typeof f.idea === 'string' ? { idea: f.idea } : {}), force: f.force === true }),
  },
  {
    name: 'share',
    usage: 'ideaf share [<who>…] [--edit] [--share] [--remove]',
    summary: 'Who can see the idea; or give <who> view access (and edit or share), or --remove it. <who> is ' + WHO,
    flags: {
      idea: IDEA,
      edit: { type: 'boolean', description: 'they can edit it too' },
      share: { type: 'boolean', description: 'they can change who can see it too' },
      remove: { type: 'boolean', description: 'take their access away' },
    },
    run: (ctx, f, args) =>
      share(
        ctx,
        {
          ...(str(f, 'idea') ? { idea: str(f, 'idea')! } : {}),
          edit: f.edit === true,
          share: f.share === true,
          remove: f.remove === true,
        },
        args,
      ),
  },
  {
    name: 'move',
    usage: 'ideaf move (--team <team> | --out) [--keep <who>]… [--skip <who>]… [--dry-run] [--yes]',
    summary: 'Move the idea into, out of, or to another team. Shows who would lose or gain access, and asks first',
    flags: {
      idea: IDEA,
      team: { type: 'string', description: 'the team to move it to' },
      out: { type: 'boolean', description: 'take it out of its team (private to its owner and who it’s shared with)' },
      keep: {
        type: 'string',
        multiple: true,
        description: 'keep the old team’s access (team:<handle>) instead of removing it (repeatable)',
      },
      skip: {
        type: 'string',
        multiple: true,
        description: 'don’t add this new-team default: team:<handle>, group:<handle> or everyone (repeatable)',
      },
      'dry-run': { type: 'boolean', description: 'show what would change, moving nothing' },
      yes: {
        type: 'boolean',
        short: 'y',
        description: 'move without asking (needed without a terminal, or with --json)',
      },
    },
    run: (ctx, f) =>
      move(ctx, {
        ...(str(f, 'idea') ? { idea: str(f, 'idea')! } : {}),
        ...(str(f, 'team') ? { team: str(f, 'team')! } : {}),
        out: f.out === true,
        keep: list(f, 'keep'),
        skip: list(f, 'skip'),
        yes: f.yes === true,
        dryRun: f['dry-run'] === true,
      }),
  },
  comment,
  family('team'),
  family('group'),
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

function help(io: Io, command?: Command | Family, prefix = 'ideaf'): void {
  if (command && 'subcommands' in command) {
    io.out(`${command.summary}.\n\nUsage: ${prefix} ${command.name} <command> [options]\n`)
    const width = Math.max(...command.subcommands.map((c) => c.name.length)) + 2
    for (const c of command.subcommands) {
      io.out(`  ${c.name.padEnd(width)}${c.summary}`)
    }
    io.out(`\nRun "${prefix} ${command.name} <command> --help" for its options.`)
    return
  }
  if (command) {
    io.out(`${command.summary}.\n\nUsage: ${command.usage}\n`)
    for (const [name, flag] of Object.entries({ ...command.flags, ...GLOBAL })) {
      io.out(`  --${name.padEnd(14)}${flag.description}`)
    }
    return
  }
  io.out('Usage: ideaf <command> [options]\n')
  const width = Math.max(...commands.map((c) => c.name.length)) + 2
  for (const c of commands) {
    io.out(`  ${c.name.padEnd(width)}${c.summary}`)
  }
  io.out(`
Environment: IDEAF_URL (default http://localhost:8080) and IDEAF_TOKEN.
Exit codes: 0 ok, 1 error, 2 usage or invalid input, 3 pull first, 4 conflict,
5 not found, 6 not signed in or not allowed, 7 merge conflicts left in files,
8 local edits not synced, 9 server unreachable, 10 another ideaf is busy with the idea.`)
}

const isHelp = (arg: string | undefined) => arg === '--help' || arg === '-h' || arg === 'help'

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const [first, ...afterFirst] = argv
  if (!first || isHelp(first)) {
    const found = commands.find((c) => c.name === afterFirst[0])
    const sub = found && 'subcommands' in found ? found.subcommands.find((c) => c.name === afterFirst[1]) : undefined
    help(io, sub ?? found)
    return EXIT.ok
  }
  const found = commands.find((c) => c.name === first)
  if (!found) {
    io.err(`ideaf: unknown command "${first}". Run "ideaf --help".`)
    return EXIT.usage
  }
  let name = first
  let rest = afterFirst
  let command: Command
  if ('subcommands' in found) {
    const [subName, ...afterSub] = afterFirst
    if (!subName || isHelp(subName)) {
      help(io, found)
      return EXIT.ok
    }
    const sub = found.subcommands.find((c) => c.name === subName)
    if (!sub) {
      io.err(`ideaf ${first}: unknown command "${subName}". Run "ideaf ${first} --help".`)
      return EXIT.usage
    }
    command = sub
    name = `${first} ${subName}`
    rest = afterSub
  } else {
    command = found
  }

  let parsed: { values: Values; positionals: string[] }
  try {
    parsed = parseArgs({
      args: rest,
      options: { ...command.flags, ...GLOBAL },
      allowPositionals: true,
      strict: true,
    }) as typeof parsed
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
    if (json) {
      io.out(
        JSON.stringify(
          {
            error: {
              code: error.code,
              message: error.message,
              ...(error.details === undefined ? {} : { details: error.details }),
            },
          },
          null,
          2,
        ),
      )
    } else {
      io.err(`ideaf ${name}: ${error.message}`)
      if (error.code === 'pull_first') {
        io.err('Run `ideaf pull`, then sync again (or `ideaf sync --force` to overwrite).')
      }
      if (error.code === 'conflict') {
        for (const c of (error.details as { conflicts?: Array<{ step: number; message: string }> } | undefined)
          ?.conflicts ?? []) {
          io.err(`  step ${c.step}: ${c.message}`)
        }
      }
    }
    return error.exit
  }
}

export { CliError }

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
