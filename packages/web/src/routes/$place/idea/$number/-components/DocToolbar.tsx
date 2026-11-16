// The bar across the top of an idea's document: which file and version it is, and what can be done
// with it: compare it with another version (or stop), read its Markdown source, give your review, and
// edit it. Comparing lives here, a way of looking at the file, not a page of its own.
import { Button, Link, LinkButton, Select } from '@ideaf/ui'
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
  /** Your review: where to give it, and how many comments wait in it. Null when you can't review. */
  review: { href: string; pending: number } | null
  /** Editing: what it says (Edit, or Open the draft); null when you can't. */
  edit: { label: string; disabled: boolean; onEdit: () => void } | null
}

export function DocToolbar(props: DocToolbarProps) {
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="This file">
      <span className="doc-toolbar-file">
        <span className="doc-toolbar-path">{props.path}</span>
        {props.version !== props.latest && <span className="doc-toolbar-version">@ v{props.version}</span>}
      </span>
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
              size="sm"
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
          size="sm"
          variant={props.source ? 'primary' : 'default'}
          aria-pressed={props.source}
          onClick={() => props.onSource(!props.source)}
        >
          Source
        </Button>
        {props.review && (
          <LinkButton size="sm" href={props.review.href} variant={props.review.pending > 0 ? 'primary' : 'default'}>
            {props.review.pending > 0 ? `Finish your review (${props.review.pending})` : 'Review'}
          </LinkButton>
        )}
        {props.edit && (
          <Button size="sm" onClick={props.edit.onEdit} disabled={props.edit.disabled}>
            {props.edit.label}
          </Button>
        )}
      </span>
    </div>
  )
}
