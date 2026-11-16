// A file of the idea's draft: each block as the draft has it, with Edit, Add
// below and Delete. Editing opens the block's Markdown where it is; a heading
// edits its title. Blocks the draft changed, and new ones, are marked. Each
// change goes to the draft as it's made (editing.tsx).
import { useState } from 'react'
import { type DraftUnit, markdownTree } from '@ideaf/core'
import { Button, MarkdownView, renderMermaid, TextArea } from '@ideaf/ui'
import './IdeaEditor.css'

export interface IdeaEditorProps {
  units: DraftUnit[]
  /** A block's new source; a heading's new title. */
  onEdit: (unit: DraftUnit, text: string) => void
  onAdd: (unit: DraftUnit, markdown: string) => void
  onDelete: (unit: DraftUnit) => void
}

type Form = { id: string; mode: 'edit' | 'add'; text: string }

export function IdeaEditor({ units, onEdit, onAdd, onDelete }: IdeaEditorProps) {
  const [form, setForm] = useState<Form | null>(null)
  const close = () => setForm(null)
  if (units.length === 0) {
    return <p className="idea-editor-empty">This file is empty.</p>
  }
  return (
    <div className="idea-editor">
      {units.map((unit) => {
        const open = form?.id === unit.id ? form : null
        const heading = unit.kind === 'heading'
        const state = unit.origin.kind === 'new' ? 'is-new' : unit.origin.changed ? 'is-edited' : ''
        const save = () => {
          if (open?.mode === 'edit') {
            onEdit(unit, open.text)
          } else if (open?.text.trim()) {
            onAdd(unit, open.text)
          }
          close()
        }
        const set = (text: string) => open && setForm({ ...open, text })
        return (
          <div key={unit.id} className={`idea-editor-unit ${state}`}>
            {open?.mode === 'edit' ? (
              <form
                className="idea-editor-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  save()
                }}
              >
                <TextArea
                  autoFocus
                  ref={grow}
                  className={heading ? 'idea-editor-title' : `idea-editor-source${code(open.text) ? ' is-code' : ''}`}
                  rows={heading ? 1 : 3}
                  value={open.text}
                  aria-label={heading ? 'Heading' : 'Markdown'}
                  onChange={(text) => {
                    set(text)
                    grow(document.activeElement as HTMLTextAreaElement | null)
                  }}
                  onSubmit={save}
                  onCancel={close}
                />
                <div className="idea-editor-buttons">
                  <span className="idea-editor-hint">⌘↵ to save to the draft · Esc to cancel</span>
                  <Button size="sm" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" type="submit">
                    Save to draft
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="idea-editor-view">
                  <MarkdownView tree={markdownTree(unit.source)} renderCode={renderMermaid} />
                </div>
                <div className="idea-editor-actions" role="group" aria-label={heading ? 'This heading' : 'This block'}>
                  {unit.origin.kind === 'new' && <span className="idea-editor-tag">New</span>}
                  {unit.origin.kind === 'base' && unit.origin.changed && (
                    <span className="idea-editor-tag">Changed</span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setForm({ id: unit.id, mode: 'edit', text: heading ? title(unit.source) : unit.source })
                    }
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setForm({ id: unit.id, mode: 'add', text: '' })}>
                    Add below
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(unit)}>
                    {heading ? 'Delete section' : 'Delete'}
                  </Button>
                </div>
              </>
            )}
            {open?.mode === 'add' && (
              <form
                className="idea-editor-form is-adding"
                onSubmit={(event) => {
                  event.preventDefault()
                  save()
                }}
              >
                <TextArea
                  autoFocus
                  ref={grow}
                  className={`idea-editor-source${code(open.text) ? ' is-code' : ''}`}
                  rows={3}
                  value={open.text}
                  placeholder="Markdown: a paragraph, a list, a ## heading…"
                  aria-label="New text"
                  onChange={(text) => {
                    set(text)
                    grow(document.activeElement as HTMLTextAreaElement | null)
                  }}
                  onSubmit={save}
                  onCancel={close}
                />
                <div className="idea-editor-buttons">
                  <span className="idea-editor-hint">⌘↵ to add · Esc to cancel</span>
                  <Button size="sm" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" type="submit" disabled={!open.text.trim()}>
                    Add
                  </Button>
                </div>
              </form>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A heading line's title, without its #s. */
export function title(source: string): string {
  return source
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .trim()
}

/** A code block's source: edited in monospace, where prose is edited in the reading face. */
const code = (text: string) => /^(```|~~~|    )/.test(text)

/**
 * The box as tall as what's in it, never less than the block it replaces: by CSS where the browser
 * sizes a field to its content, measured where it doesn't.
 */
function grow(box: HTMLTextAreaElement | null) {
  if (!box || box.tagName !== 'TEXTAREA' || CSS.supports('field-sizing', 'content')) {
    return
  }
  box.style.height = 'auto'
  box.style.height = `${box.scrollHeight + 2}px`
}
