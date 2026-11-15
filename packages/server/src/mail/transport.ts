// How email leaves the server, for sign-in codes and notifications alike: over SMTP, to a mail
// provider or a company's relay (IDEAF_SMTP_URL), or through the host's own sendmail command
// (IDEAF_EMAIL=sendmail), for a machine whose mail setup (Postfix, msmtp, a company relay) already
// delivers its mail. Neither: nothing is sent, and the caller decides (the log in development).
import nodemailer from 'nodemailer'

export type EmailTransport = { kind: 'smtp'; url: string } | { kind: 'sendmail'; path: string }

const SENDMAIL = '/usr/sbin/sendmail'

/** The transport the settings name, or null for none. Throws on a setting it can't use. */
export function emailTransportFromEnv(env: Record<string, string | undefined>): EmailTransport | null {
  const mode = env.IDEAF_EMAIL
  if (mode !== undefined && mode !== '' && mode !== 'log' && mode !== 'sendmail') {
    throw new Error(`IDEAF_EMAIL is log or sendmail, not "${mode}"`)
  }
  const url = env.IDEAF_SMTP_URL
  if (url && mode === 'sendmail') {
    throw new Error('IDEAF_SMTP_URL and IDEAF_EMAIL=sendmail both name a way to send email: set one')
  }
  if (url) {
    if (!/^smtps?:\/\//.test(url)) {
      throw new Error('IDEAF_SMTP_URL is smtps://user:password@host:465 or smtp://user:password@host:587')
    }
    return { kind: 'smtp', url }
  }
  if (mode === 'sendmail') {
    const path = env.IDEAF_SENDMAIL || SENDMAIL
    if (!path.startsWith('/')) {
      throw new Error(`IDEAF_SENDMAIL is the sendmail command's full path, like ${SENDMAIL}, not "${path}"`)
    }
    return { kind: 'sendmail', path }
  }
  return null
}

/** A nodemailer transport for it: `pool` keeps one SMTP connection for a run of emails. */
export function createTransport(transport: EmailTransport, { pool = false } = {}) {
  if (transport.kind === 'sendmail') {
    return nodemailer.createTransport({ sendmail: true, newline: 'unix', path: transport.path })
  }
  return nodemailer.createTransport({
    url: transport.url,
    pool,
    // fail rather than leave someone waiting on the sign-in page
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  } as never)
}
