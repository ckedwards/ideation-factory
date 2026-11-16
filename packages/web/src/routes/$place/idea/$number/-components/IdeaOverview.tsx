// An idea's overview, like a pull request's conversation: what it is (its
// title, team, status and description), then everything that happened to it,
// oldest first: each version, each change of status, and each comment
// thread, which can be replied to and resolved here. Its reviews (ReviewPanel)
// are in a column beside them, as a pull request's reviewers and checks are,
// and come after the description on a narrow screen.
import { type ReactNode, useState } from 'react'
import { markdownTree } from '@ideaf/core'
import {
  type Actor,
  ActorLabel,
  Button,
  CommentCard,
  Empty,
  Link,
  LinkButton,
  MarkdownView,
  Page,
  PageHeader,
  RelativeTime,
  Section,
  StatusPill,
  TeamChip,
  type TeamRef,
} from '@ideaf/ui'
import type { ShownStatus } from '../../../../../ideas.ts'
import type { PageComment } from './IdeaPage.tsx'
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
      kind: 'comment'
      at: number
      comment: PageComment
      /** The file it's on, and where to read it there. */
      file: string | null
      href: string
    }

export interface IdeaOverviewProps {
  title: string
  team: TeamRef & { href?: string | undefined }
  status: ShownStatus
  /** The status as a control that moves it, for someone who can (IdeaStatus); its pill otherwise. */
  statusControl?: ReactNode
  /** More of the header's actions, after Subscribe and Sharing: closing or reopening it (CloseOrReopen). */
  actions?: ReactNode
  startedBy: Actor
  startedAt: number
  /** Markdown; empty when there's none. */
  description: string
  /** The idea's pages (IdeaTabs). */
  tabs: ReactNode
  /** Its reviews: status, reviewers and verdicts (ReviewPanel). */
  review?: ReactNode
  /** Who has access, and moving it. */
  sharingHref: string
  /** Subscribe / Unsubscribe (SubscribeButton). */
  subscribe?: ReactNode
  /** Oldest first. */
  activity: ActivityItem[]
  canComment: boolean
  onReply?: (comment: string, body: string) => void
  onResolve?: (comment: string, resolved: boolean) => void
}

export function IdeaOverview(props: IdeaOverviewProps) {
  return (
    <Page width="wide">
      <PageHeader
        title={props.title}
        actions={
          <span className="idea-overview-actions">
            {props.subscribe}
            <LinkButton href={props.sharingHref}>Sharing</LinkButton>
            {props.actions}
          </span>
        }
        sub={
          <span className="idea-overview-sub">
            <TeamChip team={props.team} href={props.team.href} />
            {props.statusControl ?? (
              <StatusPill
                status={props.status.status}
                {...(props.status.reason ? { reason: props.status.reason } : {})}
              />
            )}
            <span>
              Started by <ActorLabel actor={props.startedBy} short /> <RelativeTime at={props.startedAt} />
            </span>
          </span>
        }
      />
      {props.tabs}
      <div className={`idea-overview${props.review ? '' : ' idea-overview-alone'}`}>
        <div className="idea-overview-description">
          <Section title="Description">
            {props.description.trim() ? (
              <MarkdownView tree={markdownTree(props.description)} variant="compact" />
            ) : (
              <p className="idea-overview-none">No description.</p>
            )}
          </Section>
        </div>
        {props.review && <aside className="idea-overview-review">{props.review}</aside>}
        <div className="idea-overview-activity">
          <Section title="Activity">
            {props.activity.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ol className="idea-activity">
                {props.activity.map((item) =>
                  item.kind === 'version' ? (
                    <li key={`v${item.number}`} className="idea-activity-version">
                      <span>
                        <Link href={item.href}>v{item.number}</Link> · {describe(item)} by{' '}
                        <ActorLabel actor={item.by} short /> · <RelativeTime at={item.at} />
                      </span>
                      {item.changesHref && <Link href={item.changesHref}>What changed</Link>}
                    </li>
                  ) : item.kind === 'status' ? (
                    <li key={`s${item.at}`} className="idea-activity-version">
                      <span>
                        {statusWords(item)} by <ActorLabel actor={item.by} short /> · <RelativeTime at={item.at} />
                        {item.note && <span className="idea-activity-note">: {item.note}</span>}
                      </span>
                    </li>
                  ) : (
                    <li key={item.comment.info.id} className="idea-activity-comment">
                      {item.file && (
                        <div className="idea-activity-where">
                          On <Link href={item.href}>{item.file}</Link>
                        </div>
                      )}
                      <FeedThread item={item} {...props} />
                    </li>
                  ),
                )}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </Page>
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
  const on =
    info.target.kind === 'text'
      ? info.target.quote
      : info.target.kind === 'section'
        ? info.target.title
        : 'the whole file'
  return `on “${on.length > 40 ? `${on.slice(0, 40)}…` : on}”`
}

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
