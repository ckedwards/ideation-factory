// Sign-in codes by email, over SMTP (nodemailer), so any provider works:
// Amazon SES, Postmark, Mailgun, Resend, Google Workspace, or a server of your
// own; or through the host's sendmail command (mail/transport.ts). See
// mailerFromEnv in settings.ts for the settings.
import { createTransport, type EmailTransport } from '../mail/transport.ts'
import type { Mailer } from './config.ts'

export interface EmailSettings {
  /** How the email leaves: SMTP, or the host's sendmail. */
  transport: EmailTransport
  /** The sender: "Ideation Factory <sign-in@example.com>". */
  from: string
  /** The deployment's URL, named in the message so people know where the code is for. */
  siteURL: string
}

export function emailMailer(settings: EmailSettings): Mailer {
  const transport = createTransport(settings.transport)
  return {
    async sendCode(email, code) {
      await transport.sendMail({ from: settings.from, to: email, ...signInEmail(code, settings.siteURL) })
    },
  }
}

/** The message: the code up front (in the subject too, so it shows in a notification), what it's for, and when to ignore it. */
export function signInEmail(code: string, siteURL: string): { subject: string; text: string; html: string } {
  const site = new URL(siteURL).host
  const escape = (value: string) =>
    value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
  return {
    subject: `${code} is your Ideation Factory sign-in code`,
    text: [
      `Your code for signing in to Ideation Factory at ${site}:`,
      '',
      `    ${code}`,
      '',
      'It works once, for 10 minutes.',
      '',
      "If you didn't try to sign in, ignore this email: nobody can sign in without the code.",
      '',
    ].join('\n'),
    html: `<!doctype html><html><body style="font:16px/1.5 system-ui,sans-serif;color:#1d1d1f">
<p>Your code for signing in to Ideation Factory at ${escape(site)}:</p>
<p style="font-size:28px;font-weight:600;letter-spacing:4px">${escape(code)}</p>
<p>It works once, for 10 minutes.</p>
<p style="color:#666">If you didn't try to sign in, ignore this email: nobody can sign in without the code.</p>
</body></html>`,
  }
}
