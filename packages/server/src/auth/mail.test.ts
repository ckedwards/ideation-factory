// Sign-in codes by email, against a fake SMTP server in process, and which
// mailer the environment picks.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { smtpMailer } from './mail.ts'
import { logMailer, mailerFromEnv } from './settings.ts'

type Received = { from: string; to: string[]; data: string }

/** Just enough SMTP to take messages: no TLS, no auth. */
function fakeSmtp() {
  const received: Received[] = []
  type State = { buffer: string; inData: boolean; from: string; to: string[]; data: string }
  const server = Bun.listen<State>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: '', inData: false, from: '', to: [], data: '' }
        socket.write('220 fake ESMTP\r\n')
      },
      data(socket, chunk) {
        const state = socket.data
        state.buffer += chunk.toString()
        for (;;) {
          if (state.inData) {
            const end = state.buffer.indexOf('\r\n.\r\n')
            if (end < 0) {
              return
            }
            received.push({ from: state.from, to: state.to, data: state.buffer.slice(0, end) })
            state.buffer = state.buffer.slice(end + 5)
            state.inData = false
            state.to = []
            socket.write('250 queued\r\n')
            continue
          }
          const end = state.buffer.indexOf('\r\n')
          if (end < 0) {
            return
          }
          const line = state.buffer.slice(0, end)
          state.buffer = state.buffer.slice(end + 2)
          const verb = line.slice(0, 4).toUpperCase()
          if (verb === 'EHLO' || verb === 'HELO') {
            socket.write('250-fake\r\n250 8BITMIME\r\n')
          } else if (verb === 'MAIL') {
            state.from = line.match(/<([^>]*)>/)?.[1] ?? ''
            socket.write('250 ok\r\n')
          } else if (verb === 'RCPT') {
            state.to.push(line.match(/<([^>]*)>/)?.[1] ?? '')
            socket.write('250 ok\r\n')
          } else if (verb === 'DATA') {
            state.inData = true
            socket.write('354 go on\r\n')
          } else if (verb === 'QUIT') {
            socket.write('221 bye\r\n')
            socket.end()
            return
          } else {
            socket.write('250 ok\r\n')
          }
        }
      },
    },
  })
  return { url: `smtp://127.0.0.1:${server.port}`, received, stop: () => server.stop(true) }
}

let smtp: ReturnType<typeof fakeSmtp>
beforeAll(() => {
  smtp = fakeSmtp()
})
afterAll(() => smtp.stop())

describe('sign-in codes by email', () => {
  test('go over SMTP, with the code in the subject and both bodies, and where it signs in to', async () => {
    const mailer = smtpMailer({
      url: smtp.url,
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
    const nowhere = smtpMailer({ url: 'smtp://127.0.0.1:1', from: 'x@example.test', siteURL: 'https://x.test' })
    await expect(nowhere.sendCode('a@example.test', '111111', 'sign-in')).rejects.toThrow()
  })
})

describe('which mailer', () => {
  test('SMTP when it’s set (with a sender); the log in development, or in production only when asked for', () => {
    expect(mailerFromEnv({})).toBe(logMailer)
    expect(mailerFromEnv({ NODE_ENV: 'production', IDEAF_EMAIL: 'log' })).toBe(logMailer)
    expect(() => mailerFromEnv({ NODE_ENV: 'production' })).toThrow('IDEAF_SMTP_URL')
    expect(() => mailerFromEnv({ IDEAF_SMTP_URL: smtp.url })).toThrow('IDEAF_EMAIL_FROM')
    expect(() => mailerFromEnv({ IDEAF_SMTP_URL: 'mail.example.test', IDEAF_EMAIL_FROM: 'x' })).toThrow('smtps://')
    expect(mailerFromEnv({ IDEAF_SMTP_URL: smtp.url, IDEAF_EMAIL_FROM: 'x@example.test' })).not.toBe(logMailer)
  })
})
