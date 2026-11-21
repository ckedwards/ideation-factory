// The idea page, from data: the idea and its files on the left, the file in
// the middle with its comments marked, and on the right the comments level
// with their text, or the versions. Selecting text offers commenting on it or
// its section, or suggesting an edit; people with edit access accept or reject
// suggestions, one at a time or all together as one version. While editing,
// the page is the editor (DraftEditor), with its comments marked where the draft has them and level
// with their text as here; the draft heads the list of versions, with its changes. Comparing shows the file as a redline against an earlier
// version, with the comments as a list. The route loads the data and does the
// writing.
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { markdownTree } from '@ideaf/core'
import {
  type Actor,
  Button,
  type CardSize,
  changedRanges,
  CommentGutter,
  headings,
  IdeaPageLayout,
  Link,
  MarkdownView,
  Redline,
  redline,
  renderMermaid,
  SegmentedControl,
  Select,
  SelectionMenu,
  Stack,
  Tabs,
  type TextSelection,
  markSelector,
  Toc,
} from '@ideaf/ui'
import { plural } from '../../../../../plural.ts'
import { VersionList, type VersionListProps } from './VersionList.tsx'
import type { Placement } from './view.ts'
import type { Editing } from './editing.tsx'
import { type PageComment, type ThreadActions, ThreadCard } from './ThreadCard.tsx'
import './IdeaPage.css'

export type { PageComment } from './ThreadCard.tsx'

