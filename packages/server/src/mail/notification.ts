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
  const block = ideaBlock(item, due.people, site, false)
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

/** One idea's updates, with its title as a link (above them in a digest) and a link to open it. */
function ideaBlock(item: DueEmail['ideas'][number], people: DueEmail['people'], site: Site, titled = true) {
  const { idea } = item
  const url = `${site.baseURL}${ideaPath(idea.place, idea.number)}`
  const lines = item.events.map((e) => updateLine(e, people))
  const earlier = item.more > 0 ? `…and ${item.more} earlier ${item.more === 1 ? 'update' : 'updates'}` : null
  const where = idea.teamInfo ? idea.teamInfo.name : idea.place
  return {
    text: [
      ...(titled ? [`${idea.title} (${where}, ${WHY[item.reason]})`] : []),
      ...(earlier ? [earlier] : []),
      ...lines.map((l) => (titled ? `  ${l}` : l)),
      '',
      `Open it: ${url}`,
      '',
    ].join('\n'),
    html: `${titled ? `<h2 style="font-size:17px;margin:20px 0 4px"><a href="${escape(url)}" style="color:#1d1d1f">${escape(idea.title)}</a> <span style="color:#666;font-weight:400;font-size:14px">${escape(where)} · ${escape(WHY[item.reason])}</span></h2>` : ''}
${earlier ? `<p style="color:#666;margin:4px 0">${escape(earlier)}</p>` : ''}
<ul style="padding-left:20px;margin:4px 0">${lines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>
<p style="margin:8px 0 16px"><a href="${escape(url)}">Open it</a></p>`,
  }
}

function page(body: string, footer: string): string {
  return `<!doctype html><html><body style="font:15px/1.5 system-ui,sans-serif;color:#1d1d1f">
${body}
<p style="color:#666;font-size:13px;border-top:1px solid #ddd;padding-top:8px">${footer}</p>
</body></html>`
}
