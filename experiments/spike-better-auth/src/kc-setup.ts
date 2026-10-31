// Sets up the test identity provider: a Keycloak realm "ideaf" with an OIDC
// client, a SAML client and a few people, through Keycloak's admin REST API.
// Recreates the realm each time. Keycloak itself runs in a container:
//
//   docker run -d --name ideaf-spike-kc -p 127.0.0.1:25447:8080 \
//     -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
//     quay.io/keycloak/keycloak:26.8.1 start-dev
//   bun src/kc-setup.ts [run]   (sso-flow.ts calls setupRealm itself)
import { BASE, KC_URL, OIDC_PROVIDER, SAML_PROVIDER } from './auth.ts'

export const SAML_SP_ENTITY = `${BASE}/saml/acme`
/** The test people for one run (emails carry the run, so re-runs don't collide). */
export const people = (run: string) => ({
  // alice has an account (email code) from before the switch
  alice: { username: `alice-${run}`, email: `alice-${run}@acme.test`, firstName: 'Alice', lastName: 'Archer' },
  bob: { username: `bob-${run}`, email: `bob-${run}@acme.test`, firstName: 'Bob', lastName: 'Baker' },
  carol: { username: `carol-${run}`, email: `carol.jones+${run}@acme.test`, firstName: 'Carol', lastName: 'Jones' },
  // dave's suggested handle is already taken by someone else
  dave: { username: `dave-${run}`, email: `dave-${run}@acme.test`, firstName: 'Dave', lastName: 'Diaz' },
  eve: { username: `eve-${run}`, email: `eve-${run}@elsewhere.test`, firstName: 'Eve', lastName: 'Outsider' },
  frank: { username: `frank-${run}`, email: `frank-${run}@acme.test`, firstName: 'Frank', lastName: 'Fisher' },
})
export const PASSWORD = 'spike-pass-1'

async function adminToken() {
  const r = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' }),
  })
  if (!r.ok) throw new Error(`admin token: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

export async function kcAdmin() {
  const token = await adminToken()
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${KC_URL}/admin${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    })
    if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`)
    const t = await r.text()
    return t ? JSON.parse(t) : null
  }
}

const attr = (name: string, property: string) => ({
  name,
  protocol: 'saml',
  protocolMapper: 'saml-user-property-mapper',
  config: { 'user.attribute': property, 'attribute.name': name, 'attribute.nameformat': 'Basic' },
})

export async function setupRealm(run: string) {
  const kc = await kcAdmin()
  await kc('DELETE', '/realms/ideaf')
  await kc('POST', '/realms', { realm: 'ideaf', enabled: true, sslRequired: 'none', ssoSessionIdleTimeout: 1800 })
  for (const p of Object.values(people(run)))
    await kc('POST', '/realms/ideaf/users', { ...p, enabled: true, emailVerified: true, credentials: [{ type: 'password', value: PASSWORD, temporary: false }] })

  await kc('POST', '/realms/ideaf/clients', {
    clientId: 'ideaf-oidc',
    protocol: 'openid-connect',
    publicClient: false,
    secret: process.env.OIDC_SECRET ?? 'spike-oidc-secret',
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    redirectUris: [`${BASE}/api/auth/sso/callback/${OIDC_PROVIDER}`],
    attributes: { 'pkce.code.challenge.method': 'S256' },
  })

  await kc('POST', '/realms/ideaf/clients', {
    clientId: SAML_SP_ENTITY,
    protocol: 'saml',
    enabled: true,
    frontchannelLogout: true,
    redirectUris: [`${BASE}/api/auth/sso/saml2/sp/acs/${SAML_PROVIDER}`],
    attributes: {
      'saml.assertion.signature': 'true',
      'saml.server.signature': 'true',
      'saml.client.signature': 'false',
      'saml.signature.algorithm': 'RSA_SHA256',
      'saml_force_name_id_format': 'true',
      'saml_name_id_format': 'persistent',
      'saml_assertion_consumer_url_post': `${BASE}/api/auth/sso/saml2/sp/acs/${SAML_PROVIDER}`,
    },
    protocolMappers: [attr('email', 'email'), attr('firstName', 'firstName'), attr('lastName', 'lastName')],
  })
  return kc
}

if (import.meta.main) {
  const run = process.argv[2] ?? Date.now().toString(36)
  await setupRealm(run)
  console.log(`realm ideaf ready (run ${run}): OIDC client ideaf-oidc, SAML client ${SAML_SP_ENTITY}`)
}
