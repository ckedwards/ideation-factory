// ideaf share: who can see the idea, and giving or removing view, edit or
// share access to people, groups, teams' members or everyone.
import { CliError, type Context, EXIT } from '../context.ts'
import { accessPhrase, grantLines, Names, sameSubject, userLabel } from './subjects.ts'

export async function share(
  ctx: Context,
  flags: { idea?: string; edit: boolean; share: boolean; remove: boolean },
  who: string[],
): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  if (who.length === 0) {
    if (flags.edit || flags.share || flags.remove) {
      throw new CliError('name who to share with, or to remove', EXIT.usage, 'usage')
    }
    return showAccess(ctx, idea)
  }
  if (flags.remove && (flags.edit || flags.share)) {
    throw new CliError('--remove takes all their access away: leave out --edit and --share', EXIT.usage, 'usage')
  }
  const access = flags.remove ? null : { edit: flags.edit, share: flags.share }
  if (access && (access.edit || access.share) && who.includes('everyone')) {
    throw new CliError('everyone can only be given view access', EXIT.usage, 'invalid')
  }

  const names = new Names(ctx)
  const [before, subjects] = await Promise.all([
    ctx.api.getAccess({ idea }).then((a) => a.grants),
    Promise.all(who.map((name) => names.resolve(name))),
  ])
  let grants = before
  const changed: Array<{ who: string; access: typeof access; had: boolean }> = []
  for (const subject of subjects) {
    grants = (await ctx.api.setAccess({ idea, subject, access })).grants
    changed.push({ who: await names.label(subject), access, had: before.some((g) => sameSubject(g.subject, subject)) })
  }

  for (const c of changed) {
    if (c.access) {
      ctx.say(c.who === 'everyone' ? 'Everyone can now view it.' : `${c.who} can now ${accessPhrase(c.access)} it.`)
    } else if (c.had) {
      ctx.say(c.who === 'everyone' ? "It's no longer public." : `Removed ${c.who}'s access.`)
    } else {
      ctx.say(`${c.who} had no access of their own (they may still see it through a team or group).`)
    }
  }
  const labelled = await names.grants(grants)
  ctx.say('')
  ctx.say(labelled.length ? 'Shared with:' : 'Not shared with anyone.')
  for (const line of grantLines(labelled)) {
    ctx.say(line)
  }
  ctx.result({ idea, changed: changed.map((c) => ({ who: c.who, access: c.access })), grants: labelled })
  return EXIT.ok
}

async function showAccess(ctx: Context, idea: string): Promise<number> {
  const [{ you, grants }, summary] = await Promise.all([ctx.api.getAccess({ idea }), ctx.api.getIdea({ idea })])
  const owner = await ctx.api.getUser({ user: summary.owner }).catch(() => null)
  const labelled = await new Names(ctx).grants(grants)

  ctx.say(`${summary.title} (${idea})`)
  ctx.say(`  Owner: ${owner ? userLabel(owner) : summary.owner}`)
  if (labelled.length === 0) {
    ctx.say('  Not shared with anyone.')
  } else {
    ctx.say('  Shared with:')
    for (const line of grantLines(labelled, '    ')) {
      ctx.say(line)
    }
  }
  const yours = you.owner ? 'You own it.' : `You can ${accessPhrase(you)} it.`
  ctx.say(`  ${yours}`)
  if (you.share) {
    ctx.say('\nShare with `ideaf share <who> [--edit] [--share]`, or take access away with `--remove`.')
  }
  ctx.result({
    idea,
    owner: owner ?? { id: summary.owner },
    you,
    grants: labelled,
  })
  return EXIT.ok
}
