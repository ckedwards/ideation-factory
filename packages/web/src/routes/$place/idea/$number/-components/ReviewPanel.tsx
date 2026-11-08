// An idea's reviews, on its overview: where it is and moving it (people do;
// a verdict never moves it), closing and reopening it, who's asked to review,
// each reviewer's latest verdict, and giving yours. A Request changes or
// Reject stands through new versions until it's withdrawn or dismissed, and
// stops the idea closing as accepted; an approval counts only on the latest
// version, and only a person's.
import { type ReactNode, useState } from 'react'
import {
  type Actor,
  ActorLabel,
  Button,
  type ClosedReason,
  Dialog,
  type OpenStatus,
  type Person,
  RelativeTime,
  Section,
  SegmentedControl,
  StatusControl,
  StatusPill,
  Tag,
  Select,
  TextArea,
} from '@ideaf/ui'
import { GroupPicker, type GroupRef } from '../../../../../components/GroupPicker.tsx'
import { PersonPicker } from '../../../../../components/PersonPicker.tsx'
import type { ShownStatus } from '../../../../../ideas.ts'
import './ReviewPanel.css'

export type Verdict = 'approve' | 'request-changes' | 'reject'

export interface ReviewRow {
  /** The reviewer's account (what dismissing names). */
  reviewer: string
  by: Actor
  verdict: Verdict
  version: number
  body: string
  at: number
  dismissed: { by: Actor; at: number; reason: string } | null
  counts: boolean
  standing: boolean
}

export type ReviewerSubject = { kind: 'user' | 'group'; id: string }

export interface ReviewPanelProps {
  status: ShownStatus
  latest: number
  /** People and groups asked to review, as they show. */
  reviewers: Array<{ key: string; subject: ReviewerSubject; label: ReactNode }>
  reviews: ReviewRow[]
  /** Edit access: moving it, closing and reopening, dismissing an objection. */
  canEdit: boolean
  /** Giving a verdict: anyone who can see it, but not its owner, while it's open. */
  canReview: boolean
  /** Asking for reviews, and taking reviewers off (share access). */
  onAsk?: ((subject: ReviewerSubject, ask: boolean) => Promise<void>) | undefined
  onStatus: (status: OpenStatus) => void
  /** Rejects with the server's message if it can't close (a standing objection). */
  onClose: (reason: ClosedReason, note: string) => Promise<void>
  onReopen: () => void
  onReview: (verdict: Verdict, body: string) => Promise<void>
  onDismiss: (reviewer: string, reason: string) => Promise<void>
}

const SAID: Record<Verdict, string> = {
  approve: 'Approved',
  'request-changes': 'Requested changes',
  reject: 'Rejected',
}

const CHOICES = [
  { value: 'approve', label: 'Approve' },
  { value: 'request-changes', label: 'Request changes' },
  { value: 'reject', label: 'Reject' },
] satisfies Array<{ value: Verdict; label: string }>

