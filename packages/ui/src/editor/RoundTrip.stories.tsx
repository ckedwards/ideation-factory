// The editor's promise about Markdown, checked on this repository's own Markdown files:
//
// - a file opened and not edited comes back byte for byte;
// - every block, written afresh as if it had been edited, still means the same: core's parser reads
//   the same tree from it (it may be restyled, never changed).
//
// It runs in the browser with the other stories, on the real editor.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect, waitFor, within } from 'storybook/test'
import { createRichEditor } from './milkdown.ts'

const files = import.meta.glob<string>(
  [
    '../../../../*.md',
    '../../../../{docs,deploy,docker,experiments}/**/*.md',
    '../../../../packages/*/*.md',
    '../../../../packages/*/{src,reports}/**/*.md',
  ],
  { query: '?raw', import: 'default' },
)

interface Result {
  files: number
  untouched: number
  blocks: number
  identical: number
  restyled: number
  changed: string[]
}

/** A tree as it means: no positions, and a table row's cells past the header's dropped, as GFM drops them. */
function meaning(source: string): string {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk)
    }
    if (!node || typeof node !== 'object') {
      return node
    }
    const n = node as { type?: string; children?: Array<{ children?: unknown[] }> }
    if (n.type === 'table' && n.children?.[0]?.children) {
      const width = n.children[0].children.length
      n.children = n.children.map((row) => ({ ...row, children: (row.children ?? []).slice(0, width) }))
    }
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'position')
        .map(([key, value]) => [key, walk(value)]),
    )
  }
  return JSON.stringify(walk(markdownTree(source)))
}

async function check(only: RegExp): Promise<Result> {
  const result: Result = { files: 0, untouched: 0, blocks: 0, identical: 0, restyled: 0, changed: [] }
  const root = document.createElement('div')
  root.hidden = true
  document.body.append(root)
  for (const [path, load] of Object.entries(files)) {
    if (path.includes('/node_modules/') || !only.test(path)) {
      continue
    }
    const source = await load()
    const editor = await createRichEditor({
      root,
      source,
      flavor: 'full',
      label: path,
      onChange: () => {},
      onSelection: () => {},
      onLink: () => {},
      onContextMenu: () => {},
    })
    result.files++
    if (editor.markdown() === source) {
      result.untouched++
    } else {
      result.changed.push(`${path}: not the same unedited`)
    }
    for (const { source: block, written } of editor.rewritten()) {
      result.blocks++
      if (written === block) {
        result.identical++
      } else if (meaning(written) === meaning(block)) {
        result.restyled++
      } else {
        result.changed.push(`${path}: ${block.slice(0, 80)}`)
      }
    }
    editor.destroy()
    root.replaceChildren()
  }
  root.remove()
  return result
}

// the theme makes no difference here: it's checked in the light one only
const checked = !import.meta.env['STORYBOOK_THEME'] || import.meta.env['STORYBOOK_THEME'] === 'light'

function RoundTrip({ only }: { only: RegExp }) {
  const [result, setResult] = useState<Result | null>(null)
  useEffect(() => {
    if (checked) {
      void check(only).then(setResult)
    }
  }, [only])
  if (!checked) {
    return <p>Checked in the light theme.</p>
  }
  if (!result) {
    return <p>Checking…</p>
  }
  return (
    <div style={{ fontFamily: 'var(--font-ui)' }}>
      <dl data-testid="result">
        <dt>Files</dt>
        <dd data-testid="files">{result.files}</dd>
        <dt>Back byte for byte, unedited</dt>
        <dd data-testid="untouched">{result.untouched}</dd>
        <dt>Blocks</dt>
        <dd>{result.blocks}</dd>
        <dt>Written back identical</dt>
        <dd>{result.identical}</dd>
        <dt>Restyled only</dt>
        <dd>{result.restyled}</dd>
        <dt>Meaning changed</dt>
        <dd data-testid="changed">{result.changed.length}</dd>
      </dl>
      <ul>
        {result.changed.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  )
}

const meta = {
  title: 'Editor/Round trip',
  component: RoundTrip,
  // what's written back doesn't depend on the theme: checked once
  tags: ['one-theme'],
} satisfies Meta<typeof RoundTrip>

export default meta
type Story = StoryObj<typeof meta>

const play: Story['play'] = async ({ canvasElement }) => {
  if (!checked) {
    return
  }
  const canvas = within(canvasElement)
  const result = await waitFor(() => canvas.getByTestId('result'), { timeout: 28_000 })
  const count = Number(within(result).getByTestId('files').textContent)
  await expect(count).toBeGreaterThan(0)
  await expect(within(result).getByTestId('untouched')).toHaveTextContent(String(count))
  await expect(within(result).getByTestId('changed')).toHaveTextContent('0')
}

// in three parts, each well inside a test's time
export const TopAndDeploy: Story = {
  args: { only: /^(?:\.\.\/){4}(?:[^/]+\.md$|deploy\/|docker\/|experiments\/)/ },
  play,
}
export const Docs: Story = { args: { only: /\/docs\// }, play }
// the rest: the packages' own (Vite names a file near this one by its shortest path, so by elimination)
export const Packages: Story = {
  args: { only: /^(?!(?:\.\.\/){4}(?:[^/]+\.md$|deploy\/|docker\/|experiments\/|docs\/))/ },
  play,
}
