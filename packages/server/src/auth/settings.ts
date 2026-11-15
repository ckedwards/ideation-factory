// Auth settings from the server's settings (settings/schema.ts), and the mail senders for sign-in
// codes: SMTP in production, the server log in development, a capture in tests.
import { readFileSync } from 'node:fs'
import { findInvalidTrustedProxies } from '@better-auth/core/utils/ip'
import type { AuthSettings, Mailer, SsoSettings } from './config.ts'
import { emailTransportFrom } from '../mail/transport.ts'
import type { Settings } from '../settings/schema.ts'
import { emailMailer } from './mail.ts'

const DEV_SECRET = 'ideaf-development-secret-not-for-production-0123456789'

/** The deployment's public URL: url, or this process on localhost. */
export const siteURL = (settings: Settings) => (settings.url ?? `http://localhost:${settings.port}`).replace(/\/$/, '')

/**
 * auth.secret signs cookies and encrypts signing keys, and is required in production; site_admins
 * lists the site admins' emails; auth.personal_tokens is on, admins or off; trusted_proxies lists
 * the reverse proxies in front of the app nodes, whose X-Forwarded-For is believed; mcp.client_hosts,
 * if set, the only hosts MCP clients' metadata documents may be on. Single sign-on and SCIM are below.
 */
export function authSettingsFrom(settings: Settings, mailer: Mailer, production: boolean): AuthSettings {
  const { secret } = settings.auth
  if (!secret && production) {
    throw new Error('set auth.secret (at least 32 random characters) to run in production')
  }
  const invalid = findInvalidTrustedProxies(settings.trusted_proxies)
  if (invalid.length > 0) {
    throw new Error(`trusted_proxies takes IP addresses and CIDR ranges, not: ${invalid.join(', ')}`)
  }
  const hosts = settings.mcp.client_hosts.map((h) => h.toLowerCase())
  return {
    baseURL: siteURL(settings),
    secret: secret ?? DEV_SECRET,
    siteAdmins: new Set(settings.site_admins.map((e) => e.toLowerCase())),
    mailer,
    personalTokens: settings.auth.personal_tokens,
    trustedProxies: settings.trusted_proxies,
    sso: ssoFrom(settings.auth.sso),
    scimToken: settings.auth.scim_token ?? null,
    mcp: { clientHosts: hosts.length ? hosts : null },
  }
}

/**
 * Single sign-on, off unless auth.sso.mode is oidc or saml:
 * - name: shown as "Continue with <name>";
 * - domains: the email domains that can sign in (required);
 * - auto_create: on (the default) makes an account for someone new; off refuses them;
 * - OIDC: oidc.issuer, oidc.client_id and oidc.client_secret;
 * - SAML: saml.metadata, a file with the provider's metadata XML, and saml.sp_key and
 *   saml.sp_cert, files with our key and certificate (PEM), for providers that want signed requests.
 */
export function ssoFrom(sso: Settings['auth']['sso']): SsoSettings | null {
  if (sso.mode === 'off') {
    return null
  }
  if (sso.domains.length === 0) {
    throw new Error('set auth.sso.domains: the email domains that can sign in with single sign-on')
  }
  const base = {
    name: sso.name,
    domains: sso.domains.map((d) => d.toLowerCase()),
    autoCreate: sso.auto_create === 'on',
  }
  if (sso.mode === 'oidc') {
    const { issuer, client_id, client_secret } = sso.oidc
    if (!issuer || !client_id || !client_secret) {
      throw new Error('set auth.sso.oidc.issuer, client_id and client_secret for auth.sso.mode: oidc')
    }
    return { ...base, oidc: { issuer: issuer.replace(/\/$/, ''), clientId: client_id, clientSecret: client_secret } }
  }
  const { metadata, sp_key, sp_cert } = sso.saml
  if (!metadata) {
    throw new Error("set auth.sso.saml.metadata for auth.sso.mode: saml, a file with the provider's metadata XML")
  }
  if (Boolean(sp_key) !== Boolean(sp_cert)) {
    throw new Error('set both auth.sso.saml.sp_key and sp_cert, or neither')
  }
  const file = (path: string) => readFileSync(path, 'utf8')
  return {
    ...base,
    saml: {
      metadata: file(metadata),
      ...(sp_key && sp_cert ? { spPrivateKey: file(sp_key), spCertificate: file(sp_cert) } : {}),
    },
  }
}

/**
 * Where sign-in codes go:
 * - email.smtp_url and email.from: by email, over SMTP (see auth/mail.ts);
 * - email.mode: sendmail and email.from: by email, through the host's sendmail (email.sendmail;
 *   see mail/transport.ts);
 * - otherwise the server log, which production refuses unless email.mode: log says so (a
 *   deployment behind single sign-on, say, where only site admins use codes and can read the log).
 */
export function mailerFrom(settings: Settings, production: boolean): Mailer {
  const transport = emailTransportFrom(settings.email)
  if (transport) {
    if (!settings.email.from) {
      throw new Error('set email.from, the sender of sign-in codes: "Ideation Factory <sign-in@example.com>"')
    }
    return emailMailer({ transport, from: settings.email.from, siteURL: siteURL(settings) })
  }
  if (production && settings.email.mode !== 'log') {
    throw new Error(
      'set email.smtp_url (or email.mode: sendmail) and email.from to send sign-in codes by email (or email.mode: log to write them to the server log)',
    )
  }
  return logMailer
}

/** Development: the code goes to the server log. */
export const logMailer: Mailer = {
  async sendCode(email, code, kind) {
    console.log(`sign-in code for ${email} (${kind}): ${code}`)
  },
}

/** Tests: codes are kept, so a test can sign in as anyone. */
export class CapturingMailer implements Mailer {
  readonly #codes = new Map<string, string>()

  async sendCode(email: string, code: string): Promise<void> {
    this.#codes.set(email.toLowerCase(), code)
  }

  /** The last code sent to this address. */
  code(email: string): string {
    const code = this.#codes.get(email.toLowerCase())
    if (!code) {
      throw new Error(`no code was sent to ${email}`)
    }
    return code
  }
}
