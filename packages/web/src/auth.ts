// Your account, as sign-in (Better Auth, at /api/auth) keeps it: your name
// and handle, where you're signed in, your passkeys, and the tokens and apps
// that act for you. These go to sign-in directly, with the session's cookie,
// as the sign-in page does; the API is for ideas, teams and people.

/** What sign-in said went wrong. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = (await response.json().catch(() => null)) as (T & { message?: string; code?: string }) | null
  if (!response.ok) {
    throw new AuthError(data?.message ?? `sign-in refused that (${response.status})`, data?.code, response.status)
  }
  return data as T
}

export interface Session {
  id: string
  token: string
  createdAt: string
  expiresAt: string
  userAgent?: string | null
  ipAddress?: string | null
}

export interface Passkey {
  id: string
  name?: string | null
  createdAt: string
  deviceType?: string
}

export interface PersonalToken {
  id: string
  name?: string | null
  start?: string | null
  createdAt: string
  expiresAt?: string | null
}

export interface Consent {
  id: string
  clientId: string
  scopes: string[] | string
  createdAt: string
}

export const account = {
  /** Your name or handle; a new handle keeps the old one leading to you. */
  update: (changes: { name?: string; username?: string }) => call<{ status: boolean }>('/update-user', changes),
  handleFree: (username: string) =>
    call<{ available: boolean }>('/is-username-available', { username }).then((r) => r.available),
  sessions: () => call<Session[]>('/list-sessions'),
  signOut: (token: string) => call('/revoke-session', { token }),
  signOutElsewhere: () => call('/revoke-other-sessions', {}),
  passkeys: () => call<Passkey[]>('/passkey/list-user-passkeys'),
  removePasskey: (id: string) => call('/passkey/delete-passkey', { id }),
  /** A passkey for this device: the browser asks for it, and sign-in keeps its public key. */
  addPasskey: async (name: string) => {
    const options = await call<PublicKeyCredentialCreationOptionsJSON>('/passkey/generate-register-options')
    if (!('parseCreationOptionsFromJSON' in PublicKeyCredential)) {
      throw new AuthError('this browser can’t make passkeys', undefined, 0)
    }
    const credential = (await navigator.credentials.create({
      publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
    })) as PublicKeyCredential | null
    if (!credential) {
      throw new AuthError('no passkey was made', undefined, 0)
    }
    return call('/passkey/verify-registration', { response: credential.toJSON(), name })
  },
  tokens: () => call<{ apiKeys: PersonalToken[] }>('/api-key/list').then((r) => r.apiKeys),
  revokeToken: (keyId: string) => call('/api-key/delete', { keyId }),
  consents: () => call<Consent[]>('/oauth2/get-consents'),
  revokeConsent: (id: string) => call('/oauth2/delete-consent', { id }),
}
