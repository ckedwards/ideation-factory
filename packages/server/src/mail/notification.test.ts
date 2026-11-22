// Notification emails: what one says and the headers mail rules match, the
// signed unsubscribe links and their page, sending over SMTP from its own
// sender, and which sender the environment picks.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DueEmail, IdeaListing, NoticeInboxRow } from '../directory/types.ts'
import { fakeSmtp } from './fake-smtp.ts'
import { notificationEmail } from './notification.ts'
import { settingsFrom } from '../settings/load.ts'
import { emailSender, logSender, notificationEmailFrom } from './sender.ts'
import { readUnsubscribeToken, unsubscribePage, unsubscribeToken } from './unsubscribe.ts'

const site = { baseURL: 'https://ideas.example.test', secret: 'a-test-secret-0123456789abcdef-0123' }

const listing = (extra: Partial<IdeaListing> = {}): IdeaListing => ({
  id: 'id1',
  title: 'Faster sign-in',
  description: '',
  team: 't1',
  owner: 'u-riley',
  status: 'requesting-review',
  latest: 2,
  createdAt: 1,
  updatedAt: 2,
  number: 9,
  openComments: 0,
  place: 'mobile',
  teamInfo: { id: 't1', handle: 'mobile', name: 'Mobile', archived: false },
  ownerInfo: { id: 'u-riley', handle: 'riley', name: 'Riley', inactive: false },
  approvers: [],
  approvals: [],
  reviewers: [],
  visibility: 'private',
  requirements: { met: true, checks: [] },
  ...extra,
})

const due = (extra: Partial<DueEmail> = {}): DueEmail => ({
  to: { id: 'u-maya', handle: 'maya', name: 'Maya', email: 'maya@example.test' },
  digest: false,
  ideas: [
    {
      idea: listing(),
      reason: 'review-requested',
      events: [
        { kind: 'requested', actor: { user: 'u-riley', bot: null, purpose: 'me' }, at: 10, detail: {} },
        {
          kind: 'comment',
          actor: { user: 'u-riley', bot: 'planbot', purpose: 'bot-for-me' },
          at: 11,
          detail: { body: 'Shall we <b>drop</b> passwords?' },
        },
      ],
      more: 3,
    },
  ],
  people: { 'u-riley': { handle: 'riley', name: 'Riley' } },
  notices: [],
  sent: { user: 'u-maya', events: [], notices: [] },
  ...extra,
})

