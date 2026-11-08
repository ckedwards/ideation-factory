// The idea page, from data: the idea and its files on the left, the file in
// the middle with its comments marked, and on the right the comments level
// with their text, or the versions. Selecting text offers commenting on it or
// its section, or suggesting an edit; people with edit access accept or reject
// suggestions, one at a time or all together as one version. While editing,
// the page gives the document and the panel (IdeaEditor, EditPanel). Comparing shows the file as a redline against an earlier
// version, with the comments as a list. The route loads the data and does the
// writing.
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { markdownTree } from '@ideaf/core'
import {
  type Actor,
  ActorLabel,
  Button,
  changedRanges,
  CommentCard,
  type CommentInfo,
  CommentGutter,
  headings,
  IdeaHeading,
  IdeaPageLayout,
  Link,
  MarkdownView,
  Redline,
  redline,
  RelativeTime,
  renderMermaid,
  Section,
  SelectionMenu,
  Stack,
  StatusPill,
  Tabs,
  type TeamRef,
  type TextSelection,
  Toc,
} from '@ideaf/ui'
import { VersionList, type VersionListProps } from './VersionList.tsx'
import type { Placement } from './view.ts'
import type { ShownStatus } from '../../../../../ideas.ts'
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
  status: ShownStatus
  /** The version shown: its number, who made it and when. */
  version: { number: number; by: Actor; at: number }
  /** The idea's pages (IdeaTabs), under its heading. */
  tabs?: ReactNode
  /** The idea's files; listed when there's more than one. `changed`: since the version compared against. */
  files: { path: string; href: string; current: boolean; changed?: boolean }[]
  /** The file shown, as Markdown. */
  source: string
  /** Comparing: the file as it was in an earlier version (empty if it didn't exist then). */
  compare?: { base: number; source: string } | null
  /** Above the document: an older version, or what's being compared. */
  banner?: ReactNode
  /** The versions panel. */
  versions: VersionListProps
  comments: PageComment[]
  /** Commenting is offered only to someone who can, on the latest version. */
  canComment: boolean
  /** Accepting and rejecting suggestions: for people with edit access, on the latest version. */
  canDecide?: boolean
  /** Offer "Add to review": comments, suggestions and replies kept pending until the review is submitted. */
  addToReview?: boolean
  /** `pending`: added to the review rather than sent now. */
  onComment?: (selection: TextSelection, body: string, pending: boolean) => void
  /** What a suggestion on a selection replaces (whole formatting), or null where there can't be one. */
  suggestionOf?: (selection: TextSelection) => string | null
  onSuggest?: (selection: TextSelection, replacement: string, body: string, pending: boolean) => void
  /** Accepts suggestions as one new version. */
  onAccept?: (suggestions: string[]) => void
  /** Accepts suggestions into the idea's draft. */
  onAddToDraft?: (suggestions: string[]) => void
  onReject?: (suggestion: string) => void
  onSectionComment?: (heading: number, body: string, pending: boolean) => void
  onReply?: (comment: string, body: string, pending: boolean) => void
  /** Deletes one of your pending comments. */
  onDelete?: (comment: string) => void
  onResolve?: (comment: string, resolved: boolean) => void
  /** An outdated comment's "View in v3". */
  onViewInVersion?: (version: number) => void
  /** Editing: the document and the panel, in place of the file and its comments. */
  editing?: { document: ReactNode; panel: ReactNode } | null
}

type Pane = 'comments' | 'versions'

