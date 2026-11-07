// The idea page, from data: the idea and its files on the left, the file in
// the middle with its comments marked, and the comments level with their
// text on the right. Selecting text offers commenting on it or its section.
// The route loads the data and does the writing.
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { markdownTree } from '@ideaf/core'
import {
  type Actor,
  ActorLabel,
  CommentCard,
  type CommentInfo,
  CommentGutter,
  headings,
  IdeaHeading,
  IdeaPageLayout,
  type IdeaStatus,
  Link,
  MarkdownView,
  RelativeTime,
  renderMermaid,
  Section,
  SelectionMenu,
  Stack,
  StatusPill,
  type TeamRef,
  type TextSelection,
  Toc,
} from '@ideaf/ui'
import type { Placement } from './view.ts'
import './IdeaPage.css'

/** A comment, as shown, and where it goes in the file shown. */
export interface PageComment {
  info: CommentInfo
  place: Placement
  /** Not saved yet: shown, but not replied to or resolved until it is. */
  pending?: boolean
}

export interface IdeaPageProps {
  title: string
  team: TeamRef & { href?: string | undefined }
  status: IdeaStatus
  /** The version shown: its number, who made it and when. */
  version: { number: number; by: Actor; at: number }
  /** The idea's files; listed when there's more than one. */
  files: { path: string; href: string; current: boolean }[]
  /** The file shown, as Markdown. */
  source: string
  comments: PageComment[]
  /** Commenting is offered only to someone who can. */
  canComment: boolean
  onComment?: (selection: TextSelection, body: string) => void
  onSectionComment?: (heading: number, body: string) => void
  onReply?: (comment: string, body: string) => void
  onResolve?: (comment: string, resolved: boolean) => void
}

export function IdeaPage(props: IdeaPageProps) {
  const { source, canComment } = props
  const document = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const tree = useMemo(() => markdownTree(source), [source])
  const sections = useMemo(() => headings(tree), [tree])
  // resolved comments aren't shown, for now
  const open = props.comments.filter((comment) => !comment.info.resolved)
  const inText = open.filter((c) => c.place.kind === 'text' || c.place.kind === 'section')
  const onFile = open.filter((c) => c.place.kind === 'file')
  const outdated = open.filter((c) => c.place.kind === 'outdated')

  const card = (comment: PageComment, showTarget = false): ReactNode => (
    <CommentCard
      comment={comment.info}
      active={comment.info.id === active}
      showTarget={showTarget}
      onSelect={() => setActive(comment.info.id)}
      onReply={
        canComment && !comment.pending && props.onReply ? (body) => props.onReply?.(comment.info.id, body) : undefined
      }
      onResolve={
        canComment && !comment.pending && props.onResolve
          ? (resolved) => props.onResolve?.(comment.info.id, resolved)
          : undefined
      }
    />
  )

  const nav = (
    <div className="idea-nav">
      <Stack gap={5}>
        <IdeaHeading
          title={props.title}
          team={props.team}
          status={<StatusPill status={props.status} />}
          meta={
            <>
              v{props.version.number} · <ActorLabel actor={props.version.by} short /> ·{' '}
              <RelativeTime at={props.version.at} />
            </>
          }
        />
        {props.files.length > 1 && (
          <nav aria-label="Files">
            <ul className="idea-files">
              {props.files.map((file) => (
                <li key={file.path}>
                  <Link href={file.href} aria-current={file.current ? 'page' : undefined}>
                    {file.path}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <Toc
          entries={sections
            .filter((heading) => heading.level >= 2 && heading.level <= 4)
            .map((heading) => ({
              id: heading.id,
              title: heading.title,
              level: heading.level,
              openComments: inText.filter((c) => within(c.place, heading.offset, sectionEnd(sections, heading))).length,
            }))}
          onJump={(entry) => window.document.getElementById(entry.id)?.scrollIntoView({ block: 'start' })}
        />
      </Stack>
    </div>
  )

  return (
    <IdeaPageLayout
      nav={nav}
      document={
        <div ref={document}>
          <MarkdownView
            tree={tree}
            marks={inText.flatMap((c) =>
              c.place.kind === 'text'
                ? [{ id: c.info.id, start: c.place.start, end: c.place.end, active: c.info.id === active }]
                : [],
            )}
            sectionMarks={inText.flatMap((c) =>
              c.place.kind === 'section'
                ? [{ id: c.info.id, heading: c.place.heading, active: c.info.id === active }]
                : [],
            )}
            renderCode={renderMermaid}
            onMarkClick={setActive}
          />
          <SelectionMenu
            documentRef={document}
            source={source}
            enabled={canComment}
            {...(props.onComment ? { onComment: props.onComment } : {})}
            {...(props.onSectionComment
              ? { onSectionComment: (section, body) => props.onSectionComment?.(section.heading, body) }
              : {})}
          />
        </div>
      }
      panel={
        <Stack gap={4}>
          {onFile.length > 0 && (
            <Section title="On the whole file">
              <Stack gap={2}>
                {onFile.map((c) => (
                  <div key={c.info.id}>{card(c)}</div>
                ))}
              </Stack>
            </Section>
          )}
          {outdated.length > 0 && (
            <Section title="Not in this version">
              <Stack gap={2}>
                {outdated.map((c) => (
                  <div key={c.info.id}>{card(c, true)}</div>
                ))}
              </Stack>
            </Section>
          )}
          <CommentGutter
            documentRef={document}
            active={active}
            notes={inText.map((c) => ({ id: c.info.id, content: card(c) }))}
            empty={
              onFile.length + outdated.length === 0
                ? canComment
                  ? 'No comments yet. Select some text to comment on it.'
                  : 'No comments yet.'
                : undefined
            }
          />
        </Stack>
      }
    />
  )
}

/** Where a section ends: the next heading at its level or above, or the end of the file. */
function sectionEnd(sections: { offset: number; level: number }[], heading: { offset: number; level: number }) {
  return sections.find((h) => h.offset > heading.offset && h.level <= heading.level)?.offset ?? Infinity
}

function within(place: Placement, start: number, end: number): boolean {
  const at = place.kind === 'text' ? place.start : place.kind === 'section' ? place.heading : -1
  return at >= start && at < end
}
