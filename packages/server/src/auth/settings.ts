// Auth settings from the environment, and the mail senders for sign-in codes:
// SMTP in production, the server log in development, a capture in tests.
import { readFileSync } from 'node:fs'
import { findInvalidTrustedProxies } from '@better-auth/core/utils/ip'
import {
  type AuthSettings,
  type Mailer,
  PERSONAL_TOKEN_POLICIES,
  type PersonalTokenPolicy,
  type SsoSettings,
} from './config.ts'
import { emailTransportFromEnv } from '../mail/transport.ts'
import { emailMailer } from './mail.ts'

const DEV_SECRET = 'ideaf-development-secret-not-for-production-0123456789'

/**
 * IDEAF_URL is the deployment's public URL; IDEAF_AUTH_SECRET (at least 32
 * characters) signs cookies and encrypts signing keys, and is required in
 * production; IDEAF_SITE_ADMINS lists the site admins' emails, comma-separated;
 * IDEAF_PERSONAL_TOKENS is on, admins (the default) or off;
 * IDEAF_TRUSTED_PROXIES lists the reverse proxies in front of the app nodes
 * (IPs or CIDR ranges, comma-separated), whose X-Forwarded-For is believed;
 * IDEAF_MCP_CLIENT_HOSTS, if set, the only hosts MCP clients' metadata
 * documents may be on (comma-separated, like claude.ai,vscode.dev).
 * Single sign-on and SCIM are in ssoFromEnv below.
 */
