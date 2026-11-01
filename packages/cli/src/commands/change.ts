// ideaf change: make another idea this working tree's. It never runs git:
// branches are the user's to manage. An idea remembers the branch it's on
// (locally, and on the server for other machines), so if this working tree is
// on a different one, change says how to get there and stops, rather than tie
// the idea to the wrong branch's files; --here ties it to this branch anyway.
// If the branch is checked out in another worktree, it says where (and makes
// the idea active there). An idea not in this repository yet is pulled here.
import { realpathSync } from 'node:fs'
import { CliError, type Context, EXIT } from '../context.ts'
import {
  activeIdea,
  branchWhere,
  openWorkspace,
  readState,
  remotes,
  repoUri,
  setActiveIdea,
  worktrees,
} from '../workspace.ts'
import { repositoryIdeas } from './list.ts'
import { truncate } from './output.ts'
import { pullInto } from './pull.ts'

type Option = { id: string; title: string; note: string }

export async function change(
  ctx: Context,
  flags: { title?: string; here: boolean; anyone: boolean },
  given: string | undefined,
): Promise<number> {
  if (given !== undefined && flags.title !== undefined) {
    throw new CliError('name the idea by its ID or by --title, not both', EXIT.usage, 'usage')
  }
  const id = given ?? (await choose(ctx, flags))
  const summary = await ctx.api.getIdea({ idea: id })
  const named = `"${truncate(summary.title, 60)}" (${id})`
  const state = await readState(ctx.ws, id)
  const current = ctx.ws.git?.branch ?? null

  // the branch it's on: as this repository last saw it, or as the server says
  const wanted = state ? state.branch : (summary.gitHint?.branch ?? null)
  if (ctx.ws.git && wanted && wanted !== current && !flags.here) {
    await refuseElsewhere(ctx, named, id, wanted, state ? null : (summary.gitHint?.uri ?? null))
  }

  // not in this repository yet: bring it here
  const pulled = state ? null : await ctx.lock(id, () => pullInto(ctx, id))
  const before = await activeIdea(ctx.ws)
  await setActiveIdea(ctx.ws, id)
  ctx.say(
    before === id && !pulled
      ? `Already on ${named}.`
      : `Now on ${named}${pulled ? `, pulled here${current ? ` on ${current}` : ''}` : ''}.`,
  )
  if (state && state.version < summary.latest) {
    ctx.say(`v${summary.latest} is on the server (here v${state.version}): run \`ideaf pull\`.`)
  }
  ctx.result({
    idea: id,
    title: summary.title,
    branch: current,
    pulled: pulled !== null,
    ...(pulled ? { version: pulled.version, changes: pulled.changes } : {}),
  })
  return pulled?.exit ?? EXIT.ok
}

/**
 * The idea is on another branch than this working tree. If that branch is
 * here, or can be fetched from one of this repository's remotes, stop and say
 * which git commands get there; if it's checked out in another worktree, point
 * there. A branch that's nowhere to be found doesn't stop the change.
 */
async function refuseElsewhere(
  ctx: Context,
  named: string,
  id: string,
  wanted: string,
  uri: string | null,
): Promise<void> {
  const current = ctx.ws.git?.branch ?? null
  const here = realpathSync(ctx.ws.root)
  const holder = worktrees(ctx.ws).find((w) => w.branch === wanted && realpathSync(w.path) !== here)
  if (holder) {
    // ideaf's own note of the active idea, ready for when they get there
    await setActiveIdea(openWorkspace(holder.path), id)
    throw new CliError(
      `${named} is on ${wanted}, which is checked out in another worktree: work on it there (cd ${holder.path}), where it's now the idea; or pass --here to work on it in this one`,
      EXIT.error,
      'other_worktree',
      { worktree: holder.path, branch: wanted },
    )
  }
  const remote = uri ? remotes(ctx.ws).find((r) => repoUri(r.url) === uri) : undefined
  const commands =
    branchWhere(ctx.ws, wanted) !== null
      ? [`git switch ${wanted}`]
      : remote
        ? [`git fetch ${remote.name} ${wanted}`, `git switch ${wanted}`]
        : null
  if (!commands) {
    ctx.say(
      uri
        ? `It was last synced from ${wanted} of ${uri}, which isn't a remote of this repository.`
        : `Its branch ${wanted} isn't in this repository.`,
    )
    return
  }
  throw new CliError(
    `${named} is on branch ${wanted}, and you're on ${current ?? 'no branch'}. Switch first, then run ideaf change again:\n${commands.map((c) => `  ${c}`).join('\n')}\n(or pass --here to work on it on ${current ?? 'this commit'})`,
    EXIT.error,
    'switch_first',
    { branch: wanted, commands },
  )
}

/** The idea --title names, or the one a person picks; without a terminal, a choice is an error. */
async function choose(ctx: Context, flags: { title?: string; anyone: boolean }): Promise<string> {
  const { rows, active, me } = await repositoryIdeas(ctx)
  const known = rows
    .filter((r) => r.summary)
    .sort((a, b) => Number(b.state.idea === active) - Number(a.state.idea === active))
    .map((r) => ({
      id: r.state.idea,
      title: r.summary!.title,
      owner: r.summary!.owner,
      note: [r.state.idea === active ? 'this working tree’s' : '', r.state.branch ? `on ${r.state.branch}` : '']
        .filter(Boolean)
        .join(', '),
    }))

  if (flags.title !== undefined) {
    const words = flags.title.trim().toLowerCase()
    const matches = known.filter((o) => o.title.toLowerCase().includes(words))
    if (matches.length === 1) {
      return matches[0]!.id
    }
    if (matches.length > 1) {
      return await pick(ctx, matches, `"${flags.title}" matches ${matches.length} of this repository's ideas`)
    }
    // not in this repository: the ideas you can see on the server
    const found = (await ctx.api.searchIdeas({ q: flags.title })).items
    if (found.length === 0) {
      throw new CliError(`no idea you can see is called "${flags.title}"`, EXIT.notFound, 'not_found')
    }
    if (found.length === 1) {
      return found[0]!.id
    }
    return await pick(
      ctx,
      found.map((i) => ({ id: i.id, title: i.title, note: 'on the server' })),
      `"${flags.title}" matches ${found.length} ideas on the server`,
    )
  }

  const options = known.filter((o) => flags.anyone || o.owner === me.id || o.id === active)
  if (options.length === 0) {
    throw new CliError(
      `no ideas of yours in this repository to change to: name one (\`ideaf change <id>\`)${known.length ? ', or pass --anyone' : ''}, or find one with \`ideaf list --server\``,
      EXIT.usage,
      'no_idea',
    )
  }
  return await pick(ctx, options, 'say which idea')
}

async function pick(ctx: Context, options: Option[], why: string): Promise<string> {
  if (!ctx.io.interactive || ctx.json) {
    throw new CliError(
      `${why}: name one with \`ideaf change <id>\` (${options.map((o) => `${o.id} "${truncate(o.title, 40)}"`).join(', ')})`,
      EXIT.usage,
      'choose',
      { ideas: options },
    )
  }
  const index = await ctx.io.choose(
    'Which idea?',
    options.map((o) => ({ label: `${truncate(o.title, 60)}  ${o.id}`, ...(o.note ? { hint: o.note } : {}) })),
  )
  const chosen = index === null ? undefined : options[index]
  if (!chosen) {
    throw new CliError('no idea chosen', EXIT.usage, 'no_choice')
  }
  return chosen.id
}
