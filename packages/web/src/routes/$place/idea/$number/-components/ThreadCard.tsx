// A comment thread on an idea's file, with what can be done to it here: reply, resolve, delete one of
// your pending ones, and decide a suggested edit. The Files tab and the focus view draw threads the same
// way, with the same rules about who may do what.
import type { ReactNode } from 'react'
import { Button, type CardSize, CommentCard, type CommentInfo } from '@ideaf/ui'
import type { Placement } from './view.ts'

/** A comment, as shown, and where it goes in the file shown. */
export interface PageComment {
  info: CommentInfo
  place: Placement
  /** Not saved yet: shown, but not replied to or resolved until it is. */
  pending?: boolean
}

/** What can be done to a thread, and whether you may. */
export interface ThreadActions {
  /** Replying and resolving: someone who can comment, on the latest version. */
  canComment: boolean
  /** Accepting and rejecting suggestions: for people with edit access, on the latest version. */
  canDecide?: boolean
  /** Offer "Add to your review": replies kept pending until the review is submitted. */
  addToReview?: boolean
  onReply?: (comment: string, body: string, pending: boolean) => void
  /** Deletes one of your pending comments. */
  onDelete?: (comment: string) => void
  onResolve?: (comment: string, resolved: boolean) => void
  /** Accepts suggestions into the idea's draft: committing it makes the version. */
  onAddToDraft?: (suggestions: string[]) => void
  onReject?: (suggestion: string) => void
  /** An outdated comment's "View in v3". */
  onViewInVersion?: (version: number) => void
}

export interface ThreadCardProps {
  comment: PageComment
  actions: ThreadActions
  active: boolean
  onSelect: () => void
  showTarget?: boolean
  /** Away from its text (a list): with the words it's on, and their section. */
  context?: boolean
  /** How much of it shows (the gutter fits it to the room its text has). */
  size?: CardSize
}

export function ThreadCard({
  comment,
  actions,
  active,
  onSelect,
  showTarget = false,
  context = false,
  size = 'full',
}: ThreadCardProps): ReactNode {
  const { canComment, canDecide = false } = actions
  return (
    <CommentCard
      comment={comment.info}
      active={active}
      showTarget={showTarget}
      context={context}
      size={size}
      onSelect={onSelect}
      onReply={
        canComment && !comment.pending && actions.onReply
          ? (body, pending) => actions.onReply?.(comment.info.id, body, pending)
          : undefined
      }
      addToReview={actions.addToReview ?? false}
      onResolve={
        // a comment in your review goes out before it can be resolved
        canComment && !comment.pending && !comment.info.pending && actions.onResolve
          ? (resolved) => actions.onResolve?.(comment.info.id, resolved)
          : undefined
      }
      canDecide={canDecide && !comment.pending && !comment.info.pending}
      extra={
        comment.info.pending && !comment.pending && actions.onDelete ? (
          <Button variant="link" size="sm" onClick={() => actions.onDelete?.(comment.info.id)}>
            Delete
          </Button>
        ) : undefined
      }
      onAddToDraft={actions.onAddToDraft ? () => actions.onAddToDraft?.([comment.info.id]) : undefined}
      onReject={actions.onReject ? () => actions.onReject?.(comment.info.id) : undefined}
      onViewInVersion={actions.onViewInVersion}
    />
  )
}
