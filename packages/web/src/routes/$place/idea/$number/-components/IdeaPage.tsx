// The idea page, from data: the idea and its files on the left, the file in
// the middle with its comments marked, and on the right the comments level
// with their text, or the versions. Selecting text offers commenting on it or
// its section, or suggesting an edit; people with edit access accept or reject
// suggestions, one at a time or all together as one version. While editing,
// the page gives the document and the panel (IdeaEditor, EditPanel). Comparing shows the file as a redline against an earlier
// version, with the comments as a list. The route loads the data and does the
// writing.
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { markdownTree } from '@ideaf/core'
import {
  type Actor,
  Button,
  changedRanges,
  CommentGutter,
  headings,
  IdeaPageLayout,
  Link,
  MarkdownView,
  Redline,
  redline,
  renderMermaid,
  Select,
  SelectionMenu,
  Stack,
  Tabs,
  type TextSelection,
  Toc,
} from '@ideaf/ui'
import { VersionList, type VersionListProps } from './VersionList.tsx'
import type { Placement } from './view.ts'
import { CommentBox } from './CommentBox.tsx'
import { type PageComment, type ThreadActions, ThreadCard } from './ThreadCard.tsx'
import './IdeaPage.css'

export type { PageComment } from './ThreadCard.tsx'

export interface IdeaPageProps extends ThreadActions {
  /** The file's Markdown as it's written, in place of the rendered document. */
  showSource?: boolean
  /** A comment to open where it is (a link from the overview): active, and its text scrolled to. */
  opened?: string | undefined
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
  /** `pending`: added to the review rather than sent now. */
  onComment?: (selection: TextSelection, body: string, pending: boolean) => void
  /** A comment on the whole file: the box at the end of the comments. */
  onFileComment?: (body: string, pending: boolean) => void
  /** What a suggestion on a selection replaces (whole formatting), or null where there can't be one. */
  suggestionOf?: (selection: TextSelection) => string | null
  onSuggest?: (selection: TextSelection, replacement: string, body: string, pending: boolean) => void
  onSectionComment?: (heading: number, body: string, pending: boolean) => void
  /** Editing: the document and the panel, in place of the file and its comments. */
  editing?: { document: ReactNode; panel: ReactNode; bar?: ReactNode } | null
}

type Pane = 'comments' | 'versions'