export function ReviewPanel(props: ReviewPanelProps) {
  const closed = props.status.status === 'closed'
  const standing = props.reviews.filter((r) => r.standing)
  const approvals = props.reviews.filter((r) => r.counts).length
  return (
    <Section title="Review">
      <div className="review-panel">
        <div className="review-panel-status">
          {props.canEdit && !closed ? (
            <StatusControl value={props.status.status as OpenStatus} onChange={props.onStatus} />
          ) : (
            <StatusPill
              status={props.status.status}
              {...(props.status.reason ? { reason: props.status.reason } : {})}
            />
          )}
          <span className="review-panel-count">
            {approvals === 1 ? '1 approval' : `${approvals} approvals`} of v{props.latest}
          </span>
          {props.canEdit && (closed ? <Reopen onReopen={props.onReopen} /> : <Close {...props} blocked={standing} />)}
        </div>

        <div className="review-panel-reviewers">
          <span className="review-panel-label">Reviewers</span>
          {props.reviewers.length === 0 ? (
            <span className="review-panel-none">Nobody’s been asked yet.</span>
          ) : (
            <span className="review-panel-asked">
              {props.reviewers.map((r) => (
                <span key={r.key} className="review-panel-reviewer">
                  {r.label}
                  {props.onAsk && (
                    <Button
                      size="sm"
                      variant="link"
                      aria-label="Take off the reviewers"
                      onClick={() => void props.onAsk?.(r.subject, false)}
                    >
                      ×
                    </Button>
                  )}
                </span>
              ))}
            </span>
          )}
        </div>
        {props.onAsk && !closed && <Ask onAsk={props.onAsk} />}

        {props.reviews.length > 0 && (
          <ul className="review-panel-verdicts">
            {props.reviews.map((r) => (
              <Row
                key={r.reviewer}
                review={r}
                latest={props.latest}
                canDismiss={props.canEdit}
                onDismiss={props.onDismiss}
              />
            ))}
          </ul>
        )}

        {standing.length > 0 && !closed && (
          <p className="review-panel-blocked">
            {standing.length === 1 ? 'An objection stands' : `${standing.length} objections stand`}: it can’t be closed
            as accepted until {standing.length === 1 ? 'it’s' : 'they’re'} withdrawn or dismissed.
          </p>
        )}

        {props.canReview && !closed && <ReviewForm latest={props.latest} onReview={props.onReview} />}
      </div>
    </Section>
  )
}

