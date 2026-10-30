// PROTOTYPE: the idea page. Three panes: file tree + contents on the left,
// the document (or the comments feed) in the middle, and a right panel with
// Comments, Versions and Details tabs.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { idea, me, target, users, type Actor, type Version } from './data'
import { ago, basename, fileChange, wrapSections } from './lib'
import { useStore } from './store'
import {
  ActorLabel,
  Avatar,
  CommentCard,
  FileCommentBox,
  MarkdownView,
  SelectionComposer,
  StatusControl,
  ThemeToggle,
  Toc,
  sectionCounts,
  tocEntries,
  useScrollSpy,
  type AnchorLayout,
  type TocEntry,
} from './shared'
import { useIdeaView, type FileEntry, type PlacedComment } from './useIdeaView'
import { Feed } from './Feed'
import './IdeaPage.css'


// Author filters, loosely following the cli.md filter names.
const WHO = {
  all: { label: 'Everyone', test: () => true },
  allusers: { label: 'People', test: (a: Actor) => a.kind === 'user' },
  alluserbots: { label: 'Bots for people', test: (a: Actor) => a.kind === 'userbot' },
  allbots: { label: 'Automated bots', test: (a: Actor) => a.kind === 'bot' },
  user: { label: 'Me', test: (a: Actor) => a.kind === 'user' && a.userId === me.id },
  mybot: { label: 'My bots', test: (a: Actor) => a.kind === 'userbot' && a.userId === me.id },
} as const
type Who = keyof typeof WHO

type Tree = { name: string; path: string; children: Tree[]; entry?: FileEntry }

function buildTree(entries: FileEntry[]): Tree {
  const root: Tree = { name: '', path: '', children: [] }
  for (const e of entries) {
    let node = root
    const parts = e.path.split('/')
    parts.forEach((p, i) => {
      let child = node.children.find((c) => c.name === p)
      if (!child) {
        child = { name: p, path: parts.slice(0, i + 1).join('/'), children: [] }
        node.children.push(child)
      }
      node = child
    })
    node.entry = e
  }
  // collapse single-child folders, like GitHub's PR tree
  const squash = (t: Tree): Tree => {
    t.children = t.children.map(squash)
    if (!t.entry && t.children.length === 1 && !t.children[0].entry && t.name)
      return { ...t.children[0], name: `${t.name}/${t.children[0].name}` }
    return t
  }
  return squash(root)
}

// What a version changed relative to the one before it.
function versionChanges(v: Version, prev: Record<string, string> | undefined) {
  const paths = [...new Set([...Object.keys(v.files), ...Object.keys(prev ?? {})])].sort()
  return paths
    .map((p) => ({ path: p, change: fileChange(prev?.[p], v.files[p]) }))
    .filter((c) => c.change !== 'unchanged')
}

