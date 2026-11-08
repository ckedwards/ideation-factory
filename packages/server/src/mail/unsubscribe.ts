// The unsubscribe links in notification emails: signed, so one works without
// signing in (mail clients' one-click unsubscribe can't sign in) but only for
// the person and idea it was made for. `*` stands for all email.
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface Unsubscribe {
  user: string
  /** An idea's ID, or `*`: turn email off. */
  scope: string
}

const mac = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(`unsubscribe:${payload}`).digest('base64url')

export function unsubscribeToken(secret: string, what: Unsubscribe): string {
  const payload = Buffer.from(JSON.stringify([what.user, what.scope])).toString('base64url')
  return `${payload}.${mac(secret, payload)}`
}

/** What a token unsubscribes from, or null when it isn't one we made. */
export function readUnsubscribeToken(secret: string, token: string): Unsubscribe | null {
  const [payload, signature, ...rest] = token.split('.')
  if (!payload || !signature || rest.length > 0) {
    return null
  }
  const expected = Buffer.from(mac(secret, payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string' && v)) {
      return { user: value[0] as string, scope: value[1] as string }
    }
  } catch {
    // not JSON: not ours
  }
  return null
}

export const unsubscribeURL = (baseURL: string, secret: string, what: Unsubscribe) =>
  `${baseURL}/unsubscribe?t=${unsubscribeToken(secret, what)}`

/** What the unsubscribe page needs of the directory. */
export interface UnsubscribeDirectory {
  idea(id: string): Promise<{ title: string } | null>
  setSubscription(user: string, idea: string, subscribed: boolean): Promise<unknown>
  setNotificationSettings(user: string, settings: { email: 'off' }): Promise<unknown>
}

const escape = (value: string) =>
  value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

const page = (status: number, body: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f}button{font:inherit;padding:.4rem .8rem}</style></head>
<body>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )

/**
 * /unsubscribe?t=…, from an email: GET asks first (so a link checker that
 * opens it changes nothing), POST does it, as a mail client's one-click
 * unsubscribe does (RFC 8058).
 */
export async function unsubscribePage(
  request: Request,
  site: { baseURL: string; secret: string },
  directory: UnsubscribeDirectory,
): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') ?? ''
  const what = readUnsubscribeToken(site.secret, token)
  if (!what || (request.method !== 'GET' && request.method !== 'POST')) {
    return page(
      400,
      '<p>This unsubscribe link isn’t valid. Change what you get by email in your <a href="/settings">settings</a>.</p>',
    )
  }
  const settings = `<a href="${escape(site.baseURL)}/settings">settings</a>`
  if (what.scope === '*') {
    if (request.method === 'GET') {
      return page(
        200,
        `<p>Stop all notification emails? Your inbox still shows everything.</p><form method="post"><button>Stop emails</button></form>`,
      )
    }
    await directory.setNotificationSettings(what.user, { email: 'off' })
    return page(200, `<p>Notification emails are off. Turn them back on in your ${settings}.</p>`)
  }
  const idea = await directory.idea(what.scope)
  const title = idea ? `“${escape(idea.title)}”` : 'this idea'
  if (request.method === 'GET') {
    return page(
      200,
      `<p>Unsubscribe from ${title}? You won’t hear about it any more, by email or in your inbox, unless someone asks you to review it.</p><form method="post"><button>Unsubscribe</button></form>`,
    )
  }
  if (idea) {
    await directory.setSubscription(what.user, what.scope, false)
  }
  return page(200, `<p>You’re unsubscribed from ${title}. Change what you get by email in your ${settings}.</p>`)
}
