// For tests: just enough of an SMTP server, in process, to take messages and
// keep them (no TLS, no auth).
export type Received = { from: string; to: string[]; data: string }

/** Just enough SMTP to take messages: no TLS, no auth. */
export function fakeSmtp() {
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