// Anchored comments need the side-by-side layout; below this width B stacks.
function useNarrow() {
  const q = '(max-width: 75rem)'
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const f = () => setNarrow(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return narrow
}

type Slot = { el: HTMLElement; section: string; level: number; ids: string[] }

const BLOCKED = {
  comparing: 'Anchored view is off while comparing, so the changes have room. It comes back when you stop.',
  source: 'Anchored view needs the rendered document.',
  narrow: 'Anchored view needs a wider window.',
} as const

export function IdeaPage() {
  const view = useIdeaView()
  const { search, setSearch, version, latest, file, src, html, redline, changed, comments, entries } = view
  const [active, setActive] = useState<string | null>(null)
  const [panel, setPanel] = useState<'comments' | 'versions' | 'details'>('comments')
  const [onlyChanged, setOnlyChanged] = useState(true)
  const [source, setSource] = useState(false)
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open')
  const [who, setWho] = useState<Who>('all')
  const [onlySuggestions, setOnlySuggestions] = useState(false)
  const [mode, setMode] = useState<'anchored' | 'list'>('anchored')
  const narrow = useNarrow()
  const docRef = useRef<HTMLDivElement>(null)
  const docScrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const feed = search.view === 'feed'
  const old = version.n !== latest.n && !feed
  const comparing = !!redline && !feed
  // Anchored view: line comments ride beside their text, section comments
  // sit inside an outline around their section. Needs the rendered doc.
  const anchored = mode === 'anchored' && !comparing && !source && !narrow && !feed
  // Why Anchored can't show right now (the toggle explains instead of silently switching).
  const anchoredBlock = comparing ? 'comparing' : source ? 'source' : narrow ? 'narrow' : null
  const shownMode = anchored ? 'anchored' : 'list'
  // The feed already shows every comment, so the panel drops its Comments tab there.
  const shownPanel = feed && panel === 'comments' ? 'details' : panel
  const ideaOpen = view.state.comments.filter((c) => c.status === 'unresolved').length
  const baseName = search.compare === 'main' ? idea.target : search.compare ? `v${search.compare}` : idea.target

  const tree = useMemo(() => buildTree(onlyChanged ? entries.filter((e) => e.change !== 'unchanged') : entries), [entries, onlyChanged])
  const hiddenCount = entries.filter((e) => e.change === 'unchanged').length

  const filtered = comments.filter(
    (c) =>
      (status === 'all' || (status === 'open' ? c.status === 'unresolved' : c.status === 'resolved')) &&
      WHO[who].test(c.author) &&
      (!onlySuggestions || c.suggestion),
  )
  const groups = [
    { key: 'file', title: 'On this file', items: filtered.filter((c) => c.placement === 'file') },
    { key: 'anchored', title: 'In the text', items: filtered.filter((c) => c.placement === 'anchored') },
    { key: 'outdated', title: 'Outdated', items: filtered.filter((c) => c.placement === 'outdated') },
  ]
  const openCount = comments.filter((c) => c.status === 'unresolved').length
  // Table of contents for the current file, with the section you're reading.
  const toc = useMemo(() => tocEntries(src), [src])
  const tocCounts = sectionCounts(comments)
  const reading = useScrollSpy(
    () => docScrollRef.current,
    () => docScrollRef.current,
    48,
    [file, html, redline, source, anchored, feed],
  )
  const jumpTo = (e: TocEntry) => {
    const scroller = docScrollRef.current
    if (!scroller) return
    const target = source
      ? scroller.querySelector<HTMLElement>(`.vb-source > div:nth-child(${e.line + 1})`)
      : Array.from(scroller.querySelectorAll<HTMLElement>('[data-section]')).find((h) => h.dataset.section === e.title && /^H\d$/.test(h.tagName))
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const lineComments = filtered.filter((c) => c.placement === 'anchored' && c.anchor.type === 'selection')
  const sectionComments = filtered.filter((c) => c.placement === 'anchored' && c.anchor.type === 'section')
  const byId = new Map(filtered.map((c) => [c.id, c]))

  // Section boxes + slots for section comments (anchored view only).
  const [slots, setSlots] = useState<Slot[]>([])
  const onRendered = (root: HTMLDivElement) => {
    if (!anchored) {
      setSlots((s) => (s.length ? [] : s))
      return
    }
    wrapSections(root)
    const bySection = new Map<string, string[]>()
    for (const c of sectionComments) {
      const sec = (c.anchor as { section: string }).section
      bySection.set(sec, [...(bySection.get(sec) ?? []), c.id])
    }
    const next: Slot[] = []
    for (const [section, ids] of bySection) {
      const box = Array.from(root.querySelectorAll<HTMLElement>('section.sec-box')).find((b) => b.dataset.sec === section)
      if (!box) continue
      box.classList.add('has-comments')
      const el = document.createElement('div')
      el.className = 'sec-slot'
      el.dataset.slot = ''
      box.appendChild(el)
      next.push({ el, section, level: Number(box.dataset.level), ids })
    }
    setSlots(next)
  }

  // Highlight the active anchor (and its section box) without re-rendering the doc.
  useEffect(() => {
    const root = docRef.current
    if (!root) return
    root.querySelectorAll('mark.is-active, [data-section].is-active, .sec-box.is-active').forEach((m) => m.classList.remove('is-active'))
    if (!active) return
    root.querySelectorAll(`[data-comment-id="${active}"]`).forEach((m) => m.classList.add('is-active'))
    const c = comments.find((x) => x.id === active)
    if (c?.anchor.type === 'section')
      root.querySelector(`section.sec-box[data-sec="${CSS.escape(c.anchor.section)}"]`)?.classList.add('is-active')
  }, [active, slots, html])

  // Line comments in the anchored gutter: start level with their text, push
  // down to avoid overlap, and follow the document as it scrolls.
  const [layout, setLayout] = useState<AnchorLayout>({})
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [tops, setTops] = useState<Record<string, number>>({})
  const gutterRef = useRef<HTMLDivElement>(null)
  const gutterInner = useRef<HTMLDivElement>(null)
  const notes = lineComments.filter((c) => layout[c.id] !== undefined).sort((a, b) => layout[a.id] - layout[b.id])
  useLayoutEffect(() => {
    if (!anchored) return
    const next: Record<string, number> = {}
    let bottom = -Infinity
    for (const c of notes) {
      const t = Math.max(layout[c.id], bottom + 12)
      next[c.id] = t
      bottom = t + (noteRefs.current[c.id]?.offsetHeight ?? 0)
    }
    if (JSON.stringify(next) !== JSON.stringify(tops)) setTops(next)
  })
  useLayoutEffect(() => {
    const scroller = docScrollRef.current
    const root = docRef.current
    const g = gutterRef.current
    const inner = gutterInner.current
    if (!anchored || panel !== 'comments' || !scroller || !root || !g || !inner) return
    const sync = () => {
      inner.style.transform = `translateY(${root.getBoundingClientRect().top - g.getBoundingClientRect().top}px)`
    }
    sync()
    scroller.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    return () => {
      scroller.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  })

  // Clicking a highlight scrolls its thread into view, and vice versa.
  const [from, setFrom] = useState<'doc' | 'list'>('doc')
  const pickFromDoc = (id: string) => (setFrom('doc'), setPanel('comments'), setActive(id))
  const pickFromList = (id: string) => (setFrom('list'), setActive(id))
  useEffect(() => {
    if (!active) return
    if (from === 'doc' && anchored) return
    if (from === 'doc')
      listRef.current?.querySelector(`[data-card-id="${active}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    else docRef.current?.querySelector(`[data-comment-id="${active}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, from, panel, anchored, feed, file])

  return (
    <div className="vb">
      <aside className="vb-side">
        <div className="vb-brand">
          <span className="vb-logo">✳</span> Ideation Factory
        </div>

        <button className="vb-idea" onClick={() => setPanel('details')} title="Show details">
          <span className="vb-idea-title">{idea.title}</span>
          <span className={`vb-idea-status status-${view.state.status.replace(/ /g, '-')}`}>
            <span className="status-dot" aria-hidden /> {view.state.status[0].toUpperCase() + view.state.status.slice(1)}
          </span>
        </button>

        <nav className="vb-nav">
          <button className={feed ? 'on' : ''} onClick={() => setSearch({ view: 'feed' })} aria-current={feed ? 'page' : undefined}>
            <span aria-hidden>💬</span> Comments feed
            <span className="vb-count">{ideaOpen}</span>
          </button>
        </nav>

        <div className="vb-section-head">
          <span>{old ? <>Files in <span className="vb-old-tag">v{version.n}</span></> : 'Files'}</span>
          <div className="seg">
            <button className={onlyChanged ? 'on' : ''} onClick={() => setOnlyChanged(true)}>
              Changed
            </button>
            <button className={!onlyChanged ? 'on' : ''} onClick={() => setOnlyChanged(false)}>
              All {entries.length}
            </button>
          </div>
        </div>
        {comparing ? (
          <div className="vb-tree-base vb-tree-comparing" role="status">
            <span className="vb-tree-comparing-label">Comparing</span>
            <span>
              {onlyChanged ? 'Files changed' : 'Badges show changes'} since <b>{baseName}</b> → <b>v{version.n}</b>
            </span>
          </div>
        ) : (
          <div className="vb-tree-base">
            {onlyChanged ? 'Changed' : 'Badges show changes'} vs <b>{idea.target}</b>
          </div>
        )}
        <div className="vb-tree" role="tree">
          <TreeNode t={tree} depth={-1} file={feed ? '' : file} onPick={(p) => (setSearch({ file: p, view: undefined }), setActive(null))} />
          {onlyChanged && hiddenCount > 0 && (
            <div className="vb-tree-hidden">
              {hiddenCount} unchanged file{hiddenCount > 1 ? 's' : ''} hidden
            </div>
          )}
        </div>

        {!feed && (
          <>
            <div className="vb-section-head">
              <span>Contents</span>
              <span className="vb-toc-file" title={file}>
                {basename(file)}
              </span>
            </div>
            <Toc className="vb-toc" entries={toc} active={source ? null : reading} counts={tocCounts} changed={changed} onJump={jumpTo} />
          </>
        )}

        <div className="vb-side-foot">
          <ThemeToggle />
        </div>
      </aside>

      <main className="vb-main">
        {feed ? (
          <>
            <div className="vb-toolbar">
              <div className="vb-path">
                <b>Comments feed</b> <span className="muted">· everything on this idea, oldest first</span>
              </div>
              <select className="vb-feed-who" value={who} onChange={(e) => setWho(e.target.value as Who)} aria-label="Author filter">
                {Object.entries(WHO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="vb-doc">
              <Feed
                who={WHO[who]}
                onOpenComment={(c) => {
                  setSearch({ view: undefined, file: c.file, v: undefined, compare: undefined })
                  setPanel('comments')
                  setFrom('list')
                  setActive(c.id)
                }}
                onOpenVersion={(n, p) =>
                  setSearch({ view: undefined, file: p, v: n === latest.n ? undefined : n, compare: n === 1 ? 'main' : String(n - 1) })
                }
              />
            </div>
          </>
        ) : (
          <>
        <div className="vb-toolbar">
          <div className="vb-path mono">
            {file}
            {old && <span className="vb-path-version">@ v{version.n}</span>}
          </div>
          {comparing && (
            <span className="vb-chip vb-chip-compare">
              Changes {baseName} → v{version.n}
              <button className="link" onClick={() => setSearch({ compare: undefined })} aria-label="Stop comparing">
                ✕
              </button>
            </span>
          )}
          {source && (
            <span className="vb-chip">
              Markdown source
              <button className="link" onClick={() => setSource(false)} aria-label="Back to the rendered document">
                ✕
              </button>
            </span>
          )}
          {/* advanced: kept small and quiet */}
          <button
            className={`vb-icon-btn ${source ? 'on' : ''}`}
            onClick={() => setSource((v) => !v)}
            aria-pressed={source}
            aria-label={source ? 'Back to the rendered document' : 'View markdown source'}
            title={source ? 'Back to the rendered document' : 'View markdown source'}
          >
            {'</>'}
          </button>
        </div>

        {old && (
          <div className="vb-old-banner" role="status">
            <span className="vb-old-icon" aria-hidden>
              ●
            </span>
            <div className="vb-old-text">
              <span>
                <b>Older version: v{version.n}</b> · the latest is v{latest.n}
              </span>
              <span className="vb-old-meta">
                Uploaded {ago(version.at)} by <ActorLabel actor={version.author} short /> · read only
              </span>
            </div>
            <div className="vb-old-actions">
              <button className="link" onClick={() => setSearch({ v: undefined, compare: String(version.n) })}>
                What changed since v{version.n}
              </button>
              <button className="primary" onClick={() => setSearch({ v: undefined, compare: undefined })}>
                Back to latest
              </button>
            </div>
          </div>
        )}

        <div className={`vb-doc ${old ? 'is-old' : ''}`} ref={docScrollRef}>
          {source ? (
            <pre className="vb-source">
              {src.split('\n').map((l, i) => (
                <div key={i}>
                  <span className="ln">{i + 1}</span>
                  {l || ' '}
                </div>
              ))}
            </pre>
          ) : comparing ? (
            <MarkdownView html={redline!} onFileLink={(p) => setSearch({ file: p })} />
          ) : (
            <>
              <MarkdownView
                key={anchored ? 'anchored' : 'list'}
                rootRef={docRef}
                html={html}
                comments={filtered}
                changed={changed}
                onAnchorClick={pickFromDoc}
                onFileLink={(p) => setSearch({ file: p })}
                onLayout={anchored ? setLayout : undefined}
                onRendered={onRendered}
              />
              <SelectionComposer rootRef={docRef} file={file} version={version.n} enabled={version.n === latest.n} />
              {anchored &&
                slots.map((sl) =>
                  createPortal(
                    <>
                      <div className="sec-slot-label">
                        {sl.level === 1 ? 'Whole document' : `§ ${sl.section}`} · {sl.ids.length} comment{sl.ids.length > 1 ? 's' : ''}
                      </div>
                      {sl.ids.map((id) => {
                        const c = byId.get(id)
                        return c ? <CommentCard key={id} c={c} active={active === id} onSelect={setActive} showContext={false} /> : null
                      })}
                    </>,
                    sl.el,
                  ),
                )}
              {anchored && (
                <FileFooter
                  file={file}
                  version={version.n}
                  fileComments={groups[0].items}
                  lost={groups[2].items}
                  active={active}
                  onSelect={setActive}
                />
              )}
            </>
          )}
        </div>
          </>
        )}
      </main>

      <aside className="vb-panel">
        <div className="vb-panel-tabs" role="tablist">
          {!feed && (
            <button role="tab" aria-selected={shownPanel === 'comments'} className={shownPanel === 'comments' ? 'on' : ''} onClick={() => setPanel('comments')}>
              Comments <span className="tag">{openCount}</span>
            </button>
          )}
          <button role="tab" aria-selected={shownPanel === 'versions'} className={shownPanel === 'versions' ? 'on' : ''} onClick={() => setPanel('versions')}>
            Versions
            {comparing && <span className="tag tag-compare">comparing</span>}
          </button>
          <button role="tab" aria-selected={shownPanel === 'details'} className={shownPanel === 'details' ? 'on' : ''} onClick={() => setPanel('details')}>
            Details
          </button>
        </div>

        {shownPanel === 'comments' ? (
          <>
            <div className="vb-threads-head">
              <div className="vb-filters">
                <div className="seg" role="radiogroup" aria-label="Comment view">
                  {(['anchored', 'list'] as const).map((m) => (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={shownMode === m}
                      className={shownMode === m ? 'on' : ''}
                      disabled={m === 'anchored' && !!anchoredBlock}
                      onClick={() => setMode(m)}
                      title={
                        m === 'anchored'
                          ? anchoredBlock
                            ? BLOCKED[anchoredBlock]
                            : 'Comments beside their text, section comments under their section'
                          : 'All comments in one list'
                      }
                    >
                      {m === 'anchored' ? 'Anchored' : 'List'}
                    </button>
                  ))}
                </div>
                <div className="seg">
                  {(['open', 'resolved', 'all'] as const).map((s) => (
                    <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <select value={who} onChange={(e) => setWho(e.target.value as Who)} aria-label="Author filter">
                  {Object.entries(WHO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <label className="vb-check">
                  <input type="checkbox" checked={onlySuggestions} onChange={(e) => setOnlySuggestions(e.target.checked)} /> Suggestions
                </label>
              </div>
              {old && <div className="vb-hint vb-hint-old">Showing comments made up to v{version.n}. Newer comments are on later versions.</div>}
              {anchoredBlock && mode === 'anchored' && (
                <div className="vb-notice" role="status">
                  <span>{BLOCKED[anchoredBlock]}</span>
                  {anchoredBlock === 'comparing' && (
                    <button className="link" onClick={() => setSearch({ compare: undefined })}>
                      Stop comparing
                    </button>
                  )}
                  {anchoredBlock === 'source' && (
                    <button className="link" onClick={() => setSource(false)}>
                      Show rendered
                    </button>
                  )}
                </div>
              )}
              {comparing && mode === 'list' && <div className="vb-hint">Highlights are hidden while comparing.</div>}
              {anchored && (
                <div className="vb-hint">
                  Section comments sit under their section. Whole-file{groups[2].items.length > 0 ? ' and outdated' : ''} comments are at the end of the document.
                </div>
              )}
            </div>
            {anchored ? (
              <div
                className="vb-panel-body vb-gutter"
                ref={gutterRef}
                onWheel={(e) => docScrollRef.current?.scrollBy({ top: e.deltaY })}
              >
                <div className="vb-gutter-inner" ref={gutterInner}>
                  {notes.map((c) => (
                    <div
                      key={c.id}
                      className="vb-note"
                      ref={(el) => {
                        noteRefs.current[c.id] = el
                      }}
                      style={{ top: tops[c.id] ?? layout[c.id] }}
                    >
                      <CommentCard c={c} active={active === c.id} onSelect={pickFromList} />
                    </div>
                  ))}
                </div>
                {notes.length === 0 && <div className="vb-empty">No comments on lines of this file.</div>}
              </div>
            ) : (
            <div className="vb-panel-body" ref={listRef}>
              <FileCommentBox file={file} version={version.n} />
              {groups.map(
                (g) =>
                  g.items.length > 0 && (
                    <section key={g.key} className={`vb-group vb-group-${g.key}`}>
                      <h3>
                        {g.title} <span className="muted">{g.items.length}</span>
                      </h3>
                      {g.items.map((c) => (
                        <CommentCard key={c.id} c={c} active={active === c.id} onSelect={pickFromList} />
                      ))}
                    </section>
                  ),
              )}
              {filtered.length === 0 && <div className="vb-empty">No comments match these filters.</div>}
            </div>
            )}
          </>
        ) : (
          <div className="vb-panel-body">{shownPanel === 'versions' ? <Versions /> : <Details />}</div>
        )}
      </aside>
    </div>
  )
}

// End of the document: whole-file comments, plus an Outdated tab when any exist.
function FileFooter({
  file,
  version,
  fileComments,
  lost,
  active,
  onSelect,
}: {
  file: string
  version: number
  fileComments: PlacedComment[]
  lost: PlacedComment[]
  active: string | null
  onSelect: (id: string) => void
}) {
  const [tab, setTab] = useState<'file' | 'outdated'>('file')
  const current = lost.length > 0 ? tab : 'file'
  return (
    <section className="vb-foot" aria-label="Whole-file and outdated comments">
      <div className="vb-foot-tabs" role="tablist">
        <button role="tab" aria-selected={current === 'file'} className={current === 'file' ? 'on' : ''} onClick={() => setTab('file')}>
          Whole file <span className="tag">{fileComments.length}</span>
        </button>
        {lost.length > 0 && (
          <button role="tab" aria-selected={current === 'outdated'} className={current === 'outdated' ? 'on' : ''} onClick={() => setTab('outdated')}>
            Outdated <span className="tag tag-outdated">{lost.length}</span>
          </button>
        )}
      </div>
      <div className="vb-foot-body" role="tabpanel">
        {current === 'file' ? (
          <>
            {fileComments.map((c) => (
              <CommentCard key={c.id} c={c} active={active === c.id} onSelect={onSelect} showContext={false} />
            ))}
            {fileComments.length === 0 && <p className="vb-hint">No comments on the file as a whole yet.</p>}
            <FileCommentBox file={file} version={version} />
          </>
        ) : (
          <>
            <p className="vb-hint">The text these were on isn’t in this version. Each links to the last version where it was. Resolve them once they’re dealt with.</p>
            {lost.map((c) => (
              <CommentCard key={c.id} c={c} active={active === c.id} onSelect={onSelect} />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function Details() {
  const { setSearch, latest } = useIdeaView()
  const { state, dispatch } = useStore()
  const author = idea.ownerId === me.id

  return (
    <div className="vb-details">
      <section className="vb-d-section">
        <h3>Notifications</h3>
        <div className="vb-d-subscribe">
          <button
            className={state.subscribed ? '' : 'primary'}
            aria-pressed={state.subscribed}
            onClick={() => {
              dispatch({ type: 'setSubscribed', on: !state.subscribed })
            }}
          >
            {state.subscribed ? '🔕 Unsubscribe' : '🔔 Subscribe'}
          </button>
          <span className="hint">
            {state.subscribed
              ? author
                ? 'You’re getting notifications because you wrote this idea.'
                : 'You’re getting notifications for this idea.'
              : 'You won’t get notifications for this idea, except when someone asks you to review it.'}
          </span>
        </div>
      </section>

      <section className="vb-d-section">
        <h3>Idea</h3>
        <div className="vb-d-title">{idea.title}</div>
        <p className="vb-d-desc">{idea.description}</p>
        <div className="vb-kv">
          <span>Status</span>
          <span>
            <StatusControl />
          </span>
          <span>Author</span>
          <span className="actor">
            <Avatar userId={idea.ownerId} size="sm" />
            {users[idea.ownerId].name}
          </span>
          <span>Team</span>
          <span>{idea.team}</span>
          <span>Source</span>
          <span className="mono">
            {idea.repo} · {idea.branch}
          </span>
          <span>Target</span>
          <span className="mono">{idea.target}</span>
        </div>
      </section>

      <section className="vb-d-section">
        <h3>Reviewers</h3>
        <ul className="vb-d-reviewers">
          {idea.reviewers.map((r) =>
            r.kind === 'user' ? (
              <li key={r.userId}>
                <span className="actor">
                  <Avatar userId={r.userId} size="sm" />
                  <span className="actor-name">{users[r.userId].name}</span>
                </span>
                {r.lastSeenVersion === latest.n ? (
                  <span className="tag tag-ok">seen v{latest.n}</span>
                ) : (
                  <span className="vb-d-behind">
                    <span className="tag">last saw v{r.lastSeenVersion}</span>
                    <button className="link" onClick={() => setSearch({ compare: String(r.lastSeenVersion), v: undefined })}>
                      What's new for them
                    </button>
                  </span>
                )}
              </li>
            ) : (
              <li key={r.name}>
                <span className="tag">{r.name}</span>
                <span className="muted">{r.members.map((m) => users[m].name).join(', ')} · not opened yet</span>
              </li>
            ),
          )}
        </ul>
      </section>

    </div>
  )
}

function Versions() {
  const { state, search, setSearch, version, latest } = useIdeaView()
  const compare = search.compare
  const baseN = compare === 'main' ? 0 : compare ? Number(compare) : null // 0 = target branch
  const inRange = (n: number) => baseN !== null && n > baseN && n <= version.n
  const versions = [...state.versions].reverse()
  const seenBy = (n: number) => idea.reviewers.filter((r) => r.kind === 'user' && r.lastSeenVersion === n)

  return (
    <div className="vb-details">
      <section className="vb-d-section">
        <div className={`vb-d-range ${baseN !== null ? 'is-on' : ''}`}>
          <span>
            Viewing <VersionPicker /> · Compare: <BasePicker />
          </span>
          {baseN !== null && (
            <button className="link" onClick={() => setSearch({ compare: undefined })}>
              Clear
            </button>
          )}
        </div>
        <p className="vb-hint">
          Click a version to view it. To see what changed since an older version, pick it under <b>Compare</b> or press <b>Compare</b> on it
          below. The document then shows the changes.
        </p>
        <ol className="vb-timeline">
          {versions.map((v, i) => {
            const prev = state.versions.find((x) => x.n === v.n - 1)?.files
            const changes = versionChanges(v, prev)
            // show the parent folder when two changed files share a name
            const label = (p: string) =>
              changes.filter((c) => basename(c.path) === basename(p)).length > 1 ? p.split('/').slice(-2).join('/') : basename(p)
            const viewing = v.n === version.n
            const isBase = baseN === v.n
            return (
              <li key={v.n} className={`vb-tl ${viewing ? 'is-viewing' : ''} ${isBase ? 'is-base' : ''} ${inRange(v.n) ? 'in-range' : ''} ${v.n > version.n ? 'is-after' : ''}`}>
                <span className="vb-tl-dot" aria-hidden />
                <div className="vb-tl-main">
                  <div className="vb-tl-head">
                    <button className="vb-tl-n" onClick={() => setSearch({ v: v.n === latest.n ? undefined : v.n, compare: baseN !== null && baseN >= v.n ? undefined : compare })}>
                      v{v.n}
                    </button>
                    {viewing && <span className="tag tag-view">viewing</span>}
                    {isBase && <span className="tag">base</span>}
                    {i === 0 && !viewing && <span className="tag">latest</span>}
                    <span className="vb-tl-time">{ago(v.at)}</span>
                  </div>
                  <div className="vb-tl-msg">{v.message}</div>
                  <ActorLabel actor={v.author} />
                  {changes.length > 0 && (
                    <ul className="vb-tl-files">
                      {changes.map((c) => (
                        <li key={c.path}>
                          <button className="link" title={c.path} onClick={() => setSearch({ file: c.path, v: v.n === latest.n ? undefined : v.n, compare: v.n === 1 ? 'main' : String(v.n - 1) })}>
                            <span className={`vb-chg vb-chg-${c.change}`}>{c.change[0].toUpperCase()}</span> {label(c.path)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="vb-tl-foot">
                    {seenBy(v.n).map((r) => r.kind === 'user' && <Avatar key={r.userId} userId={r.userId} size="sm" />)}
                    {seenBy(v.n).length > 0 && <span className="muted">last seen here</span>}
                    {v.n < version.n && !isBase && (
                      <button className="vb-tl-compare" onClick={() => setSearch({ compare: String(v.n) })}>
                        Compare
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
          <li className={`vb-tl vb-tl-target ${baseN === 0 ? 'is-base' : ''}`}>
            <span className="vb-tl-dot" aria-hidden />
            <div className="vb-tl-main">
              <div className="vb-tl-head">
                <span className="vb-tl-n mono">{idea.target}</span>
                {baseN === 0 && <span className="tag">base</span>}
              </div>
              <div className="vb-tl-msg">Target branch, as last synced by the CLI</div>
              <div className="muted">{Object.keys(target).length} files</div>
              <div className="vb-tl-foot">
                {baseN !== 0 && (
                  <button className="vb-tl-compare" onClick={() => setSearch({ compare: 'main' })}>
                    Compare
                  </button>
                )}
              </div>
            </div>
          </li>
        </ol>
      </section>
    </div>
  )
}

// ---------- "vs" and version pickers ----------

type Option = { value: string; label: string; sub?: ReactNode } | { heading: string }

function Picker({
  value,
  options,
  onPick,
  label,
  display,
}: {
  value: string
  options: Option[]
  onPick: (v: string) => void
  label: string
  display?: string // trigger text, when it should differ from the option's label
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null) => t instanceof Node && !!(ref.current?.contains(t) || menu.current?.contains(t))
    const down = (e: MouseEvent) => !inside(e.target) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    // the menu is fixed-position, so close it rather than let it drift on scroll
    const scroll = (e: Event) => !inside(e.target) && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', scroll)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', scroll)
    }
  }, [open])
  const r = open ? ref.current?.getBoundingClientRect() : undefined
  const current = options.find((o): o is Extract<Option, { value: string }> => 'value' in o && o.value === value)
  return (
    <span className="vb-picker" ref={ref}>
      <button className="vb-picker-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <span className="vb-picker-value">{display ?? current?.label ?? value}</span>
        <span className="vb-picker-arrow" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        r &&
        createPortal(
        <ul
          ref={menu}
          className="vb-picker-menu"
          role="listbox"
          aria-label={label}
          style={{
            top: `calc(${r.bottom}px + var(--space-1))`,
            left: `max(var(--space-3), min(${r.left}px, calc(100vw - var(--picker-width) - var(--space-3))))`,
          }}
        >
          {options.map((o) =>
            'heading' in o ? (
              <li key={o.heading} role="presentation" className="vb-picker-heading">
                {o.heading}
              </li>
            ) : (
            <li key={o.value}>
              <button
                role="option"
                aria-selected={o.value === value}
                className={o.value === value ? 'on' : ''}
                onClick={() => {
                  onPick(o.value)
                  setOpen(false)
                }}
              >
                <span className="vb-picker-label">{o.label}</span>
                {o.sub && <span className="vb-picker-sub">{o.sub}</span>}
                {o.value === value && (
                  <span className="vb-picker-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </li>
            ),
          )}
        </ul>,
          document.body,
        )}
    </span>
  )
}

// What to compare against. "No comparison" is the default; picking anything
// under the heading turns on compare mode (the document and file tree show changes).
function BasePicker() {
  const { state, search, setSearch, version } = useIdeaView()
  const options: Option[] = [
    {
      value: 'none',
      label: 'No comparison',
      sub: 'Just read the document',
    },
    { heading: 'Show changes in the document since…' },
    { value: 'main', label: idea.target, sub: 'Target branch' },
    ...state.versions
      .filter((v) => v.n < version.n)
      .map((v) => ({ value: String(v.n), label: `v${v.n}`, sub: v.message })),
  ]
  const compare = search.compare
  const base = compare === 'main' ? idea.target : compare ? `v${compare}` : null
  const display = base ? `since ${base}` : 'Off'
  return (
    <Picker
      label="Compare against"
      value={compare ?? 'none'}
      display={display}
      options={options}
      onPick={(v) => setSearch({ compare: v === 'none' ? undefined : v })}
    />
  )
}

// Which version to view, newest first.
function VersionPicker() {
  const { state, search, setSearch, version, latest } = useIdeaView()
  const options: Option[] = [...state.versions].reverse().map((v) => ({
    value: String(v.n),
    label: `v${v.n}${v.n === latest.n ? ' (latest)' : ''}`,
    sub: v.message,
  }))
  return (
    <Picker
      label="Version to view"
      value={String(version.n)}
      options={options}
      onPick={(val) => {
        const n = Number(val)
        const base = search.compare === 'main' ? 0 : search.compare ? Number(search.compare) : null
        setSearch({ v: n === latest.n ? undefined : n, compare: base !== null && base >= n ? undefined : search.compare })
      }}
    />
  )
}

function TreeNode({ t, depth, file, onPick }: { t: Tree; depth: number; file: string; onPick: (p: string) => void }) {
  const [open, setOpen] = useState(true)
  if (depth === -1)
    return (
      <>
        {t.children.map((c) => (
          <TreeNode key={c.path} t={c} depth={0} file={file} onPick={onPick} />
        ))}
      </>
    )
  if (t.entry)
    return (
      <button
        role="treeitem"
        className={`vb-leaf ${t.entry.path === file ? 'on' : ''}`}
        style={{ paddingLeft: `calc(${depth} * var(--space-4) + var(--space-3))` }}
        onClick={() => onPick(t.entry!.path)}
      >
        <span className={`vb-chg vb-chg-${t.entry.change}`}>{t.entry.change[0].toUpperCase()}</span>
        <span className="vb-leaf-name">{basename(t.entry.path)}</span>
        {t.entry.open > 0 && <span className="vb-count">{t.entry.open}</span>}
      </button>
    )
  return (
    <div role="group">
      <button className="vb-dir" style={{ paddingLeft: `calc(${depth} * var(--space-4) + var(--space-3))` }} onClick={() => setOpen(!open)}>
        <span className="vb-caret">{open ? '▾' : '▸'}</span> {t.name}
      </button>
      {open && t.children.map((c) => <TreeNode key={c.path} t={c} depth={depth + 1} file={file} onPick={onPick} />)}
    </div>
  )
}
