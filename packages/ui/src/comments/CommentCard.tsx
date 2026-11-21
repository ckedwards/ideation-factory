import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../controls/Button.tsx'
import { MarkdownEditor } from '../editor/MarkdownEditor.tsx'
import { Tag } from '../labels/Tag.tsx'
import { ActorLabel, type Actor } from '../people/ActorLabel.tsx'
import { Avatar } from '../people/Avatar.tsx'
import { RelativeTime } from '../time/RelativeTime.tsx'
import { inlineMarkdown } from '../document/MarkdownView.tsx'
import { COMMENT_LIMIT } from './limit.ts'
import { ViewInVersion } from './ViewInVersion.tsx'
import './CommentCard.css'

// What a comment is on: the idea as a whole, the whole file, a section, or some text.
export type CommentTarget =
  | { kind: 'idea' }
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

/**
 * How much of a thread a card shows. Full: all of it, its long comment clamped and a long thread
 * folded. Short: who, when, two lines and a count of replies. Line: a face, a name, the first words
 * and a count. Short and line are a fixed height (CommentCard.css), so a layout can count on them.
 */
export type CardSize = 'full' | 'short' | 'line'

export interface CommentCardProps {
  comment: CommentInfo
  size?: CardSize
  // highlighted with its text in the document
  active?: boolean
  // with what it's on (the quote, the section) above the text
  showTarget?: boolean
  // away from the document (an idea's activity): always quote the text it's on, and name its section
  context?: boolean
  // the author can accept or reject suggested edits
  canDecide?: boolean
  onSelect?: (() => void) | undefined
  // `pending`: added to your review rather than sent now
  onReply?: ((body: string, pending: boolean) => void) | undefined
  // offer "Add to your review" on a reply (a reply in your own pending thread always is)
  addToReview?: boolean
  onResolve?: ((resolved: boolean) => void) | undefined
  // accepts it into the idea's draft: committing the draft makes the version
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
  size = 'full',
  active = false,
  showTarget = true,
  context = false,
  canDecide = false,
  onSelect,
  onReply,
  addToReview = false,
  onResolve,
  onAddToDraft,
  onReject,
  onViewInVersion,
  extra,
}: CommentCardProps) {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  // a long thread's earlier replies, and a long comment's end, shown
  const [allReplies, setAllReplies] = useState(false)
  const headingId = useId()
  const { target, suggestion } = comment
  const shown = suggestionShown(suggestion, target)
  const classes = [
    'comment-card',
    size !== 'full' && `is-${size}`,
    active && 'is-active',
    comment.resolved && 'is-resolved',
    comment.outdated && 'is-outdated',
    comment.author.kind !== 'person' && 'by-bot',
    comment.pending && 'is-pending',
  ]
  const sendable = draft.trim() !== '' && draft.length <= COMMENT_LIMIT
  const send = (pending = false) => {
    if (sendable) {
      onReply?.(draft, pending || comment.pending === true)
      setDraft('')
      setReplying(false)
    }
  }
  const tag = target.kind === 'file' ? 'Whole file' : target.kind === 'section' ? `§ ${target.title}` : null
  const replies = comment.replies.length
  if (size === 'line') {
    return (
      <article className={classes.filter(Boolean).join(' ')} aria-labelledby={headingId} onClick={onSelect}>
        <span className="comment-line-who" id={headingId}>
          <Face actor={comment.author} />
          <span className="comment-line-name">{nameOf(comment.author)}</span>
        </span>
        <span className="comment-line-text">
          {tag && <Tag>{tag}</Tag>} {comment.body}
        </span>
        {replies > 0 && (
          <span className="comment-line-count" title={plural(replies, 'reply', 'replies')}>
            {replies}
            <span className="visually-hidden"> {replies === 1 ? 'reply' : 'replies'}</span>
          </span>
        )}
      </article>
    )
  }
  if (size === 'short') {
    const last = comment.replies.at(-1)
    return (
      <article className={classes.filter(Boolean).join(' ')} aria-labelledby={headingId} onClick={onSelect}>
        <header className="comment-head" id={headingId}>
          <ActorLabel actor={comment.author} short />
          {tag && <Tag>{tag}</Tag>}
          <span className="comment-time">
            <RelativeTime at={comment.at} />
          </span>
        </header>
        <div className="comment-body">{comment.body}</div>
        {last && (
          <p className="comment-summary">
            {plural(replies, 'reply', 'replies')} · {nameOf(last.author)}, <RelativeTime at={last.at} />
          </p>
        )}
      </article>
    )
  }
  // a long thread: the first comment, then the last two replies, the ones between folded
  const folded = !allReplies && replies > 2 ? replies - 2 : 0
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
          {target.kind === 'text' && context && target.section && <Tag>§ {target.section}</Tag>}
          {target.kind === 'text' && (comment.outdated || context) && <q className="comment-quote">{target.quote}</q>}
          {comment.outdated && comment.lastSeenIn !== undefined && onViewInVersion && (
            <ViewInVersion version={comment.lastSeenIn} onView={() => onViewInVersion(comment.lastSeenIn!)} />
          )}
          {comment.madeOn !== undefined && <Tag tone="faint">on v{comment.madeOn}</Tag>}
          {comment.resolved && <Tag tone="ok">Resolved</Tag>}
        </div>
      )}

      <Clamped>{comment.body}</Clamped>

      {suggestion && target.kind === 'text' && (
        <div className={`suggestion suggestion-${suggestion.state}${shown.source ? ' is-source' : ''}`}>
          <div className="suggestion-label">
            Suggested edit
            {suggestion.state !== 'open' && ` · ${suggestion.state === 'in-draft' ? 'in the draft' : suggestion.state}`}
          </div>
          <div className="suggestion-diff">
            {suggestion.state !== 'accepted' && (
              <del>
                <span className="visually-hidden">Replace: </span>
                {shown.old}
              </del>
            )}
            <ins>
              <span className="visually-hidden">{suggestion.state === 'accepted' ? 'Now: ' : 'With: '}</span>
              {shown.replacement}
            </ins>
          </div>
          {suggestion.state === 'open' && canDecide && !comment.outdated && (
            <div className="suggestion-actions" onClick={(event) => event.stopPropagation()}>
              {onAddToDraft && (
                <Button variant="primary" size="sm" onClick={onAddToDraft}>
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

      {folded > 0 && (
        <button
          type="button"
          className="comment-earlier"
          onClick={(event) => {
            event.stopPropagation()
            setAllReplies(true)
          }}
        >
          {plural(folded, 'earlier reply', 'earlier replies')}
        </button>
      )}
      {replies > 0 && (
        <ol className="comment-replies" aria-label="Replies">
          {comment.replies.slice(folded).map((reply) => (
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
          <MarkdownEditor
            autoFocus
            rows={2}
            value={draft}
            placeholder="Reply…"
            label="Reply"
            limit={COMMENT_LIMIT}
            onChange={setDraft}
            onSubmit={() => send()}
            onCancel={() => setReplying(false)}
            footer={
              <>
                <Button variant="ghost" size="sm" onClick={() => setReplying(false)}>
                  Cancel
                </Button>
                {addToReview && !comment.pending && (
                  <Button size="sm" disabled={!sendable} onClick={() => send(true)}>
                    Add to your review
                  </Button>
                )}
                <Button variant="primary" size="sm" disabled={!sendable} onClick={() => send()}>
                  {comment.pending ? 'Add reply' : 'Reply'}
                </Button>
              </>
            }
          />
        </div>
      ) : (
        (onReply || onResolve || extra) && (
          <footer className="comment-actions" onClick={(event) => event.stopPropagation()}>
            {onReply && (
              <Button variant="link" size="sm" data-action="reply" onClick={() => setReplying(true)}>
                Reply
              </Button>
            )}
            {onResolve && (
              <Button variant="link" size="sm" data-action="resolve" onClick={() => onResolve(!comment.resolved)}>
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

/** A comment's text, cut to about six lines with "Show more" when it's longer. */
function Clamped({ children }: { children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const element = body.current
    if (!element || open) {
      return
    }
    const measure = () => setLong(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])
  return (
    <>
      <div ref={body} className={`comment-body${open ? '' : ' is-clamped'}`}>
        {children}
      </div>
      {(long || open) && (
        <button
          type="button"
          className="comment-more"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(!open)
          }}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

/** Who wrote it, as a face: a person's avatar, or the bot mark. */
function Face({ actor }: { actor: Actor }) {
  if (actor.kind === 'person') {
    return <Avatar person={actor.person} size="sm" decorative />
  }
  return (
    <span className="bot-mark" aria-hidden>
      🤖
    </span>
  )
}

/** Who wrote it, in a word or two: a person's name, or a bot's. */
function nameOf(actor: Actor): string {
  return actor.kind === 'person' ? actor.person.name : actor.bot
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * A suggestion's old and new words as they read: bold as bold, a link as a link. Its old words are
 * the Markdown it replaces, or (without it) the quote, which is plain text. Either being more than a
 * line of text (two paragraphs, a list) shows both as their source, so they're set side by side alike.
 */
function suggestionShown(
  suggestion: Suggestion | undefined,
  target: CommentTarget,
): { old: ReactNode; replacement: ReactNode; source: boolean } {
  if (!suggestion) {
    return { old: null, replacement: null, source: false }
  }
  const quote = target.kind === 'text' ? target.quote : ''
  const old = suggestion.old === undefined ? quote : inlineMarkdown(suggestion.old)
  const replacement = inlineMarkdown(suggestion.replacement)
  if (old === null || replacement === null) {
    return { old: suggestion.old ?? quote, replacement: suggestion.replacement, source: true }
  }
  return { old, replacement, source: false }
}
