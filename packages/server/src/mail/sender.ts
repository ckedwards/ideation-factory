// Sending notification emails: over the same SMTP settings as sign-in codes
// (auth/mail.ts), from their own sender so people and mail rules can sort
// them; the server log in development; a capture in tests.
import { createTransport, type EmailTransport, emailTransportFrom } from './transport.ts'
import type { Settings } from '../settings/schema.ts'
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

export function emailSender(settings: { transport: EmailTransport; from: string }): EmailSender {
  // one SMTP connection for a run of emails, rather than one each
  const transport = createTransport(settings.transport, { pool: true })
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
 * Notification emails go the way sign-in codes do (email.smtp_url, or the host's sendmail with
 * email.mode: sendmail: mail/transport.ts), from email.notify_from, or email.from without it. In
 * development without either they go to the server log; in production there are none, and nobody
 * sees email settings. email.notifications: off turns them off (sign-in codes still go).
 */
export function notificationEmailFrom(email: Settings['email'], production: boolean): NotificationEmail | null {
  if (email.notifications === 'off') {
    return null
  }
  const transport = emailTransportFrom(email)
  if (!transport) {
    if (email.notify_from) {
      throw new Error('email.notify_from needs email.smtp_url or email.mode: sendmail, the way notification emails go')
    }
    return production ? null : { sender: logSender, timing: EMAIL_TIMING }
  }
  const from = email.notify_from || email.from
  if (!from) {
    throw new Error(
      'set email.notify_from, the sender of notification emails: "Ideation Factory <notifications@example.com>"',
    )
  }
  return { sender: emailSender({ transport, from }), timing: EMAIL_TIMING }
}
