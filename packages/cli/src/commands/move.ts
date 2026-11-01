// ideaf move: the move wizard. Moving an idea into, out of, or to another team
// changes who can see it, so it shows who would lose or gain access first, and
// asks before moving (or takes --yes). --keep and --skip adjust what changes.
import type { Input, Operations, Output } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { grantLines, type Labelled, Names, sameSubject, userLabel } from './subjects.ts'

type Preview = Output<Operations['previewMove']>
type Shown = Omit<Preview, 'grants'> & { grants: { now: Labelled[]; after: Labelled[] } }

export async function move(
  ctx: Context,
  flags: { idea?: string; team?: string; out: boolean; keep: string[]; skip: string[]; yes: boolean; dryRun: boolean },
): Promise<number> {
  if ((flags.team === undefined) === !flags.out) {
    throw new CliError(
      'say where to: --team <team> moves it into a team, --out takes it out of its team',
      EXIT.usage,
      'usage',
    )
  }
  const idea = await ctx.ideaId(flags.idea)
  const names = new Names(ctx)
  const resolve = (list: string[]) => Promise.all(list.map((n) => names.resolve(n)))
  const [keep, skip, to] = await Promise.all([
    resolve(flags.keep),
    resolve(flags.skip),
    flags.team === undefined ? null : names.resolve(`team:${flags.team.replace(/^team:/, '')}`),
  ])
  const input: Input<Operations['moveIdea']> = {
    idea,
    team: to && to.kind === 'team' ? to.id : null,
    ...(keep.length ? { keep } : {}),
    ...(skip.length ? { skip } : {}),
  }

  const preview = await ctx.api.previewMove(input)
  const report = async (p: Preview): Promise<Shown> => {
    const [now, after] = await Promise.all([names.grants(p.grants.now), names.grants(p.grants.after)])
    return { ...p, grants: { now, after } }
  }
  const shown = await report(preview)
  await describe(ctx, shown, names)

  if (preview.from === preview.to) {
    ctx.say('Nothing to move.')
    ctx.result({ ...shown, moved: false })
    return EXIT.ok
  }
  if (flags.dryRun) {
    ctx.say('\nDry run: nothing changed.')
    ctx.result({ ...shown, moved: false })
    return EXIT.ok
  }
  if (!flags.yes) {
    if (!ctx.io.interactive || ctx.json) {
      throw new CliError(
        'moving changes who can see the idea: check the preview, then pass --yes to move it',
        EXIT.usage,
        'confirm',
        shown,
      )
    }
    ctx.say('')
    if (!(await ctx.io.confirm('Move it?'))) {
      ctx.say('Not moved.')
      return EXIT.ok
    }
  }

  const moved = await report(await ctx.api.moveIdea(input))
  ctx.say(`\nMoved ${moved.to ? `to ${await names.label({ kind: 'team', id: moved.to })}` : 'out of its team'}.`)
  ctx.result({ ...moved, moved: true })
  return EXIT.ok
}

async function describe(ctx: Context, p: Shown, names: Names): Promise<void> {
  const team = (id: string | null) => (id ? names.label({ kind: 'team', id }) : Promise.resolve(null))
  const [from, to] = await Promise.all([team(p.from), team(p.to)])
  ctx.say(
    from && to
      ? `Moving from ${from} to ${to}.`
      : to
        ? `Moving into ${to}.`
        : from
          ? `Moving out of ${from}.`
          : 'Not in a team.',
  )
  if (!to && from) {
    ctx.say("Outside a team, only its owner and the people, groups and teams it's shared with can see it.")
  }
  ctx.say('\nAccess now:')
  ctx.say(grantLines(p.grants.now).join('\n') || '  only the owner')
  ctx.say('Access after:')
  ctx.say(grantLines(p.grants.after).join('\n') || '  only the owner')
  ctx.say('')
  ctx.say(changeLine('Losing access', p.losing, 'everyone it isn’t shared with, as it stops being public'))
  ctx.say(changeLine('Gaining access', p.gaining, 'everyone, as it becomes public'))

  // what --keep and --skip could change
  const hints: string[] = []
  for (const g of p.grants.now) {
    if (!p.grants.after.some((a) => sameSubject(a.subject, g.subject))) {
      hints.push(`--keep ${g.who}`)
    }
  }
  for (const g of p.grants.after) {
    if (!p.grants.now.some((n) => sameSubject(n.subject, g.subject))) {
      hints.push(`--skip ${g.who}`)
    }
  }
  if (hints.length) {
    ctx.say(`Adjust with ${hints.join(', ')}.`)
  }
}

function changeLine(heading: string, change: Preview['losing'], everyone: string): string {
  if (change.everyone) {
    return `${heading}: ${everyone} (${change.count} ${change.count === 1 ? 'person' : 'people'}).`
  }
  if (change.count === 0) {
    return `${heading}: no one.`
  }
  const more = change.count - change.people.length
  return `${heading} (${change.count}): ${[...change.people.map(userLabel), ...(more > 0 ? [`${more} more`] : [])].join(', ')}.`
}
