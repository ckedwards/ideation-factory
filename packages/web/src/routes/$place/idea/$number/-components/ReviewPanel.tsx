// An idea's reviews, on its overview: who's asked to review, each reviewer's
// latest verdict, and giving yours (behind a button: you read first). Its status
// (IdeaStatus: people move it; a verdict never does) and closing and reopening
// it (CloseOrReopen) go in the overview's header. A Request changes or
// Reject stands through new versions until it's withdrawn or dismissed, and
// stops the idea closing as accepted; an approval counts only on the latest
// version, and only a person's.
import { type ReactNode, useState } from 'react'
import {
  type Actor,
  ActorLabel,
  Button,
  type ClosedReason,
  COMMENT_LIMIT,
  Dialog,
  type OpenStatus,
  RelativeTime,
  type RequirementCheck,
  RequirementList,
  RowMenu,
  Section,
  SegmentedControl,
  StatusControl,
  StatusPill,
  Tag,
  TextArea,
} from '@ideaf/ui'
import { MarkdownEditor } from '@ideaf/ui/editor'
import { type Picked, SubjectPicker } from '../../../../../components/SubjectPicker.tsx'
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
  /**
   * People and groups asked to review, as they show; a group's approval, when one of its members' counts;
   * and the latest version a person has opened (null when they haven't).
   */
  reviewers: Array<{
    key: string
    subject: ReviewerSubject
    label: ReactNode
    approved?: boolean
    seen?: number | null
  }>
  reviews: ReviewRow[]
  /** Its team's approval requirements, checked; empty when it has none. */
  requirements: RequirementCheck[]
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
  /** How many comments you have pending: they go out with your review. */
  pending?: number
  /** Submits your review: your pending comments, with a verdict, or (null) on their own. */
  onReview: (verdict: Verdict | null, body: string) => Promise<void>
  /** Deletes your pending comments: the review isn't sent. */
  onDiscard?: (() => void) | undefined
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

/** The idea's status: the menu that moves it, for someone who can edit it while it's open, or its pill. */
export function IdeaStatus(props: Pick<ReviewPanelProps, 'status' | 'canEdit' | 'onStatus'>) {
  return props.canEdit && props.status.status !== 'closed' ? (
    <StatusControl value={props.status.status as OpenStatus} onChange={props.onStatus} />
  ) : (
    <StatusPill status={props.status.status} {...(props.status.reason ? { reason: props.status.reason } : {})} />
  )
}

/** Closing it (as accepted once nothing stands in the way), or reopening it: for someone who can edit it. */
export function CloseOrReopen(props: ReviewPanelProps) {
  if (!props.canEdit) {
    return null
  }
  if (props.status.status === 'closed') {
    return <Reopen onReopen={props.onReopen} />
  }
  return (
    <Close
      onClose={props.onClose}
      blocked={props.reviews.filter((r) => r.standing)}
      unmet={props.requirements.filter((c) => !c.met).length}
    />
  )
}

