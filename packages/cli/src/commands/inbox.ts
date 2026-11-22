// ideaf inbox …, subscribe and unsubscribe: what's happened to the ideas you
// hear about, one line per idea however much happened, and the notices about
// your teams and groups among them; and clearing them.
import { type IdeaNotification, ideaPath, type NoticeNotification } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { truncate } from './output.ts'
import { Names } from './subjects.ts'

const REASONS = [
  'author',
  'review-requested',
  'group-review',
  'participating',
  'subscribed',
  'watching',
  'teams',
] as const
type Reason = (typeof REASONS)[number]

const WHY: Record<Reason, string> = {
  author: 'author',
  'review-requested': 'review requested',
  'group-review': 'via a group',
  participating: 'participating',
  subscribed: 'subscribed',
  watching: 'watching a team',
  teams: 'teams and groups',
}

const AS: Record<NoticeNotification['notice']['as'], string> = {
  'team-admin': 'team admin',
  'group-admin': 'group admin',
  you: 'you',
}

export async function show(
  ctx: Context,
  flags: { done?: boolean; unread?: boolean; reason?: string; team?: string; cursor?: string },
): Promise<number> {
  if (flags.reason !== undefined && !REASONS.includes(flags.reason as Reason)) {
    throw new CliError(`--reason takes ${REASONS.join(', ')}`, EXIT.usage, 'invalid')
  }
  const page = await ctx.api.listNotifications({
    ...(flags.done ? { done: true } : {}),
    ...(flags.unread ? { unread: true } : {}),
    ...(flags.reason ? { reason: flags.reason as Reason } : {}),
    ...(flags.team ? { team: flags.team } : {}),
    ...(flags.cursor ? { cursor: flags.cursor } : {}),
  })
  ctx.result(page)
  if (page.items.length === 0) {
    ctx.say(flags.done ? 'Nothing done yet.' : 'Your inbox is empty.')
    return EXIT.ok
  }
  const names = new Names(ctx)
  for (const n of page.items) {
    if (n.kind === 'notice') {
      // a notice: its ID (to mark it), its team or group, what happened, and who did it
      const words = noticeWords(n.notice)
      ctx.say(
        `${(n.newCount > 0 ? '● new' : '  read').padEnd(9)} ${n.id}  ${words.where}  ${truncate(words.title, 50)}  (${AS[n.notice.as]})`,
      )
      ctx.say(`          ${await who(n.notice.actor, names)} ${words.update}`)
      continue
    }
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

/**
 * A notice in words: where (its team's handle, or its group's), what happened, and what its actor did, from the
 * reader's side ("your group" to a group's admin). A team or group that's gone is named as it was.
 */
export function noticeWords(notice: NoticeNotification['notice']): { where: string; title: string; update: string } {
  const team = notice.team?.name ?? 'a team'
  const group = notice.group?.name ?? 'a group'
  const theGroup = notice.as === 'group-admin' ? 'your group' : group
  const where = notice.team ? (notice.team.handle ?? notice.team.name) : `group ${notice.group?.handle ?? group}`
  const container = notice.team ? team : group
  const kind = notice.team ? 'team' : 'group'
  switch (notice.kind) {
    case 'group-joined':
      return {
        where,
        title: `${group} joined ${team}${notice.role ? `, as ${notice.role}s` : ''}`,
        update: `added ${theGroup} to ${team}`,
      }
    case 'group-left':
      return { where, title: `${group} left ${team}`, update: `took ${theGroup} out of ${team}` }
    case 'added':
      return {
        where,
        title: `You joined ${container}${notice.role ? `, as ${/^[aeiou]/.test(notice.role) ? 'an' : 'a'} ${notice.role}` : ''}`,
        update: `added you to the ${kind}`,
      }
    case 'removed':
      return { where, title: `You’re no longer in ${container}`, update: `took you out of the ${kind}` }
  }
}

/** Who did something, as the inbox names them. */
async function who(actor: IdeaNotification['latest']['actor'], names: Names): Promise<string> {
  const user = actor.user ? await names.label({ kind: 'user', id: actor.user }) : 'its team’s rules'
  return actor.purpose === 'bot'
    ? `${actor.bot ?? 'a bot'} (bot)`
    : actor.purpose === 'bot-for-me'
      ? `${actor.bot ?? 'a bot'} for ${user}`
      : user
}

/** The latest update, in words. */
async function latest(n: IdeaNotification, names: Names): Promise<string> {
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
  ids: string[],
  flags: { all?: boolean; team?: string; owner?: string; group?: string },
  change: { read?: true; done?: boolean },
): Promise<number> {
  const chosen = [
    ids.length > 0,
    flags.all === true,
    flags.team !== undefined,
    flags.owner !== undefined,
    flags.group !== undefined,
  ]
  if (chosen.filter(Boolean).length !== 1) {
    throw new CliError(
      'name the ideas or notices (their IDs, from `ideaf inbox show`), or pass one of --all, --team, --owner or --group',
      EXIT.usage,
      'usage',
    )
  }
  // a notice's ID starts nt; an idea's doesn't
  const notices = ids.filter((id) => id.startsWith('nt'))
  const ideas = ids.filter((id) => !id.startsWith('nt'))
  const { changed } = await ctx.api.markNotifications({
    ...(ids.length > 0 ? { ideas, notices } : {}),
    ...(flags.team ? { team: flags.team } : {}),
    ...(flags.owner ? { owner: flags.owner } : {}),
    ...(flags.group ? { group: flags.group } : {}),
    ...change,
  })
  const what = change.read ? 'read' : change.done ? 'done' : 'back in the inbox'
  // ideas by their IDs; a whole list or section may hold notices about teams and groups too
  const noun = ids.length > 0 && notices.length === 0 ? 'idea' : 'notification'
  ctx.say(`${changed === 1 ? `1 ${noun}` : `${changed} ${noun}s`} marked ${what}.`)
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
