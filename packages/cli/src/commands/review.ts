// ideaf review …, ideaf status, ideaf close and ideaf reopen: where an idea
// is (a draft, out for review, being revised, or closed), who's asked to
// review it, and their verdicts. People move an idea; a verdict never does.
// A Request changes or Reject stands through new versions until it's
// withdrawn or dismissed, and stops the idea closing as accepted.
import type { Caller, IdeaStatus, Operations, Output, Review, Verdict } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { truncate } from './output.ts'
import { Names } from './subjects.ts'

type Reviews = Output<Operations['listReviews']>

const STATUS: Record<IdeaStatus, string> = {
  draft: 'a draft',
  'requesting-review': 'requesting review',
  'changes-in-progress': 'changes in progress',
  'closed-accepted': 'closed as accepted',
  'closed-rejected': 'closed as rejected',
}

const VERDICT: Record<Verdict, string> = {
  approve: 'approved',
  'request-changes': 'requested changes',
  reject: 'rejected',
}

/** What `ideaf status` takes: the open statuses, by name or a short word. */
const OPEN: Record<string, 'draft' | 'requesting-review' | 'changes-in-progress'> = {
  draft: 'draft',
  review: 'requesting-review',
  'requesting-review': 'requesting-review',
  changes: 'changes-in-progress',
  'changes-in-progress': 'changes-in-progress',
}

export async function show(ctx: Context, flags: { idea?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const reviews = await ctx.api.listReviews({ idea })
  ctx.result({ idea, ...reviews })
  await print(ctx, idea, reviews)
  return EXIT.ok
}

async function print(ctx: Context, idea: string, reviews: Reviews): Promise<void> {
  const names = new Names(ctx)
  ctx.say(`${idea} is ${STATUS[reviews.status]}, on v${reviews.latest}.`)
  if (reviews.reviewers.length > 0) {
    // and, for a person, the latest version they've opened
    const seen = new Map(reviews.seen.map((r) => [r.user, r.version]))
    const asked = await Promise.all(
      reviews.reviewers.map(async (s) => {
        const label = await names.label(s)
        if (s.kind !== 'user') {
          return label
        }
        const version = seen.get(s.id)
        return `${label} · ${version === undefined ? 'hasn’t opened it' : `seen v${version}`}`
      }),
    )
    ctx.say(`Asked to review: ${asked.join(', ')}`)
  }
  const unmet = reviews.requirements.checks.filter((c) => !c.met)
  if (reviews.requirements.checks.length > 0) {
    ctx.say(
      unmet.length === 0
        ? 'Its team’s approval requirements are met.'
        : `Its team’s approval requirements aren’t met yet:\n${unmet.map((c) => `  ${checkWords(c)}`).join('\n')}`,
    )
  }
  if (reviews.pending > 0) {
    ctx.say(
      `You have ${plural(reviews.pending)}: only you see ${reviews.pending === 1 ? 'it' : 'them'} until \`ideaf review submit\`, or a verdict, sends ${reviews.pending === 1 ? 'it' : 'them'}.`,
    )
  }
  if (reviews.reviews.length === 0) {
    ctx.say('No verdicts yet.')
    return
  }
  ctx.say('Verdicts:')
  for (const r of reviews.reviews) {
    ctx.say(`  ${await line(names, r)}`)
    if (r.body) {
      ctx.say(`      ${truncate(r.body.replace(/\s+/g, ' '), 100)}`)
    }
    if (r.dismissed) {
      ctx.say(
        `      dismissed by ${await by(names, r.dismissed.by)}: ${truncate(r.dismissed.reason.replace(/\s+/g, ' '), 80)}`,
      )
    }
  }
  const standing = reviews.reviews.filter((r) => r.standing).length
  if (standing > 0 && !reviews.status.startsWith('closed')) {
    ctx.say(
      `\n${standing === 1 ? 'An objection stands' : `${standing} objections stand`}: it can't be closed as accepted until ${standing === 1 ? 'it changes or is' : 'they change or are'} dismissed (ideaf review dismiss).`,
    )
  }
}

type Check = Reviews['requirements']['checks'][number]

function checkWords(c: Check): string {
  if (c.kind === 'approvals') {
    return `${c.have} of ${c.need} approvals`
  }
  if (c.kind === 'resolved') {
    return `${c.open} open ${c.open === 1 ? 'discussion' : 'discussions'}`
  }
  const names = c.groups.map((g) => `group:${g.handle}${g.deleted ? ' (deleted)' : ''}`).join(', ')
  if (c.broken) {
    return `a rule names a deleted group (${names}): a maintainer has to fix it`
  }
  return `an approval from ${c.mode === 'each' ? 'each of' : 'any of'} ${names}`
}

async function line(names: Names, r: Review): Promise<string> {
  const notes = [
    `v${r.version}`,
    ...(r.counts
      ? ['counts']
      : r.verdict === 'approve'
        ? [r.by.purpose === 'me' ? 'on an older version' : 'a bot’s: doesn’t count']
        : []),
    ...(r.standing ? ['stands'] : []),
  ]
  const who = await by(names, r.by)
  // a bot is named by its reviewer key, which is what dismissing takes
  const key = r.by.purpose === 'me' ? '' : ` [${r.reviewer}]`
  return `${VERDICT[r.verdict].padEnd(17)} ${who}${key} · ${notes.join(' · ')}`
}

async function by(names: Names, caller: Caller): Promise<string> {
  const user = await names.label({ kind: 'user', id: caller.user })
  if (caller.purpose === 'bot') {
    return `${caller.bot ?? 'a bot'} (bot)`
  }
  return caller.purpose === 'bot-for-me' ? `${caller.bot ?? 'a bot'} for ${user}` : user
}

export async function verdict(
  ctx: Context,
  flags: { idea?: string; message?: string },
  verdict: Verdict,
): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const { latest } = await ctx.api.getIdea({ idea })
  const { review, published } = await ctx.api.reviewIdea({
    idea,
    version: latest,
    verdict,
    ...(flags.message ? { body: flags.message } : {}),
  })
  ctx.result({ idea, review, published })
  const said = verdict === 'approve' ? 'Approved' : verdict === 'reject' ? 'Rejected' : 'Requested changes to'
  ctx.say(
    `${said} v${latest} of ${idea}${published.length ? `, publishing ${plural(published.length)}` : ''}.${verdict === 'approve' && review && !review.counts ? ' A bot’s approval shows, but doesn’t count toward the team’s requirements.' : ''}`,
  )
  return EXIT.ok
}

