// The terminal prompts, driven by keystrokes on a stream instead of a keyboard.
import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { ask, choose, confirm } from './prompts.ts'

/** A fake terminal: answers with these keystrokes, once the prompt is listening. */
function terminal(...keys: string[]) {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: () => void }
  input.isTTY = true
  input.setRawMode = () => {}
  const output = new PassThrough()
  let screen = ''
  output.on('data', (chunk) => {
    screen += String(chunk)
  })
  setTimeout(() => {
    for (const key of keys) {
      input.write(key)
    }
  }, 20)
  // ANSI escapes stripped, so tests read what a person sees
  return { input, output, screen: () => stripVTControlCharacters(screen) }
}

const DOWN = '\x1b[B'
const ENTER = '\r'
const ESC = '\x1b'

describe('prompts', () => {
  test('ask: what was typed', async () => {
    const t = terminal('O', 'f', 'f', ENTER)
    expect(await ask('Title', t)).toBe('Off')
    expect(t.screen()).toContain('Title')
  })

  test('confirm: no unless chosen', async () => {
    expect(await confirm('Move it?', terminal(ENTER))).toBe(false)
    expect(await confirm('Move it?', terminal('y'))).toBe(true)
  })

  test('choose: the option the arrow keys reached, or null on escape', async () => {
    const options = [{ label: 'Plan alpha' }, { label: 'Plan beta', hint: 'on feat-b' }]
    const t = terminal(DOWN, ENTER)
    expect(await choose('Which idea?', options, t)).toBe(1)
    expect(t.screen()).toContain('(on feat-b)')
    expect(await choose('Which idea?', options, terminal(ESC))).toBeNull()
  })
})