function Row({
  review: r,
  latest,
  canDismiss,
  onDismiss,
}: {
  review: ReviewRow
  latest: number
  canDismiss: boolean
  onDismiss: ReviewPanelProps['onDismiss']
}) {
  const [dismissing, setDismissing] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const notes: ReactNode[] = []
  if (r.verdict === 'approve' && !r.counts) {
    notes.push(
      <Tag key="n" tone="neutral">
        {r.by.kind === 'person' ? `on v${r.version}: doesn’t count` : 'a bot’s: doesn’t count'}
      </Tag>,
    )
  }
  if (r.standing) {
    notes.push(
      <Tag key="s" tone="warn">
        Stands
      </Tag>,
    )
  }
  if (r.dismissed) {
    notes.push(
      <Tag key="d" tone="neutral">
        Dismissed
      </Tag>,
    )
  }
  const dismiss = async () => {
    try {
      await onDismiss(r.reviewer, reason.trim())
      setDismissing(false)
      setReason('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <li className={`review-panel-verdict is-${r.verdict}${r.dismissed ? ' is-dismissed' : ''}`}>
      <div className="review-panel-verdict-line">
        <span className="review-panel-verdict-what">{SAID[r.verdict]}</span>
        <ActorLabel actor={r.by} short />
        <span className="review-panel-meta">
          v{r.version}
          {r.version !== latest && ` (now v${latest})`} · <RelativeTime at={r.at} />
        </span>
        {notes}
        {canDismiss && r.standing && !dismissing && (
          <Button size="sm" variant="link" onClick={() => setDismissing(true)}>
            Dismiss
          </Button>
        )}
      </div>
      {r.body && <p className="review-panel-body">{r.body}</p>}
      {r.dismissed && (
        <p className="review-panel-dismissed">
          Dismissed by <ActorLabel actor={r.dismissed.by} short />: {r.dismissed.reason}
        </p>
      )}
      {dismissing && (
        <form
          className="review-panel-form"
          onSubmit={(event) => {
            event.preventDefault()
            void dismiss()
          }}
        >
          <TextArea
            autoFocus
            rows={2}
            value={reason}
            placeholder="Why it no longer stands in the way"
            aria-label="Why it’s dismissed"
            onChange={setReason}
            onSubmit={() => void dismiss()}
            onCancel={() => setDismissing(false)}
          />
          {error && <p className="review-panel-error">{error}</p>}
          <div className="review-panel-buttons">
            <Button size="sm" variant="ghost" onClick={() => setDismissing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!reason.trim()}>
              Dismiss
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function ReviewForm({ latest, onReview }: { latest: number; onReview: ReviewPanelProps['onReview'] }) {
  const [verdict, setVerdict] = useState<Verdict>('approve')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    setSending(true)
    setError(null)
    try {
      await onReview(verdict, body.trim())
      setBody('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }
  return (
    <form
      className="review-panel-form review-panel-yours"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <span className="review-panel-label">Your review of v{latest}</span>
      <SegmentedControl label="Your verdict" options={CHOICES} value={verdict} onChange={setVerdict} />
      <TextArea
        rows={3}
        value={body}
        placeholder="A summary, if it needs one"
        aria-label="Summary"
        onChange={setBody}
        onSubmit={() => void send()}
      />
      {error && <p className="review-panel-error">{error}</p>}
      <div className="review-panel-buttons">
        <Button variant="primary" type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Submit review'}
        </Button>
      </div>
    </form>
  )
}

function Close({ onClose, blocked }: { onClose: ReviewPanelProps['onClose']; blocked: ReviewRow[] }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ClosedReason>(blocked.length > 0 ? 'rejected' : 'accepted')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const close = async () => {
    setError(null)
    try {
      await onClose(reason, note.trim())
      setOpen(false)
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Close…
      </Button>
      <Dialog
        open={open}
        title="Close this idea"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={reason === 'rejected' ? 'danger' : 'primary'}
              disabled={reason === 'accepted' && blocked.length > 0}
              onClick={() => void close()}
            >
              {reason === 'accepted' ? 'Close as accepted' : 'Close as rejected'}
            </Button>
          </>
        }
      >
        <div className="review-panel-close">
          <SegmentedControl
            label="Why it’s closing"
            options={[
              { value: 'accepted', label: 'Accepted: it goes ahead' },
              { value: 'rejected', label: 'Rejected: it doesn’t' },
            ]}
            value={reason}
            onChange={setReason}
          />
          {reason === 'accepted' && blocked.length > 0 && (
            <p className="review-panel-blocked">
              {blocked.length === 1 ? 'A reviewer objects' : `${blocked.length} reviewers object`}: it can be closed as
              accepted once {blocked.length === 1 ? 'their verdict changes or is' : 'their verdicts change or are'}{' '}
              dismissed.
            </p>
          )}
          <TextArea rows={3} value={note} placeholder="A note, if it needs one" aria-label="Note" onChange={setNote} />
          {error && <p className="review-panel-error">{error}</p>}
        </div>
      </Dialog>
    </>
  )
}

function Ask({ onAsk }: { onAsk: NonNullable<ReviewPanelProps['onAsk']> }) {
  const [kind, setKind] = useState<'user' | 'group'>('user')
  const [person, setPerson] = useState<Person | null>(null)
  const [group, setGroup] = useState<GroupRef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chosen = kind === 'user' ? person : group
  return (
    <form
      className="review-panel-ask"
      onSubmit={(event) => {
        event.preventDefault()
        if (!chosen) {
          return
        }
        setError(null)
        onAsk({ kind, id: chosen.id }, true).then(
          () => {
            setPerson(null)
            setGroup(null)
          },
          (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
        )
      }}
    >
      <Select
        aria-label="Ask"
        options={[
          { value: 'user', label: 'A person' },
          { value: 'group', label: 'A group' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <div className="review-panel-ask-who">
        {kind === 'user' ? (
          <PersonPicker label="Who" value={person} onChange={setPerson} />
        ) : (
          <GroupPicker label="Which group" value={group} onChange={setGroup} />
        )}
      </div>
      <Button size="sm" type="submit" disabled={!chosen}>
        Ask to review
      </Button>
      {error && <p className="review-panel-error">{error}</p>}
    </form>
  )
}

function Reopen({ onReopen }: { onReopen: () => void }) {
  return (
    <Button size="sm" onClick={onReopen}>
      Reopen
    </Button>
  )
}
