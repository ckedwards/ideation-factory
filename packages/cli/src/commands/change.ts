// ideaf change: make another idea this working tree's. An idea started or
// pulled in this repository remembers its branch, so changing to it switches
// branch (refusing to carry uncommitted changes across); if that branch is
// checked out in another worktree, it says where, since a cli can't change your
// shell's directory. An idea not in this repository yet is pulled here, onto
// its branch if the server knows it and it's on one of this repository's
// remotes: the same idea on another machine.
import { realpathSync } from 'node:fs'
import { CliError, type Context, EXIT } from '../context.ts'
import {
  activeIdea,
  branchWhere,
  fetchBranch,
  openWorkspace,
  readState,
  remoteKey,
  remotes,
  setActiveIdea,
  switchBranch,
  trackBranch,
  trackedChanges,
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
  let branch = current

  if (ctx.ws.git && !flags.here) {
    if (state?.branch && state.branch !== current) {
      branch = (await goTo(ctx, named, id, state.branch, null)) ?? current
    } else if (!state && summary.git && summary.git.branch !== current) {
      // not here yet: on another machine, its branch may be on one of this repository's remotes
      const place = summary.git
      const remote = place.remote ? remotes(ctx.ws).find((r) => remoteKey(r.url) === remoteKey(place.remote!)) : null
      if (remote) {
        branch = (await goTo(ctx, named, id, place.branch, remote.name)) ?? current
      } else {
        ctx.say(
          `It was last synced from ${place.branch}${place.remote ? ` of ${place.remote}, which isn't a remote of this repository` : ', which has no remote'}, so it's pulled onto ${current ?? 'this commit'}.`,
        )
      }
    }
  }

  // not in this repository yet: bring it here
  const pulled = state ? null : await ctx.lock(id, () => pullInto(ctx, id))
  const before = await activeIdea(ctx.ws)
  await setActiveIdea(ctx.ws, id)
  const switched = branch !== current
  ctx.say(
    before === id && !switched && !pulled
      ? `Already on ${named}.`
      : `Now on ${named}${switched ? `, on branch ${branch}` : ''}${pulled ? `, pulled here${switched || !branch ? '' : ` on ${branch}`}` : ''}.`,
  )
  if (state && state.version < summary.latest) {
    ctx.say(`v${summary.latest} is on the server (here v${state.version}): run \`ideaf pull\`.`)
  }
  ctx.result({
    idea: id,
    title: summary.title,
    branch,
    switched,
    pulled: pulled !== null,
    ...(pulled ? { version: pulled.version, changes: pulled.changes } : {}),
  })
  return pulled?.exit ?? EXIT.ok
}

/**
 * Switches this working tree to the idea's branch: from here, or fetched from
 * `remote`. Refuses if it's checked out in another worktree (making the idea
 * active there) or if uncommitted changes would come along. Null if the branch
 * is gone.
 */
async function goTo(
  ctx: Context,
  named: string,
  id: string,
  wanted: string,
  remote: string | null,
): Promise<string | null> {
  const current = ctx.ws.git?.branch ?? null
  const here = realpathSync(ctx.ws.root)
  const holder = worktrees(ctx.ws).find((w) => w.branch === wanted && realpathSync(w.path) !== here)
  if (holder) {
    // ready for when they get there
    await setActiveIdea(openWorkspace(holder.path), id)
    throw new CliError(
      `${named} is on ${wanted}, which is checked out in another worktree: work on it there (cd ${holder.path}), where it's now the idea; or pass --here to work on it in this one without switching branch`,
      EXIT.error,
      'other_worktree',
      { worktree: holder.path, branch: wanted },
    )
  }
  let where = branchWhere(ctx.ws, wanted)
  if (where !== 'local' && remote) {
    const fetched = fetchBranch(ctx.ws, remote, wanted)
    if (!fetched.ok) {
      ctx.say(`Couldn't fetch ${wanted} from ${remote} (${fetched.error}), so staying on ${current ?? 'this commit'}.`)
      return null
    }
    where = 'remote'
  }
  if (!where) {
    ctx.say(`Its branch ${wanted} is gone, so staying on ${current ?? 'this commit'}.`)
    return null
  }
  const dirty = trackedChanges(ctx.ws)
  if (dirty.length) {
    throw new CliError(
      `switching to ${wanted} would carry your uncommitted changes (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', …' : ''}) into it: commit or stash them first, or pass --here to stay on ${current ?? 'this commit'}`,
      EXIT.error,
      'uncommitted',
      { files: dirty },
    )
  }
  const result = where === 'remote' && remote ? trackBranch(ctx.ws, remote, wanted) : switchBranch(ctx.ws, wanted)
  if (!result.ok) {
    throw new CliError(`couldn't switch to ${wanted}: ${result.error}`, EXIT.error, 'git')
  }
  return wanted
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