export function IdeaPage(props: IdeaPageProps) {
  const { source, canComment, compare, canDecide = false } = props
  const document = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(props.opened ?? null)
  // a comment linked to: its text, in view
  useEffect(() => {
    const opened = props.opened
    if (!opened) {
      return
    }
    setActive(opened)
    const frame = requestAnimationFrame(() =>
      window.document.querySelector(`[data-comment-id="${CSS.escape(opened)}"]`)?.scrollIntoView({ block: 'center' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [props.opened])
  const [pane, setPane] = useState<Pane>(compare ? 'versions' : 'comments')
  const tree = useMemo(() => markdownTree(source), [source])
  const sections = useMemo(() => headings(tree), [tree])
  const base = useMemo(
    () => (compare ? { source: compare.source, tree: markdownTree(compare.source) } : null),
    [compare],
  )
  // what changed since the base: the sections the contents marks
  const changed = useMemo(() => (base ? changedRanges(redline(base, { source, tree })) : []), [base, source, tree])
  // the panel's filters: open, resolved or all, and by whom
  const [showing, setShowing] = useState<'open' | 'resolved' | 'all'>('open')
  // the contents start open only where the rail is a column of its own (IdeaPageLayout's widest layout)
  const [contentsOpen, setContentsOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 75.0625rem)').matches,
  )
  const [author, setAuthor] = useState('')
  const open = props.comments.filter((comment) => !comment.info.resolved)
  const authors = [...new Map(props.comments.map((c) => [actorKey(c.info.author), actorName(c.info.author)])).entries()]
  const shown = props.comments.filter(
    (c) =>
      (showing === 'all' || (showing === 'open') === !c.info.resolved) &&
      (!author || actorKey(c.info.author) === author),
  )
  const inText = shown.filter((c) => c.place.kind === 'text' || c.place.kind === 'section')
  const onFile = shown.filter((c) => c.place.kind === 'file')
  const outdated = shown.filter((c) => c.place.kind === 'outdated')
  // the suggestions that can be accepted now
  const acceptable = canDecide
    ? open.filter((c) => c.info.suggestion?.state === 'open' && !c.info.outdated && !c.pending).map((c) => c.info.id)
    : []

  const card = (comment: PageComment, showTarget = false): ReactNode => (
    <ThreadCard
      comment={comment}
      actions={props}
      active={comment.info.id === active}
      onSelect={() => setActive(comment.info.id)}
      showTarget={showTarget}
    />
  )
  const list = (comments: PageComment[], showTarget = false) => (
    <Stack gap={2}>
      {comments.map((c) => (
        <div key={c.info.id}>{card(c, showTarget)}</div>
      ))}
    </Stack>
  )

  // the file's sections, for its contents
  const contents = sections
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
    })
  const nav = (
    <div className="idea-nav">
      <Stack gap={5}>
        {/* every file, as the overview lists them: the same left slot on every page */}
        {props.files.length > 0 && (
          <nav aria-label="Files">
            <h2 className="idea-rail-label">Files</h2>
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
        {/* open beside the document; a disclosure, closed to start, where the rail is a band across the top;
            left out for a file with no headings, rather than a heading over nothing */}
        {contents.length > 0 && (
          <details
            className="idea-contents"
            open={contentsOpen}
            onToggle={(event) => setContentsOpen(event.currentTarget.open)}
          >
            <summary className="idea-rail-label">Contents</summary>
            <Toc
              entries={contents}
              onJump={(entry) => window.document.getElementById(entry.id)?.scrollIntoView({ block: 'start' })}
            />
          </details>
        )}
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
      <div className="idea-comment-filters" role="group" aria-label="Which comments">
        <Select
          size="sm"
          aria-label="Show"
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
          value={showing}
          onChange={setShowing}
        />
        {authors.length > 1 && (
          <Select
            size="sm"
            aria-label="By"
            options={[{ value: '', label: 'Anyone' }, ...authors.map(([value, label]) => ({ value, label }))]}
            value={author}
            onChange={setAuthor}
          />
        )}
      </div>
      {/* at the top, in what's often empty space above the first comment level with its text */}
      {canComment && props.onFileComment && (
        <CommentBox
          label="Comment on the whole file"
          onComment={props.onFileComment}
          addToReview={props.addToReview ?? false}
          folded
        />
      )}
      {onFile.length > 0 && (
        <div className="idea-panel-group">
          <h3 className="idea-panel-label">On the whole file</h3>
          {list(onFile)}
        </div>
      )}
      {outdated.length > 0 && (
        <div className="idea-panel-group">
          <h3 className="idea-panel-label">Not in this version</h3>
          {list(outdated, true)}
        </div>
      )}
      <CommentGutter
        documentRef={document}
        active={active}
        notes={inText.map((c) => ({ id: c.info.id, content: card(c) }))}
        empty={
          onFile.length + outdated.length > 0
            ? undefined
            : props.comments.length > 0
              ? showing === 'resolved'
                ? 'No resolved comments.'
                : 'No open comments.'
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
          {!props.editing && (
            // shown only where the comments can't sit beside the text, and come after it (IdeaPage.css)
            <a className="idea-narrow-note" href="#idea-comments">
              {open.length === 0 ? 'Comments' : open.length === 1 ? '1 comment' : `${open.length} comments`} ↓
            </a>
          )}
          {base && !props.editing && !props.showSource && (
            <ChangeSummary
              sections={
                sections.filter((h) => {
                  const end = sectionEnd(sections, h)
                  return h.level >= 2 && changed.some((range) => range.start < end && h.offset < range.end)
                }).length
              }
              changes={changed.length}
              root={document}
            />
          )}
          {props.editing ? (
            props.editing.document
          ) : props.showSource ? (
            <pre className="idea-source">
              <code>{source}</code>
            </pre>
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
            enabled={canComment && !base && !props.editing && !props.showSource}
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
          // what to do, then the open threads: what an edit is usually answering
          <Stack gap={5}>
            {props.editing.panel}
            {open.length > 0 && (
              <div className="idea-panel-group">
                <h3 className="idea-panel-label">Open comments</h3>
                {list(open, true)}
              </div>
            )}
          </Stack>
        ) : (
          <div id="idea-comments">
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
          </div>
        )
      }
    />
  )
}

/** Who wrote a comment, as the author filter tells them apart: a person, or a bot. */
function actorKey(actor: Actor): string {
  return actor.kind === 'bot'
    ? `bot:${actor.bot}`
    : actor.kind === 'bot-for-person'
      ? `bot:${actor.bot}:${actor.person.id}`
      : actor.person.id
}
function actorName(actor: Actor): string {
  return actor.kind === 'bot'
    ? `${actor.bot} (bot)`
    : actor.kind === 'bot-for-person'
      ? `${actor.bot} for ${actor.person.name}`
      : actor.person.name
}

/** A comment on the whole file, at the end of the comments. */
/** When comparing: how much changed, and a way from one change to the next. */
function ChangeSummary({
  sections,
  changes,
  root,
}: {
  sections: number
  changes: number
  root: RefObject<HTMLDivElement | null>
}) {
  const [at, setAt] = useState(-1)
  if (changes === 0) {
    return <p className="change-summary">Nothing changed in this file.</p>
  }
  const go = (step: number) => {
    const blocks = [...(root.current?.querySelectorAll<HTMLElement>('.rl') ?? [])]
    if (blocks.length === 0) {
      return
    }
    const next = (at + step + blocks.length) % blocks.length
    setAt(next)
    blocks[next]!.scrollIntoView({ block: 'center' })
  }
  return (
    <p className="change-summary" role="status">
      <span>
        {changes === 1 ? '1 change' : `${changes} changes`}
        {sections > 0 && ` in ${sections === 1 ? '1 section' : `${sections} sections`}`}
      </span>
      <Button size="sm" variant="ghost" onClick={() => go(-1)} aria-label="Previous change">
        ↑ Previous
      </Button>
      <Button size="sm" variant="ghost" onClick={() => go(1)} aria-label="Next change">
        ↓ Next
      </Button>
    </p>
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
