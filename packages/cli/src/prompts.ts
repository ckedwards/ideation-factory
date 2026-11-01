// The prompts a person at a terminal sees, on @clack/core's unstyled
// primitives: a line of text, yes or no, and a pick from a list with the arrow
// keys. Each gives null (or false) if the person cancels with Ctrl-C or Esc.
// Only used when io.interactive says a person is there.
import type { Readable, Writable } from 'node:stream'
import { styleText } from 'node:util'
import { ConfirmPrompt, isCancel, SelectPrompt, TextPrompt } from '@clack/core'

/** Where a prompt reads keys and draws (the terminal by default; tests pass streams). */
export type Streams = { input?: Readable; output?: Writable }

const dim = (text: string) => styleText('dim', text)
const bold = (text: string) => styleText('bold', text)
const accent = (text: string) => styleText('cyan', text)

/** The question, with what was answered once it's done, so the screen keeps a record. */
function heading(question: string, state: string, answer: string): string {
  if (state === 'submit') {
    return `${accent('◇')} ${question} ${dim(answer)}`
  }
  if (state === 'cancel') {
    return `${dim('■')} ${question} ${dim('cancelled')}`
  }
  return `${accent('◆')} ${bold(question)}`
}

export async function ask(question: string, streams: Streams = {}): Promise<string | null> {
  const value = await new TextPrompt({
    ...streams,
    render() {
      const done = this.state === 'submit' || this.state === 'cancel'
      const top = heading(question, this.state, this.value ?? '')
      return done ? top : `${top}\n${accent('│')} ${this.userInputWithCursor}`
    },
  }).prompt()
  return isCancel(value) || value === undefined ? null : value
}

export async function confirm(question: string, streams: Streams = {}): Promise<boolean> {
  const value = await new ConfirmPrompt({
    ...streams,
    active: 'Yes',
    inactive: 'No',
    initialValue: false,
    render() {
      const done = this.state === 'submit' || this.state === 'cancel'
      const top = heading(question, this.state, this.value ? 'Yes' : 'No')
      if (done) {
        return top
      }
      const choice = (label: string, on: boolean) => (on ? `${accent('●')} ${label}` : dim(`○ ${label}`))
      return `${top}\n${accent('│')} ${choice('Yes', this.value === true)} / ${choice('No', this.value !== true)}`
    },
  }).prompt()
  return value === true
}

export async function choose(
  question: string,
  options: Array<{ label: string; hint?: string }>,
  streams: Streams = {},
): Promise<number | null> {
  const value = await new SelectPrompt({
    ...streams,
    options: options.map((o, index) => ({ value: index, ...o })),
    render() {
      const done = this.state === 'submit' || this.state === 'cancel'
      const picked = options[this.cursor]
      const top = heading(question, this.state, picked?.label ?? '')
      if (done) {
        return top
      }
      const lines = this.options.map((o, i) => {
        const hint = o.hint ? ` ${dim(`(${o.hint})`)}` : ''
        return i === this.cursor
          ? `${accent('│')} ${accent('›')} ${o.label}${hint}`
          : `${accent('│')}   ${dim(o.label)}${hint}`
      })
      return [top, ...lines, dim('  ↑/↓ to move, enter to choose, esc to cancel')].join('\n')
    },
  }).prompt()
  return isCancel(value) || value === undefined ? null : value
}
