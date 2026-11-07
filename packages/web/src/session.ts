// Signing in, as the browser does it. Sign-in (the server's /login page, for
// now) leaves a session cookie; the API takes a 15-minute token, which the
// session gives on request. It's fetched once, kept until a minute before it
// runs out, and shared by every call made meanwhile.

/** Thrown when there's no session: the person needs to sign in. */
export class SignedOut extends Error {
  constructor() {
    super('not signed in')
    this.name = 'SignedOut'
  }
}

let current: { token: string; expires: number } | null = null
let pending: Promise<string> | null = null

/** A current token for the API, from the session. */
export function accessToken(): Promise<string> {
  if (current && current.expires - 60_000 > Date.now()) {
    return Promise.resolve(current.token)
  }
  pending ??= (async () => {
    try {
      const response = await fetch('/api/auth/token', { credentials: 'same-origin' })
      if (response.status === 401) {
        throw new SignedOut()
      }
      if (!response.ok) {
        throw new Error(`couldn't get a token for the API (${response.status})`)
      }
      const { token } = (await response.json()) as { token: string }
      current = { token, expires: expiryOf(token) }
      return token
    } finally {
      pending = null
    }
  })()
  return pending
}

/** To the sign-in page, which comes back to this page once signed in. */
export function signIn(): never {
  current = null
  window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
  // nothing more happens on this page
  throw new SignedOut()
}

/** Ends the session, then to the sign-in page. */
export async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' })
  current = null
  window.location.assign('/login')
}

/** When a token runs out: its `exp`, in milliseconds. */
function expiryOf(token: string): number {
  const payload = token.split('.')[1] ?? ''
  const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
  return (exp ?? 0) * 1000
}
