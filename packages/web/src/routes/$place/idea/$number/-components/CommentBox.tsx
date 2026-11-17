// A box for a comment on something as a whole: the whole file, at the top of
// its comments, or the idea, at the end of its activity. Its buttons are there
// from the start, so it's plain how to send, and work once there's something to.
import { useState } from 'react'
import { Button, TextArea } from '@ideaf/ui'
import './CommentBox.css'

export function CommentBox({
  label,
  onComment,
  addToReview,
}: {
  /** What it's on, as its placeholder and name: "Comment on the whole file". */
  label: string
  onComment: (body: string, pending: boolean) => void
  /** Whether it can go in your review instead (pending until you submit it). */
  addToReview: boolean
}) {
  const [body, setBody] = useState('')
  const send = (pending: boolean) => {
    if (body.trim()) {
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
      <TextArea
        rows={2}
        value={body}
        placeholder={label}
        aria-label={label}
        onChange={setBody}
        onSubmit={() => send(false)}
      />
      <div className="comment-box-buttons">
        {addToReview && (
          <Button size="sm" onClick={() => send(true)} disabled={!body.trim()}>
            Add to your review
          </Button>
        )}
        <Button size="sm" variant="primary" type="submit" disabled={!body.trim()}>
          Comment
        </Button>
      </div>
    </form>
  )
}
