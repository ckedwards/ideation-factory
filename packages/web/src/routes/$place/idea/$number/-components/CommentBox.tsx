// A box for a comment on something as a whole: the whole file, at the top of
// its comments, or the idea, at the end of its activity. Its buttons are there
// from the start, so it's plain how to send, and work once there's something to.
// Folded, it's one line that opens it, so a column can start with its comments.
import { useState } from 'react'
import { Button, COMMENT_LIMIT } from '@ideaf/ui'
import { MarkdownEditor } from '@ideaf/ui/editor'
import './CommentBox.css'

export function CommentBox({
  label,
  onComment,
  addToReview,
  folded = false,
}: {
  /** What it's on, as its placeholder and name: "Comment on the whole file". */
  label: string
  onComment: (body: string, pending: boolean) => void
  /** Whether it can go in your review instead (pending until you submit it). */
  addToReview: boolean
  /** One line until it's opened. */
  folded?: boolean
}) {
  const [body, setBody] = useState('')
  const [open, setOpen] = useState(!folded)
  if (!open) {
    return (
      <Button size="sm" variant="link" className="comment-box-open" onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  const sendable = body.trim() !== '' && body.length <= COMMENT_LIMIT
  const send = (pending: boolean) => {
    if (sendable) {
      onComment(body.trim(), pending)
      setBody('')
    }
  }
  return (
    <form
      className="comment-box"
      onSubmit={(event) => {
        event.preventDefault()
        send(false)
      }}
    >
      <MarkdownEditor
        autoFocus={folded}
        rows={2}
        value={body}
        placeholder={label}
        label={label}
        limit={COMMENT_LIMIT}
        onChange={setBody}
        onSubmit={() => send(false)}
        footer={
          <>
            {addToReview && (
              <Button size="sm" onClick={() => send(true)} disabled={!sendable}>
                Add to your review
              </Button>
            )}
            <Button size="sm" variant="primary" type="submit" disabled={!sendable}>
              Comment
            </Button>
          </>
        }
      />
    </form>
  )
}
