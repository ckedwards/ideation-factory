// Everything a command touches outside itself, so tests can run the cli in
// process: the directory, the environment, output, prompts, and how to reach
// the server.
import { type CredentialStore, systemStore } from './credentials.ts'
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
  /** Where `ideaf auth login` keeps its tokens. */
  credentials(): Promise<CredentialStore>
  /** Opens a link in a browser on this machine; false where there's none to open (over SSH, say). */
  openBrowser(url: string): Promise<boolean>
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
    credentials: () => (store ??= systemStore(process.env)),
    openBrowser: (url) => openBrowser(url, process.env),
  }
}

let store: Promise<CredentialStore> | null = null

/** The system's way to open a link, unless this is a session with no browser of its own. */
async function openBrowser(url: string, env: Record<string, string | undefined>): Promise<boolean> {
  const remote = Boolean(env.SSH_CONNECTION || env.SSH_TTY)
  const display = process.platform !== 'linux' || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
  if (remote || !display) {
    return false
  }
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  try {
    const opened = Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' })
    return (await opened.exited) === 0
  } catch {
    return false
  }
}