export function ReviewPanel(props: ReviewPanelProps) {
  const closed = props.status.status === 'closed'
  const standing = props.reviews.filter((r) => r.standing)
  const approvals = props.reviews.filter((r) => r.counts).length
  return (
    <Section title="Review">
      <div className="review-panel">
        <span className="review-panel-count">
          {approvals === 1 ? '1 approval' : `${approvals} approvals`} of v{props.latest}
        </span>

        {props.requirements.length > 0 && (
          <div className="review-panel-requirements">
            <span className="review-panel-label">
              {props.requirements.every((c) => c.met) ? 'Its team’s requirements are met' : 'Its team’s requirements'}
            </span>
            <RequirementList checks={props.requirements} />
          </div>
        )}

        <div className="review-panel-reviewers">
          <span className="review-panel-label">Reviewers</span>
          {props.reviewers.length === 0 ? (
            <span className="review-panel-none">Nobody’s been asked yet.</span>
          ) : (
            <ul className="review-panel-asked">
              {props.reviewers.map((r) => (
                <li key={r.key} className="review-panel-reviewer">
                  <span className="review-panel-reviewer-name">{r.label}</span>
                  <ReviewerState reviewer={r} reviews={props.reviews} latest={props.latest} />
                  {props.onAsk && (
                    <RowMenu
                      label={typeof r.label === 'string' ? r.label : 'This reviewer'}
                      groups={[
                        {
                          items: [
                            {
                              label: 'Remove from the reviewers',
                              danger: true,
                              onSelect: () => void props.onAsk?.(r.subject, false),
                            },
                          ],
                        },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
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
      </div>
    </Section>
  )
}

/** Where a reviewer is: their latest verdict (and on which version), or not yet. */
function ReviewerState({
  reviewer,
  reviews,
  latest,
}: {
  reviewer: ReviewPanelProps['reviewers'][number]
  reviews: ReviewRow[]
  latest: number
}) {
  if (reviewer.subject.kind === 'group') {
    return reviewer.approved ? (
      <span className="review-panel-state is-approve">Approved</span>
    ) : (
      <span className="review-panel-state">Not yet</span>
    )
  }
  const theirs = reviews.find((r) => r.reviewer === `u:${reviewer.subject.id}` && !r.dismissed)
  // what they've read since, while their verdict isn't on the latest version
  const seen =
    reviewer.seen === undefined || theirs?.version === latest ? null : (
      <span className="review-panel-seen">
        {' · '}
        {reviewer.seen === null
          ? 'hasn’t opened it'
          : reviewer.seen === latest
            ? 'seen the latest'
            : `seen v${reviewer.seen}`}
      </span>
    )
  if (!theirs) {
    return (
      <span className="review-panel-state">
        Not yet
        {seen}
      </span>
    )
  }
  const on = theirs.version !== latest ? ` v${theirs.version}` : ''
  return (
    <span className={`review-panel-state is-${theirs.verdict}`}>
      {theirs.verdict === 'approve' ? 'Approved' : theirs.verdict === 'reject' ? 'Rejected' : 'Changes requested'}
      {on}
      {seen}
    </span>
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

export interface ReviewFormProps {
  latest: number
  pending: number
  verdicts: boolean
  onReview: ReviewPanelProps['onReview']
  onDiscard: ReviewPanelProps['onDiscard']
}

/**
 * Your review, the idea's main action for someone asked to give one: a button (in the idea's bar,
 * the one place it is), then the form in a dialog. Nothing for someone who can't review and has
 * nothing pending.
 */
export function ReviewButton(props: ReviewPanelProps) {
  const [open, setOpen] = useState(false)
  const closed = props.status.status === 'closed'
  const pending = props.pending ?? 0
  if (!(props.canReview && !closed) && pending === 0) {
    return null
  }
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {pending > 0 ? `Finish your review (${pending})` : 'Give your review'}
      </Button>
      <ReviewDialog
        open={open}
        onClose={() => setOpen(false)}
        latest={props.latest}
        pending={pending}
        // a verdict needs someone who may give one, on an open idea
        verdicts={props.canReview && !closed}
        onReview={props.onReview}
        onDiscard={props.onDiscard}
      />
    </>
  )
}

/** The review form in a dialog: from the overview's button, or over the document from its toolbar. */
export function ReviewDialog(props: ReviewFormProps & { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={props.open} title={`Your review of v${props.latest}`} onClose={props.onClose}>
      <ReviewForm
        {...props}
        onCancel={props.onClose}
        onReview={async (verdict, body) => {
          await props.onReview(verdict, body)
          props.onClose()
        }}
        onDiscard={
          props.onDiscard &&
          (() => {
            props.onDiscard?.()
            props.onClose()
          })
        }
      />
    </Dialog>
  )
}

function ReviewForm({ pending, verdicts, onReview, onDiscard, onCancel }: ReviewFormProps & { onCancel: () => void }) {
  // 'none': just your pending comments, with no verdict
  const [verdict, setVerdict] = useState<Verdict | 'none'>(verdicts ? 'approve' : 'none')
  const choices = [
    ...(verdicts ? CHOICES : []),
    ...(pending > 0 ? [{ value: 'none' as const, label: 'Just my comments' }] : []),
  ]
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // a summary goes only with a verdict
  const tooLong = verdict !== 'none' && body.length > COMMENT_LIMIT
  const send = async () => {
    if (tooLong) {
      return
    }
    setSending(true)
    setError(null)
    try {
      await onReview(verdict === 'none' ? null : verdict, verdict === 'none' ? '' : body.trim())
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
      {pending > 0 && (
        <p className="review-panel-pending">
          {pending === 1 ? '1 pending comment goes' : `${pending} pending comments go`} out with it: only you see{' '}
          {pending === 1 ? 'it' : 'them'} until then.
        </p>
      )}
      {choices.length > 1 && (
        <SegmentedControl label="Your verdict" options={choices} value={verdict} onChange={setVerdict} />
      )}
      {verdict !== 'none' && (
        <MarkdownEditor
          rows={3}
          value={body}
          placeholder="A summary, if it needs one"
          label="Summary"
          limit={COMMENT_LIMIT}
          onChange={setBody}
          onSubmit={() => void send()}
        />
      )}
      {error && <p className="review-panel-error">{error}</p>}
      <div className="review-panel-buttons">
        {pending > 0 && onDiscard && (
          <Button variant="ghost" onClick={onDiscard}>
            Discard pending comments
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={sending || tooLong}>
          {sending ? 'Sending…' : verdict === 'none' ? 'Publish my comments' : 'Submit review'}
        </Button>
      </div>
    </form>
  )
}

function Close(props: { onClose: ReviewPanelProps['onClose']; blocked: ReviewRow[]; unmet: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Close…</Button>
      <CloseDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  )
}

/** Closing an idea: as accepted once nothing stands in the way, or as rejected, with a note. */
export function CloseDialog({
  onClose,
  blocked,
  unmet,
  open,
  onOpenChange: setOpen,
}: {
  onClose: ReviewPanelProps['onClose']
  blocked: ReviewRow[]
  /** Requirements not met yet. */
  unmet: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const stopped = blocked.length > 0 || unmet > 0
  const [reason, setReason] = useState<ClosedReason>(stopped ? 'rejected' : 'accepted')
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
              disabled={reason === 'accepted' && stopped}
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
          {reason === 'accepted' && unmet > 0 && (
            <p className="review-panel-blocked">
              Its team’s approval requirements aren’t met yet: it can be closed as accepted once they are.
            </p>
          )}
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
  // done once or twice an idea: behind a button until then
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <div>
        <Button size="sm" variant="link" onClick={() => setAsking(true)}>
          + Ask for a review
        </Button>
      </div>
    )
  }
  return <AskForm onAsk={onAsk} onDone={() => setAsking(false)} />
}

function AskForm({ onAsk, onDone }: { onAsk: NonNullable<ReviewPanelProps['onAsk']>; onDone: () => void }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="review-panel-ask"
      onSubmit={(event) => {
        event.preventDefault()
        if (!picked || (picked.kind !== 'user' && picked.kind !== 'group')) {
          return
        }
        setError(null)
        onAsk({ kind: picked.kind, id: picked.id }, true).then(
          () => {
            setPicked(null)
            onDone()
          },
          (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
        )
      }}
    >
      <div className="review-panel-ask-who">
        <SubjectPicker label="Who to ask" value={picked} onChange={setPicked} kinds={['user', 'group']} />
      </div>
      <Button size="sm" type="submit" disabled={!picked}>
        Ask to review
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      {error && <p className="review-panel-error">{error}</p>}
    </form>
  )
}

function Reopen({ onReopen }: { onReopen: () => void }) {
  return <Button onClick={onReopen}>Reopen</Button>
}
