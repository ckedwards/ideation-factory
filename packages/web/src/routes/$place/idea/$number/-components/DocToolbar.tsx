// The bar across the top of an idea's document: which file and version it is, and what can be done
// with it: compare it with another version (or stop), read its Markdown source, and edit it. Comparing
// lives here, a way of looking at the file, not a page of its own. Your review is of the idea, not one
// file, so its button is in the idea's bar.
import { Button, Link, Select } from '@ideaf/ui'
import './DocToolbar.css'

export interface DocToolbarProps {
  path: string
  version: number
  latest: number
  /** Comparing: with which version, and the way out. */
  compare: { base: number; stopHref: string } | null
  /** The other versions it can be compared with, newest first, and where each comparison is. */
  compareWith: { version: number; href: string }[]
  onCompare: (href: string) => void
  source: boolean
  onSource: (source: boolean) => void
  /** Editing: what it says (Edit, or Open the draft); null when you can't. */
  edit: { label: string; disabled: boolean; onEdit: () => void } | null
  /** The editor's open: the toolbar stays, saying how to edit in place of the reading actions (the idea's bar has the rest). */
  editing?: boolean
}

export function DocToolbar(props: DocToolbarProps) {
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="This file">
      <span className="doc-toolbar-file">
        <span className="doc-toolbar-path">{props.path}</span>
        {props.version !== props.latest && <span className="doc-toolbar-version">@ v{props.version}</span>}
      </span>
      {props.editing ? (
        // the bar says it's being edited, and has how to finish: here, just how to edit
        <span className="doc-toolbar-actions">
          <span className="doc-toolbar-hint">Hover a block to edit it, add text below it, or delete it.</span>
        </span>
      ) : (
        <span className="doc-toolbar-actions">
          {props.compare ? (
            <span className="doc-toolbar-chip">
              Changes v{props.compare.base} → v{props.version}
              <Link href={props.compare.stopHref} aria-label="Stop comparing" title="Stop comparing">
                ✕
              </Link>
            </span>
          ) : (
            props.compareWith.length > 0 && (
              <Select
                aria-label="Compare with another version"
                options={[
                  { value: '', label: 'Compare…' },
                  ...props.compareWith.map((c) => ({ value: c.href, label: `With v${c.version}` })),
                ]}
                value=""
                onChange={(href) => href && props.onCompare(href)}
              />
            )
          )}
          <Button
            variant={props.source ? 'primary' : 'default'}
            aria-pressed={props.source}
            onClick={() => props.onSource(!props.source)}
          >
            Source
          </Button>
          {props.edit && (
            <Button onClick={props.edit.onEdit} disabled={props.edit.disabled}>
              {props.edit.label}
            </Button>
          )}
        </span>
      )}
    </div>
  )
}
