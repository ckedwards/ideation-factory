// Fake identity providers for tests, in process, on 127.0.0.1. Each signs in
// whoever the test says (`idp.as(person)`) without a login form, and otherwise
// behaves like a real one. OIDC: discovery, a JWKS, the authorization code flow
// with PKCE, signed ID tokens and userinfo. SAML 2.0 (with samlify, the library
// Better Auth uses): metadata, and a signed response to a redirect-binding
// request, posted back by the browser.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import * as samlify from 'samlify'

export type IdpPerson = { sub: string; email: string; name: string; emailVerified?: boolean }

type Pending = { person: IdpPerson; clientId: string; redirectUri: string; nonce?: string; challenge?: string }

export interface FakeOidcProvider {
  issuer: string
  clientId: string
  clientSecret: string
  /** Who the next sign-in is: the provider vouches for them. */
  as(person: IdpPerson): void
  stop(): void
}

export async function fakeOidcProvider(): Promise<FakeOidcProvider> {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  const clientId = 'ideaf-test'
  const clientSecret = randomBytes(16).toString('hex')
  const codes = new Map<string, Pending>()
  const tokens = new Map<string, IdpPerson>()
  let next: IdpPerson | null = null

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request): Promise<Response> => {
      const url = new URL(request.url)
      const issuer: string = `http://127.0.0.1:${server.port}`
      switch (url.pathname) {
        case '/.well-known/openid-configuration':
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            scopes_supported: ['openid', 'email', 'profile'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            code_challenge_methods_supported: ['S256'],
            grant_types_supported: ['authorization_code'],
          })
        case '/jwks':
          return Response.json({ keys: [jwk] })
        case '/authorize': {
          const q = url.searchParams
          if (q.get('client_id') !== clientId || !q.get('redirect_uri')) {
            return new Response('unknown client', { status: 400 })
          }
          if (!next) {
            return new Response('the test named no one to sign in', { status: 400 })
          }
          const code = randomBytes(16).toString('hex')
          codes.set(code, {
            person: next,
            clientId,
            redirectUri: q.get('redirect_uri')!,
            ...(q.get('nonce') ? { nonce: q.get('nonce')! } : {}),
            ...(q.get('code_challenge') ? { challenge: q.get('code_challenge')! } : {}),
          })
          next = null
          const back = new URL(q.get('redirect_uri')!)
          back.searchParams.set('code', code)
          if (q.get('state')) {
            back.searchParams.set('state', q.get('state')!)
          }
          back.searchParams.set('iss', issuer)
          return Response.redirect(back.toString(), 302)
        }
        case '/token': {
          const form = new URLSearchParams(await request.text())
          const basic = request.headers.get('authorization')?.match(/^Basic (.+)$/)?.[1]
          const [id, secret] = basic
            ? Buffer.from(basic, 'base64').toString().split(':').map(decodeURIComponent)
            : [form.get('client_id'), form.get('client_secret')]
          if (id !== clientId || secret !== clientSecret) {
            return Response.json({ error: 'invalid_client' }, { status: 401 })
          }
          const pending = codes.get(form.get('code') ?? '')
          codes.delete(form.get('code') ?? '')
          if (!pending || pending.redirectUri !== form.get('redirect_uri')) {
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          }
          if (pending.challenge) {
            const verifier = form.get('code_verifier') ?? ''
            if (createHash('sha256').update(verifier).digest('base64url') !== pending.challenge) {
              return Response.json({ error: 'invalid_grant', error_description: 'PKCE' }, { status: 400 })
            }
          }
          const { person } = pending
          const accessToken = randomBytes(16).toString('hex')
          tokens.set(accessToken, person)
          const idToken = await new SignJWT({
            email: person.email,
            email_verified: person.emailVerified ?? true,
            name: person.name,
            ...(pending.nonce ? { nonce: pending.nonce } : {}),
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
            .setIssuer(issuer)
            .setSubject(person.sub)
            .setAudience(clientId)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey)
          return Response.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken })
        }
        case '/userinfo': {
          const person = tokens.get(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')
          if (!person) {
            return new Response('unauthorized', { status: 401 })
          }
          return Response.json({
            sub: person.sub,
            email: person.email,
            email_verified: person.emailVerified ?? true,
            name: person.name,
          })
        }
      }
      return new Response('not found', { status: 404 })
    },
  })

  return {
    issuer: `http://127.0.0.1:${server.port}`,
    clientId,
    clientSecret,
    as: (person) => {
      next = person
    },
    stop: () => {
      void server.stop(true)
    },
  }
}

