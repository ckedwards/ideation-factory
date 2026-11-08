import { useId, useState, type ReactNode } from 'react'
import { Button } from '../controls/Button.tsx'
import { TextArea } from '../controls/TextArea.tsx'
import { Tag } from '../labels/Tag.tsx'
import { ActorLabel, type Actor } from '../people/ActorLabel.tsx'
import { RelativeTime } from '../time/RelativeTime.tsx'
import { ViewInVersion } from './ViewInVersion.tsx'
import './CommentCard.css'

// What a comment is on: the whole file, a section, or some text.
export type CommentTarget =
  | { kind: 'file' }
  | { kind: 'section'; title: string }
  | { kind: 'text'; quote: string; section?: string }

// A suggested edit: replace the comment's text with this.
export interface Suggestion {
  // the Markdown it replaces, shown as source with the replacement; without it, the quote is
  old?: string
  replacement: string
  // in the draft: accepted into it, to be committed with the rest of it
  state: 'open' | 'in-draft' | 'accepted' | 'rejected'
}

export interface CommentReply {
  id: string
  author: Actor
  // milliseconds since the epoch
  at: number
  // the text, rendered by the page (MarkdownView, compact)
  body: ReactNode
  // part of your review, not submitted yet: only you see it
  pending?: boolean
}

export interface CommentInfo extends CommentReply {
  target: CommentTarget
  resolved: boolean
  // the text it was on isn't in the version being viewed
  outdated?: boolean
  // for an outdated comment: the last version that still had its text
  lastSeenIn?: number
  // the version it was made on, when older than the one being viewed
  madeOn?: number
  suggestion?: Suggestion
  replies: CommentReply[]
}

export interface CommentCardProps {
  comment: CommentInfo
  // highlighted with its text in the document
  active?: boolean
  // with what it's on (the quote, the section) above the text
  showTarget?: boolean
  // the author can accept or reject suggested edits
  canDecide?: boolean
  onSelect?: (() => void) | undefined
  // `pending`: added to your review rather than sent now
  onReply?: ((body: string, pending: boolean) => void) | undefined
  // offer "Add to review" on a reply (a reply in your own pending thread always is)
  addToReview?: boolean
  onResolve?: ((resolved: boolean) => void) | undefined
  onAccept?: (() => void) | undefined
  // into the idea's draft, rather than a version now
  onAddToDraft?: (() => void) | undefined
  onReject?: (() => void) | undefined
  onViewInVersion?: ((version: number) => void) | undefined
  // more actions in the footer, from the page
  extra?: ReactNode
}

