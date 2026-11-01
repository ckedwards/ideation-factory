// Auth settings from the environment, and the mail senders for sign-in codes.
// Real email delivery is still to come: until then a deployment logs codes.
import { type AuthSettings, type Mailer, PERSONAL_TOKEN_POLICIES, type PersonalTokenPolicy } from './config.ts'

const DEV_SECRET = 'ideaf-development-secret-not-for-production-0123456789'

/**
 * IDEAF_URL is the deployment's public URL; IDEAF_AUTH_SECRET (at least 32
 * characters) signs cookies and encrypts signing keys, and is required in
 * production; IDEAF_SITE_ADMINS lists the site admins' emails, comma-separated;
 * IDEAF_PERSONAL_TOKENS is on, admins (the default) or off.
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
  }
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