export interface FakeSamlProvider {
  /** The provider's metadata XML, for auth.sso.saml.metadata. */
  metadata: string
  /** Who the next sign-in is; `edit` changes the signed response, as an attacker might. */
  as(person: IdpPerson, edit?: (xml: string) => string): void
  /** Our metadata, so the provider knows where to send people back. */
  trust(spMetadata: string): void
  stop(): void
}

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const xmlEscape = (value: string) =>
  value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

export async function fakeSamlProvider(): Promise<FakeSamlProvider> {
  let next: { person: IdpPerson; edit?: (xml: string) => string } | null = null
  let sp: ReturnType<typeof samlify.ServiceProvider> | null = null
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/sso') {
        return new Response('not found', { status: 404 })
      }
      if (!sp || !next) {
        return new Response('the test named no one to sign in, or no service provider', { status: 400 })
      }
      const { person, edit } = next
      next = null
      const { extract } = await idp.parseLoginRequest(sp, 'redirect', {
        query: Object.fromEntries(url.searchParams),
      })
      const now = new Date()
      const later = new Date(now.getTime() + 5 * 60_000)
      // the binding's short name, not its URN
      const acs = sp.entityMeta.getAssertionConsumerService('post') as string
      const attribute = (name: string, value: string) =>
        `<saml:Attribute Name="${name}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic"><saml:AttributeValue xsi:type="xs:string">${xmlEscape(value)}</saml:AttributeValue></saml:Attribute>`
      const [first, ...rest] = person.name.split(' ')
      const id = `_${randomBytes(16).toString('hex')}`
      const response = await idp.createLoginResponse(
        sp,
        { extract },
        'post',
        { email: person.email },
        {
          relayState: url.searchParams.get('RelayState') ?? '',
          customTagReplacement: (template: string) => {
            const values: Record<string, string> = {
              ID: id,
              AssertionID: `_${randomBytes(16).toString('hex')}`,
              Destination: acs,
              Audience: sp!.entityMeta.getEntityID(),
              SubjectRecipient: acs,
              Issuer: idp.entityMeta.getEntityID(),
              IssueInstant: now.toISOString(),
              StatusCode: 'urn:oasis:names:tc:SAML:2.0:status:Success',
              ConditionsNotBefore: now.toISOString(),
              ConditionsNotOnOrAfter: later.toISOString(),
              SubjectConfirmationDataNotOnOrAfter: later.toISOString(),
              NameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
              NameID: person.sub,
              InResponseTo: (extract as { request?: { id?: string } }).request?.id ?? '',
            }
            let xml = template.replace(/\{(\w+)\}/g, (tag, name: string) =>
              name in values ? xmlEscape(values[name]!) : tag,
            )
            xml = xml
              .replace(
                '{AuthnStatement}',
                `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${id}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`,
              )
              .replace(
                '{AttributeStatement}',
                `<saml:AttributeStatement>${attribute('email', person.email)}${attribute('firstName', first ?? '')}${attribute('lastName', rest.join(' '))}</saml:AttributeStatement>`,
              )
            return { id, context: xml }
          },
        },
      )
      const signed = Buffer.from(response.context, 'base64').toString('utf8')
      const sent = Buffer.from(edit ? edit(signed) : signed).toString('base64')
      // the page a real provider shows: a form that posts itself to our assertion consumer service
      return new Response(
        `<!doctype html><form method="post" action="${xmlEscape(acs)}"><input type="hidden" name="SAMLResponse" value="${sent}"><input type="hidden" name="RelayState" value="${xmlEscape(url.searchParams.get('RelayState') ?? '')}"></form><script>document.forms[0].submit()</script>`,
        { headers: { 'content-type': 'text/html' } },
      )
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  const idp = samlify.IdentityProvider({
    entityID: `${base}/metadata`,
    privateKey: fixture('fake-idp-key.pem'),
    signingCert: fixture('fake-idp-cert.pem'),
    nameIDFormat: ['urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'],
    singleSignOnService: [{ Binding: samlify.Constants.namespace.binding.redirect, Location: `${base}/sso` }],
  })
  return {
    metadata: idp.getMetadata(),
    as: (person, edit) => {
      next = edit ? { person, edit } : { person }
    },
    trust: (spMetadata) => {
      sp = samlify.ServiceProvider({ metadata: spMetadata })
    },
    stop: () => {
      void server.stop(true)
    },
  }
}
