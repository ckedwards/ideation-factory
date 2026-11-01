// Keeping a sign-in's tokens fresh, against a fake token endpoint.
import { expect, test } from 'bun:test'
import { memoryStore } from './credentials.ts'
import { accessToken, authorizeUrl, newAuthorization } from './oauth.ts'

const SERVER = 'http://localhost:4100'
const later = () => Date.now() + 10 * 60_000
const soon = () => Date.now() + 10_000

/** A token endpoint that answers each refresh with the next of these responses. */
function endpoint(...answers: Array<{ status: number; body: unknown }>) {
  const seen: URLSearchParams[] = []
  const send = async (request: Request) => {
    seen.push(new URLSearchParams(await request.text()))
    const answer = answers.shift()!
    return Response.json(answer.body, { status: answer.status })
  }
  return { send, seen }
}

test('a fresh access token is used as is; one about to expire is refreshed, and the new refresh token kept', async () => {
  const store = memoryStore()
  await store.set(SERVER, { accessToken: 'a1', refreshToken: 'r1', expiresAt: later() })
  const fake = endpoint({ status: 200, body: { access_token: 'a2', refresh_token: 'r2', expires_in: 900 } })
  expect(await accessToken(fake.send, SERVER, store)).toBe('a1')
  expect(fake.seen).toHaveLength(0)

  await store.set(SERVER, { accessToken: 'a1', refreshToken: 'r1', expiresAt: soon() })
  expect(await accessToken(fake.send, SERVER, store)).toBe('a2')
  expect(Object.fromEntries(fake.seen[0]!)).toMatchObject({
    grant_type: 'refresh_token',
    refresh_token: 'r1',
    client_id: 'ideaf-cli',
    resource: SERVER,
  })
  expect(await store.get(SERVER)).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' })
})

test('a refused refresh uses what another ideaf stored meanwhile, or else forgets the sign-in', async () => {
  const store = memoryStore()
  await store.set(SERVER, { accessToken: 'a1', refreshToken: 'r1', expiresAt: soon() })
  // another ideaf refreshed first: its tokens are in the store by the time ours is refused
  const raced = async () => {
    await store.set(SERVER, { accessToken: 'b2', refreshToken: 'b2r', expiresAt: later() })
    return Response.json({ error: 'invalid_grant' }, { status: 400 })
  }
  expect(await accessToken(raced, SERVER, store)).toBe('b2')

  await store.set(SERVER, { accessToken: 'a1', refreshToken: 'r1', expiresAt: soon() })
  const revoked = endpoint({ status: 400, body: { error: 'invalid_grant' } })
  await expect(accessToken(revoked.send, SERVER, store)).rejects.toThrow('ideaf auth login')
  expect(await store.get(SERVER)).toBeNull()
  // and no sign-in at all says so
  await expect(accessToken(revoked.send, SERVER, store)).rejects.toThrow('not signed in')
})

test('the authorize link asks for consent every time, with PKCE and the choices to start from', () => {
  const authorization = newAuthorization()
  const url = new URL(
    authorizeUrl(SERVER, 'http://127.0.0.1:5000/callback', authorization, {
      bot: 'planbot',
      teams: ['core', 'web'],
      ideas: [],
      outsideTeams: true,
      readOnly: true,
    }),
  )
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: 'ideaf-cli',
    code_challenge_method: 'S256',
    code_challenge: authorization.challenge,
    state: authorization.state,
    prompt: 'consent',
    resource: SERVER,
    ideaf_bot: 'planbot',
    ideaf_purpose: 'bot-for-me',
    ideaf_teams: 'core,web',
    ideaf_no_team: '1',
    ideaf_read_only: '1',
  })
  expect(url.searchParams.has('ideaf_ideas')).toBe(false)
})
