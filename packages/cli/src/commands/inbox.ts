// ideaf inbox …, subscribe and unsubscribe: what's happened to the ideas you
// hear about, one line per idea however much happened, and clearing them.
import { ideaPath, type Notification } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { truncate } from './output.ts'
import { Names } from './subjects.ts'

const REASONS = ['author', 'review-requested', 'group-review', 'participating', 'subscribed', 'watching'] as const
type Reason = (typeof REASONS)[number]

const WHY: Record<Reason, string> = {
  author: 'author',
  'review-requested': 'review requested',
  'group-review': 'via a group',
  participating: 'participating',
  subscribed: 'subscribed',
  watching: 'watching a team',
}

export async function show(
  ctx: Context,
  flags: { done?: boolean; unread?: boolean; reason?: string; cursor?: string },
): Promise<number> {
  if (flags.reason !== undefined && !REASONS.includes(flags.reason as Reason)) {
    throw new CliError(`--reason takes ${REASONS.join(', ')}`, EXIT.usage, 'invalid')
  }
  const page = await ctx.api.listNotifications({
    ...(flags.done ? { done: true } : {}),
    ...(flags.unread ? { unread: true } : {}),
    ...(flags.reason ? { reason: flags.reason as Reason } : {}),
    ...(flags.cursor ? { cursor: flags.cursor } : {}),
  })
  ctx.result(page)
  if (page.items.length === 0) {
    ctx.say(flags.done ? 'Nothing done yet.' : 'Your inbox is empty.')
    return EXIT.ok
  }
  const names = new Names(ctx)
  for (const n of page.items) {
    const mark = n.newCount > 0 ? `● ${n.newCount} new` : '  read'
    ctx.say(
      `${mark.padEnd(9)} ${n.idea.id}  ${ideaPath(n.idea.place, n.idea.number)}  ${truncate(n.idea.title, 50)}  (${WHY[n.reason]})`,
    )
    ctx.say(`          ${await latest(n, names)}`)
  }
  if (page.next) {
    ctx.say(`\nMore: ideaf inbox show --cursor ${page.next}`)
  }
  return EXIT.ok
}

/** The latest update, in words. */
async function latest(n: Notification, names: Names): Promise<string> {
  const { kind, actor, detail } = n.latest
  const user = actor.user ? await names.label({ kind: 'user', id: actor.user }) : 'its team’s rules'
  const who =
    actor.purpose === 'bot'
      ? `${actor.bot ?? 'a bot'} (bot)`
      : actor.purpose === 'bot-for-me'
        ? `${actor.bot ?? 'a bot'} for ${user}`
        : user
  const said = typeof detail.body === 'string' && detail.body ? `: ${truncate(detail.body, 80)}` : ''
  switch (kind) {
    case 'version':
      return `${who} made v${String(detail.version)}`
    case 'comment':
      return `${who} commented${said}`
    case 'suggestion':
      return `${who} suggested an edit${said}`
    case 'reply':
      return `${who} replied${said}`
    case 'review':
      return `${who} ${detail.verdict === 'approve' ? 'approved' : detail.verdict === 'reject' ? 'rejected it' : 'requested changes'}`
    case 'dismissed':
      return `${who} dismissed a review`
    case 'status':
      return `${who} changed its status to ${String(detail.status).replace(/-/g, ' ')}`
    case 'decided':
      return `${who} ${detail.decision === 'accepted' ? 'accepted' : 'rejected'} a suggestion`
    case 'requested':
      return `${who} asked for a review`
    default:
      return `${who} updated it`
  }
}

export async function mark(
  ctx: Context,
  ideas: string[],
  flags: { all?: boolean },
  change: { read?: true; done?: boolean },
): Promise<number> {
  if (ideas.length === 0 && !flags.all) {
    throw new CliError('name the ideas (their IDs, from `ideaf inbox show`), or pass --all', EXIT.usage, 'usage')
  }
  const { changed } = await ctx.api.markNotifications({ ...(flags.all ? {} : { ideas }), ...change })
  const what = change.read ? 'read' : change.done ? 'done' : 'back in the inbox'
  ctx.say(`${changed === 1 ? '1 idea' : `${changed} ideas`} marked ${what}.`)
  ctx.result({ changed })
  return EXIT.ok
}

const EMAIL = ['involved', 'review-requests', 'off'] as const
const CADENCE = ['bundled', 'daily'] as const

export async function settings(
  ctx: Context,
  flags: { ownBots?: boolean; email?: string; emailWatching?: boolean; cadence?: string },
): Promise<number> {
  if (flags.email !== undefined && !EMAIL.includes(flags.email as (typeof EMAIL)[number])) {
    throw new CliError(`--email takes ${EMAIL.join(', ')}`, EXIT.usage, 'invalid')
  }
  if (flags.cadence !== undefined && !CADENCE.includes(flags.cadence as (typeof CADENCE)[number])) {
    throw new CliError(`--cadence takes ${CADENCE.join(', ')}`, EXIT.usage, 'invalid')
  }
  const changes = {
    ...(flags.ownBots !== undefined ? { ownBots: flags.ownBots } : {}),
    ...(flags.email !== undefined ? { email: flags.email as (typeof EMAIL)[number] } : {}),
    ...(flags.emailWatching !== undefined ? { emailWatching: flags.emailWatching } : {}),
    ...(flags.cadence !== undefined ? { cadence: flags.cadence as (typeof CADENCE)[number] } : {}),
  }
  const now =
    Object.keys(changes).length === 0
      ? await ctx.api.getNotificationSettings({})
      : await ctx.api.setNotificationSettings(changes)
  ctx.result(now)
  ctx.say(
    now.ownBots
      ? 'What your bots do on your behalf lands in your inbox (--no-own-bots to stop it).'
      : 'What your bots do on your behalf stays out of your inbox (--own-bots to hear about it).',
  )
  if (!now.emailAvailable) {
    ctx.say('This server doesn’t send notification emails.')
    return EXIT.ok
  }
  ctx.say(
    now.email === 'off'
      ? 'Email: off (--email involved to turn it on).'
      : now.email === 'review-requests'
        ? 'Email: only when you’re asked to review (--email involved for everything).'
        : 'Email: everything your inbox has for ideas you’re involved in (--email review-requests for less).',
  )
  if (now.email !== 'off') {
    ctx.say(
      now.emailWatching
        ? 'The teams you watch email you too (--no-email-watching to stop it).'
        : 'The teams you watch only fill your inbox (--email-watching to email them too).',
    )
    ctx.say(
      now.cadence === 'daily'
        ? 'One digest a day (--cadence bundled for an email per idea).'
        : 'An email per idea, once it has gone quiet for a few minutes (--cadence daily for one a day).',
    )
  }
  return EXIT.ok
}

export async function subscribe(ctx: Context, flags: { idea?: string }, subscribed: boolean): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const now = await ctx.api.setSubscription({ idea, subscribed })
  ctx.result({ idea, ...now })
  ctx.say(
    now.subscribed
      ? `You hear about ${idea} (${WHY[now.reason!]}).`
      : `You won’t hear about ${idea} any more, unless someone asks you to review it.`,
  )
  return EXIT.ok
}
