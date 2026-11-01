// Everything a command touches outside itself, so tests can run the cli in
// process: the directory, the environment, output, prompts, and how to reach
// the server.
import * as prompts from './prompts.ts'

export interface Io {
  cwd: string
  env: Record<string, string | undefined>
  out(text: string): void
  err(text: string): void
  /** True when a person is at a terminal: only then may a command prompt. */
  interactive: boolean
  // Prompts, only called when interactive. Each gives null (or false) if the person cancels.
  /** A line of text. */
  ask(question: string): Promise<string | null>
  /** Yes or no; no by default. */
  confirm(question: string): Promise<boolean>
  /** One of the options, by index. */
  choose(question: string, options: Array<{ label: string; hint?: string }>): Promise<number | null>
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
    ask: (question) => prompts.ask(question),
    confirm: (question) => prompts.confirm(question),
    choose: (question, options) => prompts.choose(question, options),
  }
}
