// An idea's overview, like a pull request's conversation, in the idea's three
// slots (IdeaPageLayout), inside its frame: on the left its files, each a link
// to read it, and its details (team, who started it, its latest version, its
// address); in the centre what it is (its description), then everything that
// happened to it, oldest first: each version, each change of status, each
// review and each comment thread, which can be replied to and resolved here,
// and at the end a box for a comment on the idea as a whole; on the right its
// review (ReviewPanel).
import { type ReactNode, useState } from 'react'
import { markdownTree } from '@ideaf/core'
import {
  type Actor,
  ActorLabel,
  Button,
  CommentCard,
  CopyText,
  Empty,
  IdeaPageLayout,
  Link,
  MarkdownView,
  RelativeTime,
  Section,
  TeamChip,
  type TeamRef,
} from '@ideaf/ui'
import type { ShownStatus } from '../../../../../ideas.ts'
import type { PageComment } from './IdeaPage.tsx'
import { CommentBox } from './CommentBox.tsx'
import { describe, type VersionInfo } from './VersionList.tsx'
import './IdeaOverview.css'

export type ActivityItem =
  | (VersionInfo & {
      kind: 'version'
      /** The version's files, and what changed in it. */
      href: string
      changesHref: string | null
    })
  | { kind: 'status'; at: number; status: ShownStatus; by: Actor; note: string; reopened: boolean }
  | {
      kind: 'requested'
      at: number
      /** Who asked; null when its team's rules did. */
      by: Actor | null
      /** Who was asked, by name. */
      who: string
    }
  | {
      kind: 'review'
      at: number
      by: Actor
      verdict: 'approve' | 'request-changes' | 'reject'
      version: number
      body: string
      /** Dismissed since: who, and why. */
      dismissed: { by: Actor; reason: string } | null
    }
  | {
      kind: 'comment'
      at: number
      comment: PageComment
      /** The file it's on, and where to read it there; neither for one on the idea as a whole. */
      file: string | null
      href: string | null
    }

export interface IdeaOverviewProps {
  /** Its files, each a link straight to it: reading it is one obvious click away. */
  files: Array<{ path: string; href: string }>
  /** What used to crowd the title: its team, who started it and when, its latest version, its address. */
  team: TeamRef & { href?: string | undefined }
  startedBy: Actor
  startedAt: number
  latest: { number: number; at: number }
  /** Its address, as people paste it and the cli takes it: mobile/idea/9. */
  address: string
  /** Markdown; empty when there's none. */
  description: string
  /** Its reviews: requirements, reviewers and verdicts (ReviewPanel). */
  review?: ReactNode
  /** Oldest first. */
  activity: ActivityItem[]
  canComment: boolean
  onReply?: (comment: string, body: string) => void
  onResolve?: (comment: string, resolved: boolean) => void
  /** A comment on the idea as a whole, or (`pending`) one in your review. */
  onComment?: (body: string, pending: boolean) => void
  /** Whether a comment can go in your review instead. */
  addToReview?: boolean
}

