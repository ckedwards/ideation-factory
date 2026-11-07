// An idea's overview, like a pull request's conversation: what it is (its
// title, team, status and description), then everything that happened to it,
// oldest first: each version, and each comment thread, which can be replied to
// and resolved here. Reviews and approvals join it in step 9.
import type { ReactNode } from 'react'
import { markdownTree } from '@ideaf/core'
import {
  type Actor,
  ActorLabel,
  CommentCard,
  Empty,
  type IdeaStatus,
  Link,
  MarkdownView,
  Page,
  PageHeader,
  RelativeTime,
  Section,
  StatusPill,
  TeamChip,
  type TeamRef,
} from '@ideaf/ui'
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
  status: IdeaStatus
  startedBy: Actor
  startedAt: number
  /** Markdown; empty when there's none. */
  description: string
  /** The idea's pages (IdeaTabs). */
  tabs: ReactNode
  /** Oldest first. */
  activity: ActivityItem[]
  canComment: boolean
  onReply?: (comment: string, body: string) => void
  onResolve?: (comment: string, resolved: boolean) => void
}

export function IdeaOverview(props: IdeaOverviewProps) {
  const { canComment } = props
  return (
    <Page>
      <PageHeader
        title={props.title}
        sub={
          <span className="idea-overview-sub">
            <TeamChip team={props.team} href={props.team.href} />
            <StatusPill status={props.status} />
            <span>
              Started by <ActorLabel actor={props.startedBy} short /> <RelativeTime at={props.startedAt} />
            </span>
          </span>
        }
      />
      {props.tabs}
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
              {props.activity.map((item) =>
                item.kind === 'version' ? (
                  <li key={`v${item.number}`} className="idea-activity-version">
                    <span>
                      <Link href={item.href}>v{item.number}</Link> · {describe(item)} by{' '}
                      <ActorLabel actor={item.by} short /> · <RelativeTime at={item.at} />
                    </span>
                    {item.changesHref && <Link href={item.changesHref}>What changed</Link>}
                  </li>
                ) : (
                  <li key={item.comment.info.id} className="idea-activity-comment">
                    {item.file && (
                      <div className="idea-activity-where">
                        On <Link href={item.href}>{item.file}</Link>
                      </div>
                    )}
                    <CommentCard
                      comment={item.comment.info}
                      onReply={
                        canComment && !item.comment.pending && props.onReply
                          ? (body) => props.onReply?.(item.comment.info.id, body)
                          : undefined
                      }
                      onResolve={
                        canComment && !item.comment.pending && props.onResolve
                          ? (resolved) => props.onResolve?.(item.comment.info.id, resolved)
                          : undefined
                      }
                    />
                  </li>
                ),
              )}
            </ol>
          )}
        </Section>
      </div>
    </Page>
  )
}
