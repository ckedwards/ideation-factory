// The bar across the top of an idea's document: which file and version it is, and what can be done
// with it: compare it with another version (or stop), read its Markdown source, give your review (in
// a dialog over the document, so the reader keeps their place), and edit it. Comparing lives here, a
// way of looking at the file, not a page of its own.
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
  /** Your review: opening its dialog, and how many comments wait in it. Null when you can't review. */
  review: { onReview: () => void; pending: number } | null
  /** Editing: what it says (Edit, or Open the draft); null when you can't. */
  edit: { label: string; disabled: boolean; onEdit: () => void } | null
  /** The editor's open: the bar stays, and says so in place of the reading actions (closing is in its panel). */
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
        <span className="doc-toolbar-actions">
          <span className="doc-toolbar-chip">Editing the draft</span>
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
          {props.review && (
            // the main thing to do here, for someone who can review
            <Button onClick={props.review.onReview} variant="primary">
              {props.review.pending > 0 ? `Finish your review (${props.review.pending})` : 'Review'}
            </Button>
          )}
          {props.edit && (
            // the main thing for someone who can't review: the author
            <Button
              variant={props.review ? 'default' : 'primary'}
              onClick={props.edit.onEdit}
              disabled={props.edit.disabled}
            >
              {props.edit.label}
            </Button>
          )}
        </span>
      )}
    </div>
  )
}
