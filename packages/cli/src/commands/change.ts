// ideaf change: make another idea this working tree's. An idea started or
// pulled in this repository remembers its branch, so changing to it switches
// branch (refusing to carry uncommitted changes across); if that branch is
// checked out in another worktree, it says where, since a cli can't change your
// shell's directory. An idea not in this repository yet is pulled here.
import { realpathSync } from 'node:fs'
import { CliError, type Context, EXIT } from '../context.ts'
import {
  activeIdea,
  branchWhere,
  openWorkspace,
  readState,
  setActiveIdea,
  switchBranch,
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

  if (!state) {
    // not in this repository yet: bring it here, on this branch
    const pulled = await ctx.lock(id, () => pullInto(ctx, id))
    await setActiveIdea(ctx.ws, id)
    ctx.say(`Now on ${named}, pulled here${current ? ` on ${current}` : ''}.`)
    ctx.result({
      idea: id,
      title: summary.title,
      branch: current,
      switched: false,
      pulled: true,
      version: pulled.version,
      changes: pulled.changes,
    })
    return pulled.exit
  }

  let branch = current
  const wanted = state.branch
  if (ctx.ws.git && wanted && wanted !== current && !flags.here) {
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
    if (branchWhere(ctx.ws, wanted)) {
      const dirty = trackedChanges(ctx.ws)
      if (dirty.length) {
        throw new CliError(
          `switching to ${wanted} would carry your uncommitted changes (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', …' : ''}) into it: commit or stash them first, or pass --here to stay on ${current ?? 'this commit'}`,
          EXIT.error,
          'uncommitted',
          { files: dirty },
        )
      }
      const switched = switchBranch(ctx.ws, wanted)
      if (!switched.ok) {
        throw new CliError(`couldn't switch to ${wanted}: ${switched.error}`, EXIT.error, 'git')
      }
      branch = wanted
    } else {
      ctx.say(`Its branch ${wanted} is gone, so staying on ${current ?? 'this commit'}.`)
    }
  }

  const before = await activeIdea(ctx.ws)
  await setActiveIdea(ctx.ws, id)
  const switched = branch !== current
  ctx.say(
    before === id && !switched ? `Already on ${named}.` : `Now on ${named}${switched ? `, on branch ${branch}` : ''}.`,
  )
  if (state.version < summary.latest) {
    ctx.say(`v${summary.latest} is on the server (here v${state.version}): run \`ideaf pull\`.`)
  }
  ctx.result({ idea: id, title: summary.title, branch, switched, pulled: false })
  return EXIT.ok
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
      return pick(ctx, matches, `"${flags.title}" matches ${matches.length} of this repository's ideas`)
    }
    // not in this repository: the ideas you can see on the server
    const found = (await ctx.api.searchIdeas({ q: flags.title })).items
    if (found.length === 0) {
      throw new CliError(`no idea you can see is called "${flags.title}"`, EXIT.notFound, 'not_found')
    }
    if (found.length === 1) {
      return found[0]!.id
    }
    return pick(
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
  return pick(ctx, options, 'say which idea')
}

function pick(ctx: Context, options: Option[], why: string): string {
  if (!ctx.io.interactive || ctx.json) {
    throw new CliError(
      `${why}: name one with \`ideaf change <id>\` (${options.map((o) => `${o.id} "${truncate(o.title, 40)}"`).join(', ')})`,
      EXIT.usage,
      'choose',
      { ideas: options },
    )
  }
  options.forEach((o, n) => {
    ctx.say(`  ${String(n + 1).padStart(2)}) ${truncate(o.title, 60)}  ${o.id}${o.note ? `  (${o.note})` : ''}`)
  })
  const answer = Number(ctx.io.prompt(`Which idea? [1-${options.length}]`)?.trim())
  const chosen = Number.isInteger(answer) ? options[answer - 1] : undefined
  if (!chosen) {
    throw new CliError('no idea chosen', EXIT.usage, 'no_choice')
  }
  return chosen.id
}