// One comment thread: who and when, what it's on, the text, a suggested edit,
// the replies, and Reply and Resolve. Agent comments carry the bot rail.
export function CommentCard({
  comment,
  active = false,
  showTarget = true,
  canDecide = false,
  onSelect,
  onReply,
  addToReview = false,
  onResolve,
  onAccept,
  onAddToDraft,
  onReject,
  onViewInVersion,
  extra,
}: CommentCardProps) {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  const headingId = useId()
  const { target, suggestion } = comment
  const classes = [
    'comment-card',
    active && 'is-active',
    comment.resolved && 'is-resolved',
    comment.outdated && 'is-outdated',
    comment.author.kind !== 'person' && 'by-bot',
    comment.pending && 'is-pending',
  ]
  const send = (pending = false) => {
    if (draft.trim()) {
      onReply?.(draft, pending || comment.pending === true)
      setDraft('')
      setReplying(false)
    }
  }
  return (
    <article className={classes.filter(Boolean).join(' ')} aria-labelledby={headingId} onClick={onSelect}>
      <header className="comment-head" id={headingId}>
        <ActorLabel actor={comment.author} />
        {comment.pending && (
          <Tag tone="dashed" title="Part of your review: only you see it until you submit it">
            Pending
          </Tag>
        )}
        <span className="comment-time">
          <RelativeTime at={comment.at} />
        </span>
      </header>

      {showTarget && (
        <div className="comment-target">
          {comment.outdated && (
            <Tag tone="lost" title="The text this comment was on isn’t in this version">
              Outdated
            </Tag>
          )}
          {target.kind === 'file' && <Tag>Whole file</Tag>}
          {target.kind === 'section' && <Tag>§ {target.title}</Tag>}
          {target.kind === 'text' && comment.outdated && <q className="comment-quote">{target.quote}</q>}
          {comment.outdated && comment.lastSeenIn !== undefined && onViewInVersion && (
            <ViewInVersion version={comment.lastSeenIn} onView={() => onViewInVersion(comment.lastSeenIn!)} />
          )}
          {comment.madeOn !== undefined && <Tag tone="faint">on v{comment.madeOn}</Tag>}
          {comment.resolved && <Tag tone="ok">Resolved</Tag>}
        </div>
      )}

      <div className="comment-body">{comment.body}</div>

      {suggestion && target.kind === 'text' && (
        <div className={`suggestion suggestion-${suggestion.state}${suggestion.old !== undefined ? ' is-source' : ''}`}>
          <div className="suggestion-label">
            Suggested edit
            {suggestion.state !== 'open' && ` · ${suggestion.state === 'in-draft' ? 'in the draft' : suggestion.state}`}
          </div>
          <div className="suggestion-diff">
            {suggestion.state !== 'accepted' && (
              <del>
                <span className="visually-hidden">Replace: </span>
                {suggestion.old ?? target.quote}
              </del>
            )}
            <ins>
              <span className="visually-hidden">{suggestion.state === 'accepted' ? 'Now: ' : 'With: '}</span>
              {suggestion.replacement}
            </ins>
          </div>
          {suggestion.state === 'open' && canDecide && !comment.outdated && (
            <div className="suggestion-actions" onClick={(event) => event.stopPropagation()}>
              <Button variant="primary" size="sm" onClick={onAccept}>
                Accept as a new version
              </Button>
              {onAddToDraft && (
                <Button size="sm" onClick={onAddToDraft}>
                  Add to draft
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onReject}>
                Reject
              </Button>
            </div>
          )}
        </div>
      )}

      {comment.replies.length > 0 && (
        <ol className="comment-replies" aria-label="Replies">
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <header className="comment-head">
                <ActorLabel actor={reply.author} short />
                {reply.pending && !comment.pending && (
                  <Tag tone="dashed" title="Part of your review: only you see it until you submit it">
                    Pending
                  </Tag>
                )}
                <span className="comment-time">
                  <RelativeTime at={reply.at} />
                </span>
              </header>
              <div className="comment-body">{reply.body}</div>
            </li>
          ))}
        </ol>
      )}

      {replying ? (
        <div className="comment-reply" onClick={(event) => event.stopPropagation()}>
          <TextArea
            autoFocus
            rows={2}
            value={draft}
            placeholder="Reply…"
            aria-label="Reply"
            onChange={setDraft}
            onSubmit={() => send()}
            onCancel={() => setReplying(false)}
          />
          <div className="comment-reply-actions">
            <span className="comment-hint">⌘↵ to send</span>
            <Button variant="ghost" size="sm" onClick={() => setReplying(false)}>
              Cancel
            </Button>
            {addToReview && !comment.pending && (
              <Button size="sm" disabled={!draft.trim()} onClick={() => send(true)}>
                Add to review
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={!draft.trim()} onClick={() => send()}>
              {comment.pending ? 'Add reply' : 'Reply'}
            </Button>
          </div>
        </div>
      ) : (
        (onReply || onResolve || extra) && (
          <footer className="comment-actions" onClick={(event) => event.stopPropagation()}>
            {onReply && (
              <Button variant="link" size="sm" onClick={() => setReplying(true)}>
                Reply
              </Button>
            )}
            {onResolve && (
              <Button variant="link" size="sm" onClick={() => onResolve(!comment.resolved)}>
                {comment.resolved ? 'Reopen' : 'Resolve'}
              </Button>
            )}
            {extra}
          </footer>
        )
      )}
    </article>
  )
}