export function authSettingsFromEnv(env: Record<string, string | undefined>, mailer: Mailer): AuthSettings {
  const secret = env.IDEAF_AUTH_SECRET
  if (!secret && env.NODE_ENV === 'production') {
    throw new Error('set IDEAF_AUTH_SECRET (at least 32 random characters) to run in production')
  }
  if (secret && secret.length < 32) {
    throw new Error('IDEAF_AUTH_SECRET must be at least 32 characters')
  }
  const personalTokens = (env.IDEAF_PERSONAL_TOKENS ?? 'admins') as PersonalTokenPolicy
  if (!PERSONAL_TOKEN_POLICIES.includes(personalTokens)) {
    throw new Error(`IDEAF_PERSONAL_TOKENS is on, admins or off, not "${personalTokens}"`)
  }
  return {
    baseURL: (env.IDEAF_URL ?? `http://localhost:${env.PORT ?? 8080}`).replace(/\/$/, ''),
    secret: secret ?? DEV_SECRET,
    siteAdmins: new Set(
      (env.IDEAF_SITE_ADMINS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
    mailer,
    personalTokens,
    trustedProxies: trustedProxiesFromEnv(env),
    sso: ssoFromEnv(env),
    scimToken: scimTokenFromEnv(env),
    mcp: { clientHosts: list(env.IDEAF_MCP_CLIENT_HOSTS).length ? list(env.IDEAF_MCP_CLIENT_HOSTS) : null },
  }
}

function trustedProxiesFromEnv(env: Record<string, string | undefined>): string[] {
  const proxies = (env.IDEAF_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const invalid = findInvalidTrustedProxies(proxies)
  if (invalid.length > 0) {
    throw new Error(`IDEAF_TRUSTED_PROXIES takes IP addresses and CIDR ranges, not: ${invalid.join(', ')}`)
  }
  return proxies
}

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)

/**
 * Single sign-on, off unless IDEAF_SSO is oidc or saml:
 * - IDEAF_SSO_NAME: shown as "Continue with <name>" (default "single sign-on");
 * - IDEAF_SSO_DOMAINS: the email domains that can sign in, comma-separated (required);
 * - IDEAF_SSO_AUTO_CREATE: on (the default) makes an account for someone new; off refuses them;
 * - OIDC: IDEAF_OIDC_ISSUER, IDEAF_OIDC_CLIENT_ID and IDEAF_OIDC_CLIENT_SECRET;
 * - SAML: IDEAF_SAML_METADATA, a file with the provider's metadata XML, and
 *   IDEAF_SAML_SP_KEY and IDEAF_SAML_SP_CERT, files with our key and
 *   certificate (PEM), for providers that want signed requests.
 */
export function ssoFromEnv(env: Record<string, string | undefined>): SsoSettings | null {
  const mode = env.IDEAF_SSO ?? 'off'
  if (mode === 'off') {
    return null
  }
  if (mode !== 'oidc' && mode !== 'saml') {
    throw new Error(`IDEAF_SSO is off, oidc or saml, not "${mode}"`)
  }
  const domains = list(env.IDEAF_SSO_DOMAINS)
  if (domains.length === 0) {
    throw new Error('set IDEAF_SSO_DOMAINS: the email domains that can sign in with single sign-on')
  }
  const autoCreate = env.IDEAF_SSO_AUTO_CREATE ?? 'on'
  if (autoCreate !== 'on' && autoCreate !== 'off') {
    throw new Error(`IDEAF_SSO_AUTO_CREATE is on or off, not "${autoCreate}"`)
  }
  const need = (name: string) => {
    const value = env[name]
    if (!value) {
      throw new Error(`set ${name} for IDEAF_SSO=${mode}`)
    }
    return value
  }
  const file = (name: string) => readFileSync(need(name), 'utf8')
  const base = { name: env.IDEAF_SSO_NAME || 'single sign-on', domains, autoCreate: autoCreate === 'on' }
  if (mode === 'oidc') {
    return {
      ...base,
      oidc: {
        issuer: need('IDEAF_OIDC_ISSUER').replace(/\/$/, ''),
        clientId: need('IDEAF_OIDC_CLIENT_ID'),
        clientSecret: need('IDEAF_OIDC_CLIENT_SECRET'),
      },
    }
  }
  if (Boolean(env.IDEAF_SAML_SP_KEY) !== Boolean(env.IDEAF_SAML_SP_CERT)) {
    throw new Error('set both IDEAF_SAML_SP_KEY and IDEAF_SAML_SP_CERT, or neither')
  }
  return {
    ...base,
    saml: {
      metadata: file('IDEAF_SAML_METADATA'),
      ...(env.IDEAF_SAML_SP_KEY
        ? { spPrivateKey: file('IDEAF_SAML_SP_KEY'), spCertificate: file('IDEAF_SAML_SP_CERT') }
        : {}),
    },
  }
}

/** IDEAF_SCIM_TOKEN: the identity provider's SCIM bearer token (at least 32 characters); SCIM is off without it. */
export function scimTokenFromEnv(env: Record<string, string | undefined>): string | null {
  const token = env.IDEAF_SCIM_TOKEN
  if (!token) {
    return null
  }
  if (token.length < 32) {
    throw new Error('IDEAF_SCIM_TOKEN must be at least 32 characters')
  }
  return token
}

/**
 * Where sign-in codes go:
 * - IDEAF_SMTP_URL and IDEAF_EMAIL_FROM: by email, over SMTP (see auth/mail.ts);
 * - IDEAF_EMAIL=sendmail and IDEAF_EMAIL_FROM: by email, through the host's sendmail
 *   (IDEAF_SENDMAIL, /usr/sbin/sendmail unless set; see mail/transport.ts);
 * - otherwise the server log, which production refuses unless IDEAF_EMAIL=log
 *   says so (a deployment behind single sign-on, say, where only site admins
 *   use codes and can read the log).
 */
export function mailerFromEnv(env: Record<string, string | undefined>): Mailer {
  const transport = emailTransportFromEnv(env)
  if (transport) {
    if (!env.IDEAF_EMAIL_FROM) {
      throw new Error('set IDEAF_EMAIL_FROM, the sender of sign-in codes: "Ideation Factory <sign-in@example.com>"')
    }
    return emailMailer({
      transport,
      from: env.IDEAF_EMAIL_FROM,
      siteURL: env.IDEAF_URL ?? `http://localhost:${env.PORT ?? 8080}`,
    })
  }
  if (env.NODE_ENV === 'production' && env.IDEAF_EMAIL !== 'log') {
    throw new Error(
      'set IDEAF_SMTP_URL (or IDEAF_EMAIL=sendmail) and IDEAF_EMAIL_FROM to send sign-in codes by email (or IDEAF_EMAIL=log to write them to the server log)',
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
