// ideaf list: this repository's ideas (the ones started or pulled here, from
// their state files), the active one first; or, with --server or a filter, the
// ideas on the server you can see. Yours by default either way; --anyone
// includes everyone's.
import type { Operations, Output } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { activeIdea, listStates } from '../workspace.ts'
import { truncate } from './output.ts'
import { Names } from './subjects.ts'

type Row = Output<Operations['listIdeas']>['items'][number]

export interface ListFlags {
  anyone: boolean
  server: boolean
  team?: string
  owner?: string
  status?: string
  search?: string
  cursor?: string
}

export async function list(ctx: Context, flags: ListFlags): Promise<number> {
  const remote =
    flags.server ||
    flags.team !== undefined ||
    flags.owner !== undefined ||
    flags.status !== undefined ||
    flags.search !== undefined
  if (flags.cursor !== undefined && !remote) {
    throw new CliError('--cursor pages through --server lists', EXIT.usage, 'usage')
  }
  if (flags.search !== undefined && (flags.team ?? flags.owner ?? flags.status ?? flags.cursor) !== undefined) {
    throw new CliError('--search looks at every idea you can see: leave out the other filters', EXIT.usage, 'usage')
  }
  return remote ? serverList(ctx, flags) : repositoryList(ctx, flags)
}

type Summary = Output<Operations['getIdea']>

/**
 * This repository's ideas on this server: each one's local state and, if it
 * can still be read, its summary. `elsewhere` counts those on other servers.
 */
export async function repositoryIdeas(ctx: Context) {
  const [states, active, me] = await Promise.all([listStates(ctx.ws), activeIdea(ctx.ws), ctx.api.me({})])
  const here = states.filter((s) => s.server === ctx.server)
  const rows = await Promise.all(
    here.map(async (state) => ({
      state,
      summary: (await ctx.api.getIdea({ idea: state.idea }).catch(() => null)) as Summary | null,
    })),
  )
  return { rows, active, me, elsewhere: states.length - here.length }
}

async function repositoryList(ctx: Context, flags: ListFlags): Promise<number> {
  const { rows, active, me, elsewhere } = await repositoryIdeas(ctx)
  const shown = rows
    .filter((r) => flags.anyone || r.state.idea === active || !r.summary || r.summary.owner === me.id)
    .sort((a, b) => Number(b.state.idea === active) - Number(a.state.idea === active) || updated(b) - updated(a))
  const hidden = rows.length - shown.length

  const names = new Names(ctx)
  const items = await Promise.all(
    shown.map(async ({ state, summary }) => ({
      id: state.idea,
      active: state.idea === active,
      branch: state.branch,
      local: state.version,
      ...(summary
        ? {
            title: summary.title,
            status: summary.status,
            latest: summary.latest,
            owner: await names.label({ kind: 'user', id: summary.owner }),
            updatedAt: summary.versions.at(-1)?.createdAt ?? summary.createdAt,
          }
        : { missing: true }),
    })),
  )
  ctx.result({ items, hidden, elsewhere })
  if (ctx.json) {
    return EXIT.ok
  }

  if (items.length === 0) {
    ctx.say(
      rows.length
        ? `None of this repository's ideas are yours: --anyone shows all ${rows.length}.`
        : 'No ideas in this repository yet: start one with `ideaf start`, or see the ones on the server with `ideaf list --server`.',
    )
  }
  const table = items.map((i) => [
    i.active ? '*' : ' ',
    i.id,
    'missing' in i ? '(not found: deleted, or not shared with you any more)' : truncate(i.title, 50),
    'missing' in i ? '' : i.status,
    'missing' in i ? `here v${i.local}` : i.local < i.latest ? `v${i.latest} (here v${i.local}: pull)` : `v${i.latest}`,
    'missing' in i ? '' : i.owner,
    i.branch ? `on ${i.branch}` : '',
  ])
  for (const line of columns(table)) {
    ctx.say(line)
  }
  if (items.some((i) => i.active)) {
    ctx.say('\n* this working tree’s idea')
  }
  if (hidden) {
    ctx.say(
      `${hidden} more here ${hidden === 1 ? 'is' : 'are'} other people’s: --anyone shows ${hidden === 1 ? 'it' : 'them'}.`,
    )
  }
  if (elsewhere) {
    ctx.say(`${elsewhere} more ${elsewhere === 1 ? 'is' : 'are'} on another server (IDEAF_URL isn't ${ctx.server}).`)
  }
  return EXIT.ok
}

const updated = (r: { summary: { createdAt: number; versions: Array<{ createdAt: number }> } | null }) =>
  r.summary ? (r.summary.versions.at(-1)?.createdAt ?? r.summary.createdAt) : 0

async function serverList(ctx: Context, flags: ListFlags): Promise<number> {
  const [states, active] = await Promise.all([listStates(ctx.ws), activeIdea(ctx.ws)])
  const local = new Set(states.filter((s) => s.server === ctx.server).map((s) => s.idea))
  let items: Row[]
  let next: string | null = null
  let incomplete = false
  if (flags.search !== undefined) {
    const found = await ctx.api.searchIdeas({ q: flags.search })
    items = found.items
    incomplete = found.incomplete
  } else {
    // yours by default, unless the filters already say whose
    const owner = flags.owner ?? (flags.anyone || flags.team !== undefined ? undefined : (await ctx.api.me({})).id)
    const page = await ctx.api.listIdeas({
      ...(flags.team !== undefined ? { team: flags.team } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(flags.status !== undefined ? { status: flags.status } : {}),
      ...(flags.cursor !== undefined ? { cursor: flags.cursor } : {}),
    })
    items = page.items
    next = page.next
  }
  ctx.result({
    items: items.map((i) => ({ ...i, here: local.has(i.id), active: i.id === active })),
    next,
    ...(flags.search !== undefined ? { incomplete } : {}),
  })
  if (ctx.json) {
    return EXIT.ok
  }

  if (items.length === 0) {
    ctx.say(
      flags.search !== undefined
        ? `No ideas you can see match "${flags.search}".`
        : flags.anyone || flags.team || flags.owner
          ? 'No ideas match.'
          : 'You have no ideas on the server yet: --anyone shows the ones shared with you.',
    )
  }
  const names = new Names(ctx)
  const table = await Promise.all(
    items.map(async (i) => [
      i.id === active ? '*' : local.has(i.id) ? '+' : ' ',
      i.id,
      truncate(i.title, 50),
      i.status,
      `v${i.latest}`,
      await names.label({ kind: 'user', id: i.owner }),
      i.team ? await names.label({ kind: 'team', id: i.team }) : '',
      ago(i.updatedAt),
    ]),
  )
  for (const line of columns(table)) {
    ctx.say(line)
  }
  if (items.some((i) => local.has(i.id))) {
    ctx.say(`\n${items.some((i) => i.id === active) ? '* this working tree’s idea, ' : ''}+ in this repository`)
  }
  if (incomplete) {
    ctx.say('The search matched more ideas than one search checks, so only the best were: add a word to narrow it.')
  }
  if (next) {
    ctx.say(`More: add --cursor ${next}`)
  }
  return EXIT.ok
}

function columns(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]!.length))) ?? []
  return rows.map((r) =>
    r
      .map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd(),
  )
}

function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(at).toISOString().slice(0, 10)
}
