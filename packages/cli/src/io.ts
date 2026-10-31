// Everything a command touches outside itself, so tests can run the cli in
// process: the directory, the environment, output, and how to reach the server.
export interface Io {
  cwd: string
  env: Record<string, string | undefined>
  out(text: string): void
  err(text: string): void
  /** True when a person is at a terminal: only then may a command prompt. */
  interactive: boolean
  /** Asks a question at the terminal. Only called when interactive. */
  prompt(question: string): string | null
  /** How to send API requests (the global fetch, or the server's handler in tests). */
  fetch?: (request: Request) => Promise<Response>
}

export function processIo(): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: (question) => prompt(question),
  }
}