export function IdeaPage(props: IdeaPageProps) {
  const { source, canComment, compare, canDecide = false } = props
  const document = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>(compare ? 'versions' : 'comments')
  const tree = useMemo(() => markdownTree(source), [source])
  const sections = useMemo(() => headings(tree), [tree])
  const base = useMemo(
    () => (compare ? { source: compare.source, tree: markdownTree(compare.source) } : null),
    [compare],
  )
  // what changed since the base: the sections the contents marks
  const changed = useMemo(() => (base ? changedRanges(redline(base, { source, tree })) : []), [base, source, tree])
  // resolved comments aren't shown, for now
  const open = props.comments.filter((comment) => !comment.info.resolved)
  const inText = open.filter((c) => c.place.kind === 'text' || c.place.kind === 'section')
  const onFile = open.filter((c) => c.place.kind === 'file')
  const outdated = open.filter((c) => c.place.kind === 'outdated')
  // the suggestions that can be accepted now
  const acceptable = canDecide
    ? open.filter((c) => c.info.suggestion?.state === 'open' && !c.info.outdated && !c.pending).map((c) => c.info.id)
    : []

  const card = (comment: PageComment, showTarget = false): ReactNode => (
    <CommentCard
      comment={comment.info}
      active={comment.info.id === active}
      showTarget={showTarget}
      onSelect={() => setActive(comment.info.id)}
      onReply={
        canComment && !comment.pending && props.onReply
          ? (body, pending) => props.onReply?.(comment.info.id, body, pending)
          : undefined
      }
      addToReview={props.addToReview ?? false}
      onResolve={
        // a comment in your review goes out before it can be resolved
        canComment && !comment.pending && !comment.info.pending && props.onResolve
          ? (resolved) => props.onResolve?.(comment.info.id, resolved)
          : undefined
      }
      canDecide={canDecide && !comment.pending && !comment.info.pending}
      extra={
        comment.info.pending && !comment.pending && props.onDelete ? (
          <Button variant="link" size="sm" onClick={() => props.onDelete?.(comment.info.id)}>
            Delete
          </Button>
        ) : undefined
      }
      onAccept={props.onAccept ? () => props.onAccept?.([comment.info.id]) : undefined}
      onAddToDraft={props.onAddToDraft ? () => props.onAddToDraft?.([comment.info.id]) : undefined}
      onReject={props.onReject ? () => props.onReject?.(comment.info.id) : undefined}
      onViewInVersion={props.onViewInVersion}
    />
  )
  const list = (comments: PageComment[], showTarget = false) => (
    <Stack gap={2}>
      {comments.map((c) => (
        <div key={c.info.id}>{card(c, showTarget)}</div>
      ))}
    </Stack>
  )

  const nav = (
    <div className="idea-nav">
      <Stack gap={5}>
        <IdeaHeading
          title={props.title}
          team={props.team}
          status={
            <StatusPill
              status={props.status.status}
              {...(props.status.reason ? { reason: props.status.reason } : {})}
            />
          }
          meta={
            <>
              v{props.version.number} · <ActorLabel actor={props.version.by} short /> ·{' '}
              <RelativeTime at={props.version.at} />
            </>
          }
        />
        {props.tabs}
        {props.files.length > 1 && (
          <nav aria-label="Files">
            <ul className="idea-files">
              {props.files.map((file) => (
                <li key={file.path}>
                  <Link href={file.href} aria-current={file.current ? 'page' : undefined}>
                    {file.path}
                  </Link>
                  {file.changed && <span className="idea-file-changed"> · changed</span>}
                </li>
              ))}
            </ul>
          </nav>
        )}
        <Toc
          entries={sections
            .filter((heading) => heading.level >= 2 && heading.level <= 4)
            .map((heading) => {
              const end = sectionEnd(sections, heading)
              return {
                id: heading.id,
                title: heading.title,
                level: heading.level,
                changed: changed.some((range) => range.start < end && heading.offset < range.end),
                openComments: inText.filter((c) => within(c.place, heading.offset, end)).length,
              }
            })}
          onJump={(entry) => window.document.getElementById(entry.id)?.scrollIntoView({ block: 'start' })}
        />
      </Stack>
    </div>
  )

  const comments = base ? (
    // the redline has no marks to sit level with: a list, each saying what it's on
    open.length > 0 ? (
      list(open, true)
    ) : (
      <p className="idea-panel-note">No open comments.</p>
    )
  ) : (
    <Stack gap={4}>
      {acceptable.length > 1 && props.onAccept && (
        <div className="idea-suggestions">
          <span>{acceptable.length} suggested edits</span>
          <span className="idea-suggestions-buttons">
            <Button size="sm" variant="primary" onClick={() => props.onAccept?.(acceptable)}>
              Accept all as one version
            </Button>
            {props.onAddToDraft && (
              <Button size="sm" onClick={() => props.onAddToDraft?.(acceptable)}>
                Add all to draft
              </Button>
            )}
          </span>
        </div>
      )}
      {onFile.length > 0 && <Section title="On the whole file">{list(onFile)}</Section>}
      {outdated.length > 0 && <Section title="Not in this version">{list(outdated, true)}</Section>}
      <CommentGutter
        documentRef={document}
        active={active}
        notes={inText.map((c) => ({ id: c.info.id, content: card(c) }))}
        empty={
          onFile.length + outdated.length > 0
            ? undefined
            : props.comments.length > 0
              ? 'No open comments.'
              : canComment
                ? 'No comments yet. Select some text to comment on it.'
                : 'No comments yet.'
        }
      />
    </Stack>
  )

  return (
    <IdeaPageLayout
      nav={nav}
      document={
        <div ref={document}>
          {props.banner}
          {props.editing ? (
            props.editing.document
          ) : base ? (
            <Redline base={base} current={{ source, tree }} renderCode={renderMermaid} />
          ) : (
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
          )}
          <SelectionMenu
            documentRef={document}
            source={source}
            enabled={canComment && !base && !props.editing}
            addToReview={props.addToReview ?? false}
            {...(props.onComment ? { onComment: props.onComment } : {})}
            {...(props.onSuggest ? { onSuggest: props.onSuggest } : {})}
            {...(props.suggestionOf ? { suggestionOf: props.suggestionOf } : {})}
            {...(props.onSectionComment
              ? {
                  onSectionComment: (section, body, pending) =>
                    props.onSectionComment?.(section.heading, body, pending),
                }
              : {})}
          />
        </div>
      }
      panel={
        props.editing ? (
          props.editing.panel
        ) : (
          <Tabs
            label="Panel"
            tabs={[
              { id: 'comments', label: 'Comments', count: open.length },
              { id: 'versions', label: 'Versions' },
            ]}
            value={pane}
            onChange={setPane}
          >
            {pane === 'comments' ? comments : <VersionList {...props.versions} />}
          </Tabs>
        )
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