const plural = (n: number) => (n === 1 ? '1 pending comment' : `${n} pending comments`)

/** Publishes your pending comments, with no verdict. */
export async function submit(ctx: Context, flags: { idea?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const { latest } = await ctx.api.getIdea({ idea })
  const { published } = await ctx.api.reviewIdea({ idea, version: latest })
  ctx.result({ idea, published })
  ctx.say(`Published ${plural(published.length)} on ${idea}: ${published.join(', ')}.`)
  return EXIT.ok
}

/** Deletes your pending comments. */
export async function discard(ctx: Context, flags: { idea?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const { deleted } = await ctx.api.discardReview({ idea })
  ctx.result({ idea, deleted })
  ctx.say(deleted.length ? `Discarded ${plural(deleted.length)}.` : 'You had nothing pending.')
  return EXIT.ok
}

export async function dismiss(ctx: Context, flags: { idea?: string; message?: string }, who: string): Promise<number> {
  if (!flags.message) {
    throw new CliError('say why with -m: dismissing an objection is recorded with its reason', EXIT.usage, 'invalid')
  }
  const idea = await ctx.ideaId(flags.idea)
  // a person by name, or a reviewer key as `ideaf review show` prints it (a bot's)
  const reviewer = /^[ub]:/.test(who) ? who : `u:${(await ctx.api.getUser({ user: who })).id}`
  const review = await ctx.api.dismissReview({ idea, reviewer, reason: flags.message })
  ctx.result({ idea, review })
  ctx.say(`Dismissed the objection: it no longer stops ${idea} closing as accepted.`)
  return EXIT.ok
}

export async function ask(ctx: Context, flags: { idea?: string }, who: string[], reviewer: boolean): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const names = new Names(ctx)
  const done: string[] = []
  for (const name of who) {
    const subject = await names.resolve(name)
    if (subject.kind !== 'user' && subject.kind !== 'group') {
      throw new CliError(`"${name}" can't review: name a person or group:<handle>`, EXIT.usage, 'invalid')
    }
    await ctx.api.setReviewer({ idea, subject, reviewer })
    done.push(await names.label(subject))
  }
  ctx.result({ idea, reviewers: done, asked: reviewer })
  ctx.say(
    reviewer
      ? `Asked ${done.join(', ')} to review ${idea}.`
      : `Took ${done.join(', ')} off the reviewers of ${idea} (they keep their access).`,
  )
  return EXIT.ok
}

export async function status(ctx: Context, flags: { idea?: string; message?: string }, to?: string): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  if (to === undefined) {
    return show(ctx, flags)
  }
  const status = OPEN[to]
  if (!status) {
    throw new CliError(
      `"${to}" isn't an open status: draft, review (requesting review) or changes (changes in progress). Close it with ideaf close`,
      EXIT.usage,
      'invalid',
    )
  }
  const done = await ctx.api.setStatus({ idea, status, ...(flags.message ? { note: flags.message } : {}) })
  ctx.result({ idea, ...done })
  ctx.say(`${idea} is ${STATUS[done.status]}.`)
  return EXIT.ok
}

export async function close(
  ctx: Context,
  flags: { idea?: string; message?: string; accepted?: boolean; rejected?: boolean },
): Promise<number> {
  if (flags.accepted === flags.rejected) {
    throw new CliError('close it with --accepted (it goes ahead) or --rejected (it doesn’t)', EXIT.usage, 'invalid')
  }
  const idea = await ctx.ideaId(flags.idea)
  const done = await ctx.api.closeIdea({
    idea,
    reason: flags.accepted ? 'accepted' : 'rejected',
    ...(flags.message ? { note: flags.message } : {}),
  })
  ctx.result({ idea, ...done })
  ctx.say(`${idea} is ${STATUS[done.status]}.`)
  return EXIT.ok
}

export async function reopen(ctx: Context, flags: { idea?: string; message?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const done = await ctx.api.reopenIdea({ idea, ...(flags.message ? { note: flags.message } : {}) })
  ctx.result({ idea, ...done })
  ctx.say(`Reopened ${idea}: it's ${STATUS[done.status]}.`)
  return EXIT.ok
}
