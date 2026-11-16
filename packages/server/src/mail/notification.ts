// A notification email from the updates due: one idea's (a thread per idea,
// like GitHub's), or a daily digest of several. Each says why it was sent,
// links to the idea, and can be unsubscribed from in one click; headers say
// what it's about, for mail rules.
import { ideaPath } from '@ideaf/api'
import type { DueEmail, InboxEvent, InboxReason } from '../directory/types.ts'
import type { Email } from './sender.ts'
import { unsubscribeURL } from './unsubscribe.ts'

const WHY: Record<InboxReason, string> = {
  author: 'you wrote it',
  'review-requested': 'you were asked to review it',
  'group-review': 'a group you’re in was asked to review it',
  participating: 'you took part in it',
  subscribed: 'you subscribed to it',
  watching: 'you watch its team',
}

const escape = (value: string) =>
  value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

/** Short enough for a line: an update's text, cut at a word. */
function clip(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max).replace(/\s+\S*$/, '')}…`
}

/** Who did it, in words: a person, a bot for them, a bot, or the team's rules. */
function who(event: InboxEvent, people: DueEmail['people']): string {
  const { user, bot, purpose } = event.actor
  const person = user ? people[user] : undefined
  const name = person ? `${person.name} (@${person.handle})` : user ? 'Someone' : 'Its team’s rules'
  if (purpose === 'bot') {
    return `${bot ?? 'A bot'} (a bot)`
  }
  if (purpose === 'bot-for-me') {
    return `${bot ?? 'A bot'} for ${name}`
  }
  return name
}

/** An update, in words: who, and what they did. */
export function updateLine(event: InboxEvent, people: DueEmail['people']): string {
  const { kind, detail } = event
  const said = typeof detail.body === 'string' && detail.body ? `: “${clip(detail.body)}”` : ''
  const by = who(event, people)
  switch (kind) {
    case 'version':
      return `${by} made v${String(detail.version)}`
    case 'comment':
      return `${by} commented${said}`
    case 'suggestion':
      return `${by} suggested an edit${said}`
    case 'reply':
      return `${by} replied${said}`
    case 'review':
      return `${by} ${detail.verdict === 'approve' ? 'approved it' : detail.verdict === 'reject' ? 'rejected it' : 'requested changes'}${said}`
    case 'dismissed':
      return `${by} dismissed a review`
    case 'status':
      return `${by} moved it to ${String(detail.status).replace(/-/g, ' ')}`
    case 'decided':
      return `${by} ${detail.decision === 'accepted' ? 'accepted' : 'rejected'} a suggestion`
    case 'requested':
      return event.actor.user ? `${by} asked you to review it` : `${by} asked for your review`
    default:
      return `${by} updated it`
  }
}

export interface Site {
  /** The deployment's URL, without a trailing slash. */
  baseURL: string
  /** Signs the unsubscribe links. */
  secret: string
}

export function notificationEmail(due: DueEmail, site: Site): Email {
  const host = new URL(site.baseURL).hostname
  const settings = `${site.baseURL}/settings`
  if (!due.digest && due.ideas.length === 1) {
    return ideaEmail(due, due.ideas[0]!, site, host, settings)
  }
  const off = unsubscribeURL(site.baseURL, site.secret, { user: due.to.id, scope: '*' })
  const count = due.ideas.length === 1 ? '1 idea' : `${due.ideas.length} ideas`
  const blocks = due.ideas.map((i) => ideaBlock(i, due.people, site))
  return {
    to: due.to.email,
    subject: `Your daily digest: updates to ${count}`,
    text: [
      ...blocks.map((b) => b.text),
      `You get one email a day with what’s new. Change that: ${settings}`,
      `Stop email notifications: ${off}`,
      '',
    ].join('\n'),
    html: page(
      blocks.map((b) => b.html).join(''),
      `You get one email a day with what’s new. <a href="${escape(settings)}">Change that</a> · <a href="${escape(off)}">Stop email notifications</a>`,
    ),
    headers: {
      'X-Ideaf-Reason': 'digest',
      'List-Unsubscribe': `<${off}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    },
    messageId: `<digest.${due.to.id}.${Date.now()}@${host}>`,
  }
}