export interface IdeaPageProps extends ThreadActions {
  /** The file's Markdown as it's written, in place of the rendered document. */
  showSource?: boolean
  /** A comment to open where it is (a link from the overview): active, and its text scrolled to. */
  opened?: string | undefined
  /** The idea's files; listed when there's more than one. `changed`: since the version compared against. */
  files: { path: string; href: string; current: boolean; changed?: boolean; comments?: number }[]
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
  /** What a suggestion on a selection replaces (whole formatting), or null where there can't be one. */
  suggestionOf?: (selection: TextSelection) => string | null
  onSuggest?: (selection: TextSelection, replacement: string, body: string, pending: boolean) => void
  onSectionComment?: (heading: number, body: string, pending: boolean) => void
  /** Editing: the editor in place of the file, its comments where the draft has them, and its changes. */
  editing?: Pick<Editing, 'document' | 'draft' | 'places'> | null
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
      window.document.querySelector(markSelector(opened))?.scrollIntoView({ block: 'center' }),
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
  // where the panel comes after the document (IdeaPageLayout's one column), nothing in it is beside
  // the text: the comments on text are a list instead
  const narrow = useMatches('(max-width: 62.5rem)')
  // beside the text, or a list of every comment with what it's on (a narrow screen has only the list)
  const [view, setView] = useState<'beside' | 'list'>(storedView)
  const listed = narrow || view === 'list'
  const chooseView = (next: 'beside' | 'list') => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // no storage: the choice lasts as long as the page
    }
  }
  // while editing, each where the draft has it
  const editing = props.editing
  const all = editing
    ? props.comments.map((c) => {
        const place = editing.places.get(c.info.id)
        return place ? { ...c, place } : c
      })
    : props.comments
  const open = all.filter((comment) => !comment.info.resolved)
  const authors = [...new Map(all.map((c) => [actorKey(c.info.author), actorName(c.info.author)])).entries()]
  const shown = all.filter(
    (c) =>
      (showing === 'all' || (showing === 'open') === !c.info.resolved) &&
      (!author || actorKey(c.info.author) === author),
  )
  const inText = shown.filter((c) => c.place.kind === 'text' || c.place.kind === 'section' || c.place.kind === 'block')
  const onFile = shown.filter((c) => c.place.kind === 'file')
  // keys, as Google Docs has them: J and K for the next and previous comment on the text, R to reply
  // to the open one, E to resolve it, Escape to put it down. Not while typing
  const order = [...onFile, ...[...inText].sort((a, b) => at(a.place) - at(b.place))].map((c) => c.info.id)
  const keys = useRef({ order, active })
  keys.current = { order, active }
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) {
        return
      }
      const { order, active } = keys.current
      const open = (id: string | undefined) => {
        if (id === undefined) {
          return
        }
        event.preventDefault()
        setActive(id)
        window.document
          .querySelector(markSelector(id))
          ?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
      }
      const act = (action: string) => {
        const button = window.document.querySelector<HTMLElement>(
          `#idea-comments .comment-card.is-active [data-action="${action}"]`,
        )
        if (button) {
          event.preventDefault()
          button.click()
        }
      }
      const here = active === null ? -1 : order.indexOf(active)
      switch (event.key.toLowerCase()) {
        case 'j':
          open(order[here < 0 ? 0 : Math.min(here + 1, order.length - 1)])
          break
        case 'k':
          open(order[here < 0 ? order.length - 1 : Math.max(here - 1, 0)])
          break
        case 'r':
          act('reply')
          break
        case 'e':
          act('resolve')
          break
        case 'escape':
          if (active !== null) {
            event.preventDefault()
            setActive(null)
          }
          break
      }
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [])
  const outdated = shown.filter((c) => c.place.kind === 'outdated')
  // the suggestions that can be accepted now
  const acceptable = canDecide
    ? open.filter((c) => c.info.suggestion?.state === 'open' && !c.info.outdated && !c.pending).map((c) => c.info.id)
    : []

  const card = (
    comment: PageComment,
    showTarget = false,
    context = false,
    size: CardSize = 'full',
    onSelect = () => setActive(comment.info.id),
  ): ReactNode => (
    <ThreadCard
      comment={comment}
      actions={props}
      active={comment.info.id === active}
      onSelect={onSelect}
      showTarget={showTarget}
      context={context}
      size={size}
    />
  )
  const list = (comments: PageComment[], showTarget = false, context = false) => (
    <Stack gap={2}>
      {comments.map((c) => (
        <div key={c.info.id}>{card(c, showTarget, context)}</div>
      ))}
    </Stack>
  )

  // the list: the file's comments, then each section's in the order of the text, then the ones not
  // in this version
  const sectionOf = (offset: number) => sections.findLast((heading) => heading.offset <= offset)
  const groups: { key: string; title: string; comments: PageComment[] }[] = []
  if (onFile.length > 0) {
    groups.push({ key: 'file', title: 'On the whole file', comments: onFile })
  }
  for (const c of [...inText].sort((a, b) => at(a.place) - at(b.place))) {
    const section = sectionOf(at(c.place))
    const key = section ? `section:${section.offset}` : 'top'
    if (groups.at(-1)?.key !== key) {
      groups.push({ key, title: section?.title ?? 'Before the first heading', comments: [] })
    }
    groups.at(-1)!.comments.push(c)
  }
  if (outdated.length > 0) {
    groups.push({ key: 'outdated', title: 'Not in this version', comments: outdated })
  }
  // a comment chosen in the list: open, and its text in view
  const jumpTo = (id: string) => {
    setActive(id)
    window.document
      .querySelector(markSelector(id))
      ?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

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
                  {(file.comments ?? 0) > 0 && (
                    <span className="idea-file-comments" title={plural(file.comments!, 'open comment')}>
                      {file.comments}
                    </span>
                  )}
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

  const empty =
    all.length > 0
      ? showing === 'resolved'
        ? 'No resolved comments.'
        : 'No open comments.'
      : canComment
        ? 'No comments yet. Select some text to comment on it.'
        : 'No comments yet.'
  const comments = base ? (
    // the redline has no marks to sit level with: a list, each saying what it's on
    open.length > 0 ? (
      list(open, true)
    ) : (
      <p className="idea-panel-note">No open comments.</p>
    )
  ) : (
    <Stack gap={4}>
      {acceptable.length > 1 && props.onAddToDraft && (
        <div className="idea-suggestions">
          <span>{acceptable.length} suggested edits</span>
          <span className="idea-suggestions-buttons">
            <Button size="sm" variant="primary" onClick={() => props.onAddToDraft?.(acceptable)}>
              Add all to draft
            </Button>
          </span>
        </div>
      )}
      <div className="idea-comment-filters" role="group" aria-label="Which comments">
        {!narrow && (
          <SegmentedControl
            label="Comments shown"
            options={[
              { value: 'beside', label: 'Beside the text' },
              { value: 'list', label: 'List' },
            ]}
            value={view}
            onChange={chooseView}
          />
        )}
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
      {listed ? (
        // every comment with what it's on: the file's, each section's in the order of the text, and
        // the ones not in this version at the end
        groups.length > 0 ? (
          <div className="idea-comment-list">
            {groups.map((group) => (
              <section key={group.key} className="idea-panel-group" aria-label={group.title}>
                <h3 className="idea-panel-label">
                  {group.title} · {group.comments.length}
                </h3>
                <Stack gap={2}>
                  {group.comments.map((c) => (
                    <div key={c.info.id}>{card(c, true, true, 'full', () => jumpTo(c.info.id))}</div>
                  ))}
                </Stack>
              </section>
            ))}
          </div>
        ) : (
          <p className="idea-panel-note">{empty}</p>
        )
      ) : (
        <>
          {outdated.length > 0 && (
            <p className="idea-panel-note idea-outdated-note">
              {outdated.length === 1 ? '1 comment' : `${outdated.length} comments`} not in this version ·{' '}
              <Button variant="link" size="sm" onClick={() => chooseView('list')}>
                Show in the list
              </Button>
            </p>
          )}
          <CommentGutter
            documentRef={document}
            active={active}
            // the file's own beside its line (FileLine, in the toolbar), then the rest beside their text
            notes={[
              ...onFile.map((c) => ({ id: c.info.id, content: (size: CardSize) => card(c, true, false, size) })),
              ...inText.map((c) => ({ id: c.info.id, content: (size: CardSize) => card(c, false, false, size) })),
            ]}
            empty={outdated.length > 0 ? undefined : empty}
          />
        </>
      )}
    </Stack>
  )

  return (
    <IdeaPageLayout
      nav={nav}
      document={
        <div
          ref={document}
          // a click off a comment's mark puts its card down
          onClick={(event) => {
            if (!(event.target as Element).closest('[data-comment-id]')) {
              setActive(null)
            }
          }}
        >
          {/* where the whole file's comments are, for the gutter: the top of the file, by its line */}
          <span className="idea-file-anchors" aria-hidden>
            {onFile.map((c) => (
              <span key={c.info.id} data-comment-id={c.info.id} />
            ))}
          </span>
          {/* while editing, the editor's own bar is at the top, and the file's name under it */}
          {!props.editing && props.banner}
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
            props.editing.document({
              shown: inText.map((c) => ({ id: c.info.id, resolved: c.info.resolved })),
              active,
              onSelect: setActive,
            })
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
              blockMarks={inText.flatMap((c) =>
                c.place.kind === 'block' ? [{ id: c.info.id, block: c.place.start, active: c.info.id === active }] : [],
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
        // while editing too: the comments, what an edit usually answers, and the versions, headed by
        // the draft with its changes
        <div
          id="idea-comments"
          // a click in the column, off any card, puts the open one down
          onClick={(event) => {
            if (!(event.target as Element).closest('.comment-card, button, a, select, input, textarea, [role="tab"]')) {
              setActive(null)
            }
          }}
        >
          <Tabs
            label="Panel"
            tabs={[
              { id: 'comments', label: 'Comments', count: open.length },
              { id: 'versions', label: 'Versions' },
            ]}
            value={pane}
            onChange={setPane}
          >
            {pane === 'comments' ? (
              comments
            ) : (
              <VersionList {...props.versions} {...(props.editing ? { draft: props.editing.draft } : {})} />
            )}
          </Tabs>
        </div>
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

/** Where in the file a comment is: its text's start, or its section's heading; -1 for neither. */
function at(place: Placement): number {
  return place.kind === 'text' || place.kind === 'block' ? place.start : place.kind === 'section' ? place.heading : -1
}

function within(place: Placement, start: number, end: number): boolean {
  const offset = at(place)
  return offset >= start && offset < end
}

/** Where the choice of beside the text or a list is kept, for this browser. */
const VIEW_KEY = 'ideaf:comments:view'

function storedView(): 'beside' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'beside'
  } catch {
    return 'beside'
  }
}

/** Whether a key went to something being typed in: a box, a menu, or the editor. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null)
  )
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Whether a media query matches, now and as it changes. */
function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const changed = () => setMatches(list.matches)
    changed()
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [query])
  return matches
}
