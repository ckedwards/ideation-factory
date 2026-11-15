// Sign-in codes by email, against a fake SMTP server in process, and which
// mailer the environment picks.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fakeSmtp } from '../mail/fake-smtp.ts'
import { emailMailer } from './mail.ts'
import { settingsFrom } from '../settings/load.ts'
import { logMailer, mailerFrom } from './settings.ts'

let smtp: ReturnType<typeof fakeSmtp>
beforeAll(() => {
  smtp = fakeSmtp()
})
afterAll(() => smtp.stop())

describe('sign-in codes by email', () => {
  test('go over SMTP, with the code in the subject and both bodies, and where it signs in to', async () => {
    const mailer = emailMailer({
      transport: { kind: 'smtp', url: smtp.url },
      from: 'Ideation Factory <sign-in@example.test>',
      siteURL: 'https://ideas.example.test',
    })
    await mailer.sendCode('maya@example.test', '482913', 'sign-in')
    const [message] = smtp.received
    expect(message!.from).toBe('sign-in@example.test')
    expect(message!.to).toEqual(['maya@example.test'])
    expect(message!.data).toContain('Subject: 482913 is your Ideation Factory sign-in code')
    expect(message!.data).toContain('From: Ideation Factory <sign-in@example.test>')
    expect(message!.data).toContain('text/plain')
    expect(message!.data).toContain('text/html')
    expect(message!.data).toContain('ideas.example.test')
    expect(message!.data.split('482913').length).toBeGreaterThanOrEqual(4)
  })

  test('a server that refuses or isn’t there is an error, not a silent loss', async () => {
    const nowhere = emailMailer({
      transport: { kind: 'smtp', url: 'smtp://127.0.0.1:1' },
      from: 'x@example.test',
      siteURL: 'https://x.test',
    })
    await expect(nowhere.sendCode('a@example.test', '111111', 'sign-in')).rejects.toThrow()
  })
})

describe('which mailer', () => {
  test('SMTP or sendmail when one is set (with a sender); the log in development, or in production only when asked for', () => {
    const mailer = (email: Record<string, unknown>, production = false) =>
      mailerFrom(settingsFrom({ email }), production)
    expect(mailer({})).toBe(logMailer)
    expect(mailer({ mode: 'log' }, true)).toBe(logMailer)
    expect(() => mailer({}, true)).toThrow('email.smtp_url')
    expect(() => mailer({ smtp_url: smtp.url })).toThrow('email.from')
    expect(() => mailer({ smtp_url: 'mail.example.test', from: 'x' })).toThrow('smtps://')
    expect(mailer({ smtp_url: smtp.url, from: 'x@example.test' })).not.toBe(logMailer)
    expect(mailer({ mode: 'sendmail', from: 'x@example.test' })).not.toBe(logMailer)
    expect(() => mailer({ mode: 'sendmail' })).toThrow('email.from')
  })
})