function ideaEmail(due: DueEmail, item: DueEmail['ideas'][number], site: Site, host: string, settings: string): Email {
  const { idea } = item
  const address = ideaPath(idea.place, idea.number).slice(1)
  const where = idea.teamInfo ? idea.teamInfo.name : idea.place
  const unsubscribe = unsubscribeURL(site.baseURL, site.secret, { user: due.to.id, scope: idea.id })
  const block = ideaBlock(item, due.people, site)
  const why = `You’re getting this because ${WHY[item.reason]}.`
  return {
    to: due.to.email,
    subject: `[${where}] ${idea.title} (${address})`,
    text: [block.text, why, `Unsubscribe from this idea: ${unsubscribe}`, `Email settings: ${settings}`, ''].join('\n'),
    html: page(
      block.html,
      `${escape(why)} <a href="${escape(unsubscribe)}">Unsubscribe from this idea</a> · <a href="${escape(settings)}">Email settings</a>`,
    ),
    headers: {
      'X-Ideaf-Reason': item.reason,
      'X-Ideaf-Idea': address,
      ...(idea.teamInfo ? { 'X-Ideaf-Team': idea.teamInfo.handle } : {}),
      // a list per team (or per person's own ideas), which mail filters can match
      'List-Id': idea.teamInfo
        ? `${idea.teamInfo.name.replace(/[<>"\r\n]/g, '')} <${idea.teamInfo.handle}.teams.${host}>`
        : `<${idea.ownerInfo.handle}.people.${host}>`,
      'List-Unsubscribe': `<${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    },
    messageId: `<${idea.id}.${item.events.at(-1)!.at}.${due.to.id}@${host}>`,
    references: `<${idea.id}@${host}>`,
  }
}

/** What someone wrote with an update (a comment, a reply, a suggestion, a review's summary), if anything. */
function saidIn(event: InboxEvent): string | null {
  return typeof event.detail.body === 'string' && event.detail.body.trim() ? event.detail.body.trim() : null
}

/**
 * One idea's updates: its title (a link) and team first, then each update: who did what, and what
 * they wrote quoted in full under it, then a link that says where it goes.
 */
function ideaBlock(item: DueEmail['ideas'][number], people: DueEmail['people'], site: Site) {
  const { idea } = item
  const url = `${site.baseURL}${ideaPath(idea.place, idea.number)}`
  const earlier = item.more > 0 ? `…and ${item.more} earlier ${item.more === 1 ? 'update' : 'updates'}` : null
  const where = idea.teamInfo ? idea.teamInfo.name : idea.place
  const updates = item.events.map((e) => {
    const said = saidIn(e)
    // the line without what was said, which is quoted under it
    const line = updateLine(said ? { ...e, detail: { ...e.detail, body: '' } } : e, people)
    return { line: said ? `${line}:` : line, said: said ? clip(said, 2000) : null }
  })
  const view = `View ${idea.title}`
  return {
    text: [
      `${idea.title} · ${where}`,
      '',
      ...(earlier ? [earlier, ''] : []),
      ...updates.flatMap((u) => [u.line, ...(u.said ? u.said.split('\n').map((l) => `> ${l}`) : []), '']),
      `${view}: ${url}`,
      '',
    ].join('\n'),
    html: `<h2 style="font:600 19px/1.3 Georgia,serif;margin:20px 0 2px"><a href="${escape(url)}" style="color:#1f1d1a;text-decoration:none">${escape(idea.title)}</a></h2>
<p style="color:#6f685e;font-size:13px;margin:0 0 12px">${escape(where)} · ${escape(WHY[item.reason])}</p>
${earlier ? `<p style="color:#6f685e;margin:4px 0">${escape(earlier)}</p>` : ''}
${updates
  .map(
    (u) =>
      `<p style="margin:10px 0 4px">${escape(u.line)}</p>${
        u.said
          ? `<blockquote style="margin:0 0 8px;padding:6px 12px;border-left:3px solid #cfc8ba;color:#1f1d1a;white-space:pre-wrap">${escape(u.said)}</blockquote>`
          : ''
      }`,
  )
  .join('\n')}
<p style="margin:14px 0 18px"><a href="${escape(url)}" style="display:inline-block;padding:6px 14px;border-radius:6px;background:#2b6b5a;color:#ffffff;text-decoration:none;font-weight:600">${escape(view)}</a></p>`,
  }
}

function page(body: string, footer: string): string {
  return `<!doctype html><html><body style="font:15px/1.5 system-ui,sans-serif;color:#1f1d1a;max-width:40rem">
${body}
<p style="color:#666;font-size:13px;border-top:1px solid #ddd;padding-top:8px">${footer}</p>
</body></html>`
}
