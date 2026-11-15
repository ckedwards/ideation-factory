// How email leaves the server, for sign-in codes and notifications alike: over SMTP, to a mail
// provider or a company's relay (email.smtp_url), or through the host's own sendmail command
// (email.mode: sendmail), for a machine whose mail setup (Postfix, msmtp, a company relay) already
// delivers its mail. Neither: nothing is sent, and the caller decides (the log in development).
import nodemailer from 'nodemailer'
import type { Settings } from '../settings/schema.ts'

export type EmailTransport = { kind: 'smtp'; url: string } | { kind: 'sendmail'; path: string }

/** The transport the settings name, or null for none. Throws on a setting it can't use. */
export function emailTransportFrom(email: Settings['email']): EmailTransport | null {
  if (email.smtp_url && email.mode === 'sendmail') {
    throw new Error('email.smtp_url and email.mode: sendmail both name a way to send email: set one')
  }
  if (email.smtp_url) {
    if (!/^smtps?:\/\//.test(email.smtp_url)) {
      throw new Error('email.smtp_url is smtps://user:password@host:465 or smtp://user:password@host:587')
    }
    return { kind: 'smtp', url: email.smtp_url }
  }
  if (email.mode === 'sendmail') {
    if (!email.sendmail.startsWith('/')) {
      throw new Error(
        `email.sendmail is the sendmail command's full path, like /usr/sbin/sendmail, not "${email.sendmail}"`,
      )
    }
    return { kind: 'sendmail', path: email.sendmail }
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
