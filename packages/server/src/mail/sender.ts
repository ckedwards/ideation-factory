// Sending notification emails: over the same SMTP settings as sign-in codes
// (auth/mail.ts), from their own sender so people and mail rules can sort
// them; the server log in development; a capture in tests.
import nodemailer from 'nodemailer'
import { EMAIL_TIMING, type EmailTiming } from '../directory/types.ts'

/** One email, ready to go. */
export interface Email {
  to: string
  subject: string
  text: string
  html: string
  /** Extra headers: what it's about (for filters), and how to unsubscribe. */
  headers: Record<string, string>
  messageId: string
  /** The thread it belongs to (an idea's emails thread together). */
  references?: string
}

export interface EmailSender {
  send(email: Email): Promise<void>
}

/** Notification emails, when the deployment sends them: how, and when they're due. */
export interface NotificationEmail {
  sender: EmailSender
  timing: EmailTiming
}

export function smtpSender(settings: { url: string; from: string }): EmailSender {
  const transport = nodemailer.createTransport({
    url: settings.url,
    // one connection for a run of emails, rather than one each
    pool: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  } as never)
  return {
    async send(email) {
      await transport.sendMail({
        from: settings.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        messageId: email.messageId,
        ...(email.references ? { inReplyTo: email.references, references: email.references } : {}),
      })
    },
  }
}

/** Development: a line in the server log per email. */
export const logSender: EmailSender = {
  async send(email) {
    console.log(`notification email to ${email.to}: ${email.subject}`)
  },
}

/** Tests: emails are kept. */
export class CapturingSender implements EmailSender {
  readonly sent: Email[] = []

  async send(email: Email): Promise<void> {
    this.sent.push(email)
  }

  /** The emails to this address so far. */
  to(address: string): Email[] {
    return this.sent.filter((e) => e.to.toLowerCase() === address.toLowerCase())
  }
}

/**
 * Notification emails go over IDEAF_SMTP_URL (as sign-in codes do), from
 * IDEAF_NOTIFY_FROM, or IDEAF_EMAIL_FROM without it. In development without
 * SMTP they go to the server log; in production without it there are none,
 * and nobody sees email settings. IDEAF_EMAIL_NOTIFICATIONS=off turns them
 * off with SMTP set (sign-in codes still go).
 */
export function notificationEmailFromEnv(env: Record<string, string | undefined>): NotificationEmail | null {
  const off = env.IDEAF_EMAIL_NOTIFICATIONS
  if (off !== undefined && off !== 'on' && off !== 'off') {
    throw new Error(`IDEAF_EMAIL_NOTIFICATIONS is on or off, not "${off}"`)
  }
  if (off === 'off') {
    return null
  }
  const url = env.IDEAF_SMTP_URL
  if (!url) {
    if (env.IDEAF_NOTIFY_FROM) {
      throw new Error('IDEAF_NOTIFY_FROM needs IDEAF_SMTP_URL, the server notification emails go through')
    }
    return env.NODE_ENV === 'production' ? null : { sender: logSender, timing: EMAIL_TIMING }
  }
  const from = env.IDEAF_NOTIFY_FROM || env.IDEAF_EMAIL_FROM
  if (!from) {
    throw new Error(
      'set IDEAF_NOTIFY_FROM, the sender of notification emails: "Ideation Factory <notifications@example.com>"',
    )
  }
  return { sender: smtpSender({ url, from }), timing: EMAIL_TIMING }
}
