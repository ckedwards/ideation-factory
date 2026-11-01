// The cli's side of OAuth: the authorization code flow with PKCE, as the
// public client `ideaf-cli`, and keeping its tokens fresh. The server's side
// is Better Auth (packages/server/src/auth/config.ts).
import { createHash, randomBytes } from 'node:crypto'
import { CliError, EXIT } from './errors.ts'
import type { CredentialStore, Credentials } from './credentials.ts'

export const CLI_CLIENT_ID = 'ideaf-cli'
/** The server page that shows the code to paste, for a cli that can't listen on localhost. */
export const CLI_CODE_PATH = '/cli/code'
/** Refresh this long before the access token expires. */
const REFRESH_EARLY_MS = 60_000

type Send = (request: Request) => Promise<Response>

/** What the person asked for on the command line: the consent page starts from these. */
export interface LoginChoices {
  bot?: string
  /** bot-for-me unless they asked for a bot of its own. */
  botOfItsOwn?: boolean
  teams: string[]
  ideas: string[]
  outsideTeams: boolean
  readOnly: boolean
}

const base64url = (bytes: Buffer) => bytes.toString('base64url')

/** A PKCE pair (S256) and a state: only this ideaf can use the code it asks for. */
export function newAuthorization() {
  const verifier = base64url(randomBytes(32))
  return {
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
    state: base64url(randomBytes(16)),
  }
}

export function authorizeUrl(
  server: string,
  redirect: string,
  authorization: { challenge: string; state: string },
  choices: LoginChoices,
): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLI_CLIENT_ID,
    redirect_uri: redirect,
    scope: 'offline_access',
    state: authorization.state,
    code_challenge: authorization.challenge,
    code_challenge_method: 'S256',
    resource: server,
    // the purpose and limits are chosen every time, never reused
    prompt: 'consent',
    ...(choices.bot ? { ideaf_bot: choices.bot, ideaf_purpose: choices.botOfItsOwn ? 'bot' : 'bot-for-me' } : {}),
    ...(choices.teams.length ? { ideaf_teams: choices.teams.join(',') } : {}),
    ...(choices.ideas.length ? { ideaf_ideas: choices.ideas.join(',') } : {}),
    ...(choices.outsideTeams ? { ideaf_no_team: '1' } : {}),
    ...(choices.readOnly ? { ideaf_read_only: '1' } : {}),
  })
  return `${server}/api/auth/oauth2/authorize?${query}`
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number }

async function tokenRequest(
  send: Send,
  server: string,
  form: Record<string, string>,
): Promise<{ ok: true; value: TokenResponse } | { ok: false; status: number; error: string }> {
  let response: Response
  try {
    response = await send(
      new Request(`${server}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLI_CLIENT_ID, resource: server, ...form }),
      }),
    )
  } catch (error) {
    throw new CliError(`couldn't reach ${server}: ${(error as Error).message}`, EXIT.unreachable, 'timed_out')
  }
  const body = (await response.json().catch(() => null)) as
    | (TokenResponse & { error?: string; error_description?: string })
    | null
  if (!response.ok || !body?.access_token) {
    return {
      ok: false,
      status: response.status,
      error: body?.error_description ?? body?.error ?? `HTTP ${response.status}`,
    }
  }
  return { ok: true, value: body }
}

const toCredentials = (t: TokenResponse, previous?: Credentials): Credentials => ({
  accessToken: t.access_token,
  // rotated on every refresh; keep the old one only if the server didn't send a new one
  refreshToken: t.refresh_token ?? previous?.refreshToken ?? '',
  expiresAt: Date.now() + t.expires_in * 1000,
})

export async function exchangeCode(
  send: Send,
  server: string,
  grant: { code: string; redirect: string; verifier: string },
): Promise<Credentials> {
  const result = await tokenRequest(send, server, {
    grant_type: 'authorization_code',
    code: grant.code,
    redirect_uri: grant.redirect,
    code_verifier: grant.verifier,
  })
  if (!result.ok) {
    throw new CliError(`signing in failed: ${result.error}`, EXIT.unauthorized, 'unauthorized')
  }
  if (!result.value.refresh_token) {
    throw new CliError('signing in failed: the server sent no refresh token', EXIT.error, 'error')
  }
  return toCredentials(result.value)
}

const signedOut = (server: string) =>
  new CliError(
    `not signed in to ${server}: run \`ideaf auth login\` (or, in CI, set IDEAF_TOKEN)`,
    EXIT.unauthorized,
    'unauthorized',
  )

/**
 * A current access token from the stored sign-in, refreshing it when it's
 * about to expire. Two ideafs refreshing at once is fine: the server answers a
 * refresh token reused within 30 seconds with the same new tokens, and one
 * refused here is retried with whatever the other one stored.
 */
export async function accessToken(send: Send, server: string, store: CredentialStore): Promise<string> {
  const stored = await store.get(server)
  if (!stored) {
    throw signedOut(server)
  }
  if (stored.expiresAt - Date.now() > REFRESH_EARLY_MS) {
    return stored.accessToken
  }
  const refreshed = await tokenRequest(send, server, {
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
  })
  if (refreshed.ok) {
    const credentials = toCredentials(refreshed.value, stored)
    await store.set(server, credentials)
    return credentials.accessToken
  }
  if (refreshed.status >= 500) {
    throw new CliError(`couldn't refresh the sign-in: ${refreshed.error}`, EXIT.error, 'error')
  }
  // perhaps another ideaf refreshed first and stored newer tokens
  const now = await store.get(server)
  if (now && now.refreshToken !== stored.refreshToken && now.expiresAt - Date.now() > REFRESH_EARLY_MS) {
    return now.accessToken
  }
  await store.delete(server)
  throw new CliError(
    `your sign-in to ${server} ended (it was signed out, revoked or expired): run \`ideaf auth login\``,
    EXIT.unauthorized,
    'unauthorized',
  )
}
