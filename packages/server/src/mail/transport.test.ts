// How email leaves: which transport the settings name, and that sendmail really gets the message
// (a stand-in sendmail that keeps its arguments and what it's given).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emailMailer } from '../auth/mail.ts'
import { emailSender } from './sender.ts'
import { emailTransportFromEnv } from './transport.ts'

let dir: string
let sendmail: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ideaf-sendmail-'))
  sendmail = join(dir, 'sendmail')
  writeFileSync(sendmail, `#!/bin/sh\necho "$@" >> "${dir}/args"\ncat >> "${dir}/messages"\n`)
  chmodSync(sendmail, 0o755)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('which transport', () => {
  test('SMTP when its URL is set, sendmail when asked for, otherwise none', () => {
    expect(emailTransportFromEnv({})).toBeNull()
    expect(emailTransportFromEnv({ IDEAF_EMAIL: 'log' })).toBeNull()
    expect(emailTransportFromEnv({ IDEAF_SMTP_URL: 'smtp://mail.example.test:587' })).toEqual({
      kind: 'smtp',
      url: 'smtp://mail.example.test:587',
    })
    expect(emailTransportFromEnv({ IDEAF_EMAIL: 'sendmail' })).toEqual({ kind: 'sendmail', path: '/usr/sbin/sendmail' })
    expect(emailTransportFromEnv({ IDEAF_EMAIL: 'sendmail', IDEAF_SENDMAIL: '/usr/bin/msmtp' })).toEqual({
      kind: 'sendmail',
      path: '/usr/bin/msmtp',
    })
  })

  test('refuses what it can’t use', () => {
    expect(() => emailTransportFromEnv({ IDEAF_EMAIL: 'smtp' })).toThrow('log or sendmail')
    expect(() => emailTransportFromEnv({ IDEAF_EMAIL: 'sendmail', IDEAF_SMTP_URL: 'smtp://m:587' })).toThrow('set one')
    expect(() => emailTransportFromEnv({ IDEAF_EMAIL: 'sendmail', IDEAF_SENDMAIL: 'sendmail' })).toThrow('full path')
    expect(() => emailTransportFromEnv({ IDEAF_SMTP_URL: 'mail.example.test' })).toThrow('smtps://')
  })
})

describe('through sendmail', () => {
  test('a sign-in code, and a notification, each handed to the command for its recipient', async () => {
    const transport = { kind: 'sendmail' as const, path: sendmail }
    await emailMailer({
      transport,
      from: 'Ideation Factory <sign-in@example.test>',
      siteURL: 'https://ideas.example.test',
    }).sendCode('maya@example.test', '482913', 'sign-in')
    await emailSender({ transport, from: 'Ideation Factory <notifications@example.test>' }).send({
      to: 'sam@example.test',
      subject: 'A review was requested',
      text: 'Please review.',
      html: '<p>Please review.</p>',
      headers: { 'X-Ideaf-Reason': 'review-requested' },
      messageId: '<n1@ideas.example.test>',
    })
    const args = readFileSync(join(dir, 'args'), 'utf8')
    const messages = readFileSync(join(dir, 'messages'), 'utf8')
    expect(args).toContain('maya@example.test')
    expect(args).toContain('sam@example.test')
    expect(messages).toContain('Subject: 482913 is your Ideation Factory sign-in code')
    expect(messages).toContain('From: Ideation Factory <notifications@example.test>')
    expect(messages).toContain('X-Ideaf-Reason: review-requested')
  })
})
