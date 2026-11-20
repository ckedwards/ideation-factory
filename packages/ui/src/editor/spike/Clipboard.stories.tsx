// SPIKE: two files of an idea, each in an editor that keeps blocks' identities through the
// clipboard (identity.ts), and what each cut, copy, paste and drop did. Driven in Chromium, Firefox
// and WebKit by spike/run.mjs; tagged out of the test run.
import { useEffect, useRef, useState } from 'react'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { createSpikeEditor, onSpikeLog, type SpikeEditor, spikeLog } from './identity.ts'
import '../../document/MarkdownView.css'

const FILES: Record<string, string> = {
  a: `# Plan

The first paragraph, with a comment on it.

The second paragraph, which we move.

- one item
- two item
- three item

| Column | Other |
| --- | --- |
| a row | 1 |
| b row | 2 |

The last paragraph.
`,
  b: `# Notes

A paragraph in the other file.

Its last paragraph.
`,
}

declare global {
  interface Window {
    spike: { editors: Record<string, SpikeEditor>; log: typeof spikeLog }
    spikeProse: {
      TextSelection: typeof TextSelection
      NodeSelection: typeof NodeSelection
      CellSelection: typeof CellSelection
    }
  }
}

function File({ name }: { name: string }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let made: SpikeEditor | null = null
    let gone = false
    void createSpikeEditor(root.current!, name, FILES[name]!).then((editor) => {
      if (gone) {
        editor.destroy()
        return
      }
      made = editor
      window.spike.editors[name] = editor
    })
    return () => {
      gone = true
      made?.destroy()
    }
  }, [name])
  return (
    <section style={{ border: '1px solid var(--rule)', padding: '0 1rem' }} data-file={name}>
      <h2 style={{ fontFamily: 'var(--font-ui)', fontSize: '0.8rem' }}>{name}.md</h2>
      <div ref={root} />
    </section>
  )
}

function Page() {
  const [, setTick] = useState(0)
  useEffect(() => {
    window.spike = { editors: {}, log: spikeLog }
    // for run.mjs, to select as a person would
    window.spikeProse = { TextSelection, NodeSelection, CellSelection }
    return onSpikeLog(() => setTick((t) => t + 1))
  }, [])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      <File name="a" />
      <File name="b" />
      <pre data-testid="log" style={{ gridColumn: '1 / -1', fontSize: '0.7rem' }}>
        {spikeLog.map((e) => JSON.stringify(e)).join('\n')}
      </pre>
    </div>
  )
}

const meta = { title: 'Editor/Spike/Clipboard', component: Page, tags: ['!test'] } satisfies Meta<typeof Page>
export default meta
export const TwoFiles: StoryObj<typeof meta> = {}