/** The overview, in the idea's three slots: its files and details, what it is and what happened, its review. */
export function IdeaOverview(props: IdeaOverviewProps) {
  return (
    <IdeaPageLayout
      nav={
        <div className="idea-overview-nav">
          <nav aria-label="Files">
            <h2 className="idea-overview-label">Files</h2>
            <ul className="idea-overview-files">
              {props.files.map((f) => (
                <li key={f.path}>
                  <Link href={f.href}>{f.path}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="idea-overview-label">Details</h2>
            <dl className="idea-overview-details">
              <dt>Team</dt>
              <dd>
                <TeamChip team={props.team} href={props.team.href} />
              </dd>
              <dt>Started by</dt>
              <dd>
                <ActorLabel actor={props.startedBy} short /> <RelativeTime at={props.startedAt} />
              </dd>
              <dt>Latest</dt>
              <dd>
                v{props.latest.number} · <RelativeTime at={props.latest.at} />
              </dd>
              <dt>Address</dt>
              <dd>
                <CopyText text={props.address} label="The idea’s address" />
              </dd>
            </dl>
          </div>
        </div>
      }
      document={
        <div className="idea-overview">
          <Section title="Description">
            {props.description.trim() ? (
              <MarkdownView tree={markdownTree(props.description)} variant="compact" />
            ) : (
              <p className="idea-overview-none">No description.</p>
            )}
          </Section>
          <Section title="Activity">
            {props.activity.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ol className="idea-activity">
                {props.activity.map((item) => (
                  <ActivityRow key={keyOf(item)} item={item} {...props} />
                ))}
              </ol>
            )}
            {props.canComment && props.onComment && (
              <div className="idea-activity-comment-box">
                <CommentBox
                  label="Comment on the idea"
                  onComment={props.onComment}
                  addToReview={props.addToReview ?? false}
                />
              </div>
            )}
          </Section>
        </div>
      }
      panel={props.review}
    />
  )
}

const keyOf = (item: ActivityItem): string =>
  item.kind === 'version'
    ? `v${item.number}`
    : item.kind === 'requested'
      ? `q${item.at}${item.who}`
      : item.kind === 'review'
        ? `r${item.at}`
        : item.kind === 'status'
          ? `s${item.at}`
          : item.comment.info.id

/** One thing that happened, as the activity lists it. */
function ActivityRow({ item, ...props }: IdeaOverviewProps & { item: ActivityItem }) {
  return item.kind === 'version' ? (
    <li className="idea-activity-version">
      <span>
        <Link href={item.href}>v{item.number}</Link> · {describe(item)} by <ActorLabel actor={item.by} short /> ·{' '}
        <RelativeTime at={item.at} />
      </span>
      {item.changesHref && <Link href={item.changesHref}>What changed</Link>}
    </li>
  ) : item.kind === 'requested' ? (
    <li className="idea-activity-version">
      <span>
        {item.by ? (
          <>
            <ActorLabel actor={item.by} short /> asked {item.who} to review
          </>
        ) : (
          <>Its team’s rules asked {item.who} to review</>
        )}{' '}
        · <RelativeTime at={item.at} />
      </span>
    </li>
  ) : item.kind === 'review' ? (
    <li className={`idea-activity-version idea-activity-review is-${item.verdict}`}>
      <span>
        <ActorLabel actor={item.by} short /> {VERDICT[item.verdict]} v{item.version} · <RelativeTime at={item.at} />
        {item.dismissed && (
          <span className="idea-activity-note">
            {' '}
            · dismissed by <ActorLabel actor={item.dismissed.by} short />: {item.dismissed.reason}
          </span>
        )}
      </span>
      {item.body && (
        <div className="idea-activity-said">
          <MarkdownView tree={markdownTree(item.body)} variant="compact" />
        </div>
      )}
    </li>
  ) : item.kind === 'status' ? (
    <li className="idea-activity-version">
      <span>
        {statusWords(item)} by <ActorLabel actor={item.by} short /> · <RelativeTime at={item.at} />
        {item.note && <span className="idea-activity-note">: {item.note}</span>}
      </span>
    </li>
  ) : (
    <li className="idea-activity-comment">
      {item.file && item.href && (
        <div className="idea-activity-where">
          On <Link href={item.href}>{item.file}</Link>
        </div>
      )}
      <FeedThread item={item} {...props} />
    </li>
  )
}

/** A thread in the activity, with what it's on; a resolved one folded to a line until it's opened. */
function FeedThread({
  item,
  canComment,
  onReply,
  onResolve,
}: IdeaOverviewProps & { item: Extract<ActivityItem, { kind: 'comment' }> }) {
  const { info, pending } = item.comment
  const [open, setOpen] = useState(!info.resolved)
  const comments = 1 + info.replies.length
  if (!open) {
    return (
      <div className="idea-activity-folded">
        <ActorLabel actor={info.author} short />
        <span>
          · resolved · {comments === 1 ? '1 comment' : `${comments} comments`} · <RelativeTime at={info.at} />
        </span>
        <Button size="sm" variant="link" onClick={() => setOpen(true)} aria-label={`Show the thread ${summary(info)}`}>
          Show
        </Button>
      </div>
    )
  }
  return (
    <CommentCard
      comment={info}
      context
      onReply={canComment && !pending && onReply ? (body) => onReply(info.id, body) : undefined}
      onResolve={
        // one in your pending review goes out before it can be resolved
        canComment && !pending && !info.pending && onResolve ? (resolved) => onResolve(info.id, resolved) : undefined
      }
      extra={
        info.resolved ? (
          <Button size="sm" variant="link" onClick={() => setOpen(false)}>
            Hide
          </Button>
        ) : undefined
      }
    />
  )
}

/** The start of what a thread's on, to tell folded threads apart. */
function summary(info: Extract<ActivityItem, { kind: 'comment' }>['comment']['info']): string {
  // a block is named by its kind, not quoted
  if (info.target.kind === 'block') {
    return `on a ${info.target.label.toLowerCase()}`
  }
  const on =
    info.target.kind === 'text'
      ? info.target.quote
      : info.target.kind === 'section'
        ? info.target.title
        : info.target.kind === 'idea'
          ? 'the idea'
          : 'the whole file'
  return `on “${on.length > 40 ? `${on.slice(0, 40)}…` : on}”`
}

const VERDICT = { approve: 'approved', 'request-changes': 'requested changes to', reject: 'rejected' } as const

function statusWords(item: Extract<ActivityItem, { kind: 'status' }>): string {
  const { status, reason } = item.status
  if (status === 'closed') {
    return reason === 'rejected' ? 'Closed as rejected' : 'Closed as accepted'
  }
  if (item.reopened) {
    return `Reopened, ${status}`
  }
  return status === 'draft'
    ? 'Back to a draft'
    : status === 'requesting review'
      ? 'Out for review'
      : 'Changes in progress'
}