describe('a notification email', () => {
  test('names the idea and its team, says what happened and why, and threads per idea', () => {
    const email = notificationEmail(due(), site)
    expect(email.to).toBe('maya@example.test')
    expect(email.subject).toBe('[Mobile] Faster sign-in (mobile/idea/9)')
    expect(email.text).toContain('…and 3 earlier updates')
    // the idea and its team first, in the body too, not only the subject
    expect(email.text.startsWith('Faster sign-in · Mobile\n')).toBe(true)
    expect(email.text).toContain('Riley (@riley) asked you to review it')
    // a comment: who, then what they said, in full, quoted
    expect(email.text).toContain('planbot for Riley (@riley) commented:\n> Shall we <b>drop</b> passwords?')
    // the button says where it goes in two words: the title is at the top
    expect(email.text).toContain('Open the idea: https://ideas.example.test/mobile/idea/9')
    expect(email.html).toContain('<blockquote')
    expect(email.html).toContain('>Open the idea</a>')
    // nothing quoted: one quiet line; the footer's links in the app's colours, not the browser's blue
    expect(email.html).toContain('color:#6f685e;font-size:13px">Riley (@riley) asked you to review it</p>')
    expect(email.html).toContain('<a style="color:#2b6b5a" href=')
    expect(email.text).toContain('You’re getting this because you were asked to review it.')
    // escaped in the HTML
    expect(email.html).toContain('Shall we &lt;b&gt;drop&lt;/b&gt; passwords?')
    expect(email.html).not.toContain('<b>drop')
    expect(email.references).toBe('<id1@ideas.example.test>')
    expect(email.messageId).toMatch(/^<id1\.11\.u-maya@ideas\.example\.test>$/)
  })

  test('a suggested edit shows its change, struck through and underlined, with why', () => {
    const suggested = due()
    suggested.ideas[0]!.events = [
      {
        kind: 'suggestion',
        actor: { user: 'u-riley', bot: null, purpose: 'me' },
        at: 12,
        detail: { body: 'Clearer.', old: 'sign in quickly', new: 'sign in with a <passkey>' },
      },
    ]
    const email = notificationEmail(suggested, site)
    expect(email.text).toContain(
      'Riley (@riley) suggested an edit:\n- sign in quickly\n+ sign in with a <passkey>\n> Clearer.',
    )
    expect(email.html).toContain('>sign in quickly</del>')
    expect(email.html).toContain('>sign in with a &lt;passkey&gt;</ins>')
  })

  test('carries headers for mail rules, and a one-click unsubscribe for that idea', () => {
    const { headers } = notificationEmail(due(), site)
    expect(headers).toMatchObject({
      'X-Ideaf-Reason': 'review-requested',
      'X-Ideaf-Idea': 'mobile/idea/9',
      'X-Ideaf-Team': 'mobile',
      'List-Id': 'Mobile <mobile.teams.ideas.example.test>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    })
    const link = headers['List-Unsubscribe']!.slice(1, -1)
    expect(link.startsWith('https://ideas.example.test/unsubscribe?t=')).toBe(true)
    expect(readUnsubscribeToken(site.secret, new URL(link).searchParams.get('t')!)).toEqual({
      user: 'u-maya',
      scope: 'id1',
    })
  })

  test('a person’s own idea is listed under them', () => {
    const own = due({ ideas: [{ ...due().ideas[0]!, idea: listing({ team: null, teamInfo: null, place: '@riley' }) }] })
    const email = notificationEmail(own, site)
    expect(email.subject).toBe('[@riley] Faster sign-in (@riley/idea/9)')
    expect(email.headers['List-Id']).toBe('<riley.people.ideas.example.test>')
    expect(email.headers['X-Ideaf-Team']).toBeUndefined()
  })

  test('a digest lists every idea, newest first, and its unsubscribe stops all email', () => {
    const second = { ...due().ideas[0]!, idea: listing({ id: 'id2', title: 'Dark mode', number: 10 }), more: 0 }
    const email = notificationEmail(due({ digest: true, ideas: [second, due().ideas[0]!] }), site)
    expect(email.subject).toBe('Your daily digest: updates to 2 ideas')
    expect(email.text.indexOf('Dark mode')).toBeLessThan(email.text.indexOf('Faster sign-in'))
    expect(email.headers['X-Ideaf-Reason']).toBe('digest')
    const link = email.headers['List-Unsubscribe']!.slice(1, -1)
    expect(readUnsubscribeToken(site.secret, new URL(link).searchParams.get('t')!)).toEqual({
      user: 'u-maya',
      scope: '*',
    })
    expect(email.references).toBeUndefined()
  })

  const notice = (extra: Partial<NoticeInboxRow['notice']> = {}): NoticeInboxRow => ({
    kind: 'notice',
    id: 'ntabc123',
    notice: {
      kind: 'group-joined',
      team: { id: 't1', handle: 'mobile', name: 'Mobile' },
      group: { id: 'g1', handle: 'design-reviewers', name: 'Design reviewers' },
      role: 'member',
      as: 'group-admin',
      actor: { user: 'u-riley', bot: null, purpose: 'me' },
      ...extra,
    },
    reason: 'teams',
    newCount: 1,
    done: false,
    updatedAt: 20,
  })

  test('a notice about a team or a group: its own email, in the reader’s words, with what it means and where to see it', () => {
    const email = notificationEmail(due({ ideas: [], notices: [notice()] }), site)
    expect(email.subject).toBe('[Mobile] Design reviewers joined Mobile, as members')
    expect(email.text).toContain('Riley (@riley) added your group to Mobile.')
    expect(email.text).toContain('If it shouldn’t be there, you can take it out from the group’s page.')
    expect(email.text).toContain('Open the group: https://ideas.example.test/groups/design-reviewers')
    expect(email.text).toContain('You’re getting this because you’re an admin of Design reviewers.')
    expect(email.headers).toMatchObject({
      'X-Ideaf-Reason': 'teams',
      'X-Ideaf-Team': 'mobile',
      'X-Ideaf-Group': 'design-reviewers',
      'List-Id': 'Mobile <mobile.teams.ideas.example.test>',
    })
    expect(email.messageId).toBe('<ntabc123.u-maya@ideas.example.test>')
    // to a team's admin: the group by its name, and the team's groups
    const team = notificationEmail(due({ ideas: [], notices: [notice({ as: 'team-admin' })] }), site)
    expect(team.text).toContain('added Design reviewers to Mobile')
    expect(team.text).toContain('Open Mobile’s groups: https://ideas.example.test/mobile/settings?tab=groups')
    // about you, in a team that's gone since: named as it was, nowhere to link
    const gone = notificationEmail(
      due({
        ideas: [],
        notices: [
          notice({
            kind: 'removed',
            team: { id: 't9', handle: null, name: 'Old team' },
            group: null,
            role: null,
            as: 'you',
          }),
        ],
      }),
      site,
    )
    expect(gone.subject).toBe('[Old team] You’re no longer in Old team')
    expect(gone.text).toContain('You’re getting this because it’s about you.')
    expect(gone.html).not.toContain('Open the team')
  })

  test('a digest puts the notices first, and counts them apart from the ideas', () => {
    const email = notificationEmail(due({ digest: true, notices: [notice()] }), site)
    expect(email.subject).toBe('Your daily digest: updates to 1 idea and 1 change to your teams and groups')
    expect(email.text.indexOf('Design reviewers joined Mobile')).toBeLessThan(email.text.indexOf('Faster sign-in'))
  })
})

describe('unsubscribe links', () => {
  test('work only as signed, for the person and idea they name', () => {
    const token = unsubscribeToken(site.secret, { user: 'u-maya', scope: 'id1' })
    expect(readUnsubscribeToken(site.secret, token)).toEqual({ user: 'u-maya', scope: 'id1' })
    expect(readUnsubscribeToken('another-secret-0123456789abcdef-0123', token)).toBeNull()
    const [payload, signature] = token.split('.')
    const other = Buffer.from(JSON.stringify(['u-sam', 'id1'])).toString('base64url')
    expect(readUnsubscribeToken(site.secret, `${other}.${signature}`)).toBeNull()
    expect(readUnsubscribeToken(site.secret, `${payload}.`)).toBeNull()
    expect(readUnsubscribeToken(site.secret, 'nonsense')).toBeNull()
  })

  test('the page asks on GET, and does it on POST (as one-click unsubscribe does)', async () => {
    const calls: unknown[] = []
    const directory = {
      idea: async (id: string) => (id === 'id1' ? { title: 'Faster <sign-in>' } : null),
      setSubscription: async (...args: unknown[]) => calls.push(['subscription', ...args]),
      setNotificationSettings: async (...args: unknown[]) => calls.push(['settings', ...args]),
    }
    const url = (scope: string) =>
      `${site.baseURL}/unsubscribe?t=${unsubscribeToken(site.secret, { user: 'u-maya', scope })}`
    const asked = await unsubscribePage(new Request(url('id1')), site, directory)
    expect(asked.status).toBe(200)
    expect(await asked.text()).toContain('Unsubscribe from “Faster &lt;sign-in&gt;”?')
    expect(calls).toEqual([])
    const done = await unsubscribePage(
      new Request(url('id1'), { method: 'POST', body: 'List-Unsubscribe=One-Click' }),
      site,
      directory,
    )
    expect(await done.text()).toContain('You’re unsubscribed from')
    await unsubscribePage(new Request(url('*'), { method: 'POST' }), site, directory)
    expect(calls).toEqual([
      ['subscription', 'u-maya', 'id1', false],
      ['settings', 'u-maya', { email: 'off' }],
    ])
    const bad = await unsubscribePage(new Request(`${site.baseURL}/unsubscribe?t=x.y`), site, directory)
    expect(bad.status).toBe(400)
  })
})

let smtp: ReturnType<typeof fakeSmtp>
beforeAll(() => {
  smtp = fakeSmtp()
})
afterAll(() => smtp.stop())

describe('sending', () => {
  test('goes over SMTP from the notifications sender, with the headers and threading', async () => {
    const sender = emailSender({
      transport: { kind: 'smtp', url: smtp.url },
      from: 'Ideation Factory <notifications@example.test>',
    })
    await sender.send(notificationEmail(due(), site))
    const message = smtp.received.at(-1)!
    expect(message.from).toBe('notifications@example.test')
    expect(message.to).toEqual(['maya@example.test'])
    expect(message.data).toContain('X-Ideaf-Reason: review-requested')
    expect(message.data).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click')
    expect(message.data).toContain('References: <id1@ideas.example.test>')
    expect(message.data).toContain('In-Reply-To: <id1@ideas.example.test>')
  })

  test('which sender: email.notify_from, else email.from; the log in development; none in production without SMTP', () => {
    const notifications = (email: Record<string, unknown>, production = false) =>
      notificationEmailFrom(settingsFrom({ email }).email, production)
    expect(notifications({})?.sender).toBe(logSender)
    expect(notifications({}, true)).toBeNull()
    expect(notifications({ smtp_url: smtp.url, notifications: 'off' })).toBeNull()
    expect(() => notifications({ notifications: 'maybe' })).toThrow('on or off')
    expect(() => notifications({ notify_from: 'n@example.test' })).toThrow('email.smtp_url')
    expect(() => notifications({ smtp_url: smtp.url })).toThrow('email.notify_from')
    const smtpOne = notifications({ smtp_url: smtp.url, from: 's@example.test' })
    expect(smtpOne?.sender).not.toBe(logSender)
    expect(smtpOne?.timing.quietMs).toBe(5 * 60_000)
  })
})
