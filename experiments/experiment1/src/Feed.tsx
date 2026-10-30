// PROTOTYPE: the "Comments feed", one chronological timeline for the
// whole idea (like a GitHub PR's Conversation tab): the opening post, version
// uploads, status changes, and every comment thread across every file.
import { useMemo, useState, type ReactNode } from 'react'
import { idea, users, type Actor, type Comment } from './data'
import { useStore } from './store'
import { ago, basename, fileChange, headings, htmlText, lastSeenIn, placeComment, renderMarkdown, splitSections, type Placement } from './lib'
import { ActorLabel, Avatar, CommentCard, Md, StatusControl, ViewInVersion } from './shared'
import type { PlacedComment } from './useIdeaView'
import './Feed.css'

type Who = { label: string; test: (a: Actor) => boolean }

type Item =
  | { kind: 'version'; at: string; n: number }
  | { kind: 'activity'; at: string; id: string }
  | { kind: 'thread'; at: string; c: PlacedComment }

export function Feed({
  who,
  onOpenComment,
  onOpenVersion,
}: {
  who: Who
  onOpenComment: (c: Comment) => void
  onOpenVersion: (n: number, file: string) => void
}) {
  const { state } = useStore()
  const [show, setShow] = useState<'everything' | 'comments' | 'open'>('everything')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const latest = state.versions[state.versions.length - 1]
  const files = Object.keys(latest.files)

  // Place every comment against the latest version of its file.
  const placed = useMemo(() => {
    const cache = new Map<string, { text: string; heads: string[] }>()
    const info = (f: string) => {
      if (!cache.has(f)) {
        const src = latest.files[f] ?? ''
        cache.set(f, { text: htmlText(renderMarkdown(src, f, files)), heads: headings(src) })
      }
      return cache.get(f)!
    }
    return state.comments.map((c): PlacedComment => {
      const { text, heads } = info(c.file)
      const placement = placeComment(c, latest.files[c.file], text, heads) as Placement
      return { ...c, placement, lastSeen: placement === 'outdated' ? lastSeenIn(c, state.versions, latest.n) : undefined }
    })
  }, [state.comments, latest])

  const threads = placed.filter((c) => who.test(c.author) && (show !== 'open' || c.status === 'unresolved'))
  const items: Item[] = [
    ...threads.map((c): Item => ({ kind: 'thread', at: c.at, c })),
    ...(show === 'everything'
      ? [
          ...state.versions.map((v): Item => ({ kind: 'version', at: v.at, n: v.n })),
          ...state.activity.map((a): Item => ({ kind: 'activity', at: a.at, id: a.id })),
        ]
      : []),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  const open = placed.filter((c) => c.status === 'unresolved')
  const openByFile = [...new Set(open.map((c) => c.file))].map((f) => ({ f, n: open.filter((c) => c.file === f).length }))
  const v1 = state.versions[0]

  return (
    <div className="feed">
      <div className="feed-controls">
        <div className="seg" role="radiogroup" aria-label="Show">
          {(['everything', 'comments', 'open'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
              {k === 'everything' ? 'Everything' : k === 'comments' ? 'Comments only' : 'Open threads'}
            </button>
          ))}
        </div>
        <span className="muted">
          {open.length} open thread{open.length === 1 ? '' : 's'} across {openByFile.length} file{openByFile.length === 1 ? '' : 's'}
        </span>
      </div>

      <ol className="feed-timeline">
        {/* the opening post */}
        <li className="feed-item feed-post">
          <span className="feed-gutter">
            <Avatar userId={idea.ownerId} />
          </span>
          <article className="feed-card">
            <header className="feed-card-head">
              <b>{users[idea.ownerId].name}</b>
              <span className="muted">opened this idea · {ago(v1.at)}</span>
              <span className="tag feed-author-tag">Author</span>
            </header>
            <div className="feed-card-body">
              <h2 className="feed-title">{idea.title}</h2>
              <p className="feed-desc">{idea.description}</p>
              <div className="feed-meta">
                <span>{idea.team} team</span>
                <span className="mono">
                  {idea.repo} · {idea.branch} → {idea.target}
                </span>
              </div>
            </div>
          </article>
        </li>

        {items.map((it) => {
          if (it.kind === 'version') {
            const v = state.versions.find((x) => x.n === it.n)!
            const prev = state.versions.find((x) => x.n === it.n - 1)?.files
            const changes = [...new Set([...Object.keys(v.files), ...Object.keys(prev ?? {})])]
              .map((p) => ({ p, ch: fileChange(prev?.[p], v.files[p]) }))
              .filter((x) => x.ch !== 'unchanged')
            // show the parent folder when two changed files share a name
            const label = (p: string) =>
              changes.filter((x) => basename(x.p) === basename(p)).length > 1 ? p.split('/').slice(-2).join('/') : basename(p)
            return (
              <Event key={`v${v.n}`} icon="⬆" at={v.at}>
                <ActorLabel actor={v.author} /> uploaded <b className="mono">v{v.n}</b>
                <span className="feed-event-msg">“{v.message}”</span>
                <div className="feed-event-files">
                  {changes.map(({ p, ch }) => (
                    <button key={p} className="link" title={p} onClick={() => onOpenVersion(v.n, p)}>
                      <span className={`vb-chg vb-chg-${ch}`}>{ch[0].toUpperCase()}</span> {label(p)}
                    </button>
                  ))}
                </div>
              </Event>
            )
          }
          if (it.kind === 'activity') {
            const a = state.activity.find((x) => x.id === it.id)!
            return (
              <Event key={a.id} icon={a.kind === 'review-requested' ? '👀' : a.kind === 'created' ? '✳' : '●'} at={a.at}>
                <ActorLabel actor={a.actor} /> {a.text}
              </Event>
            )
          }
          const c = it.c
          const collapsed = c.status === 'resolved' && !expanded.has(c.id)
          if (collapsed)
            return (
              <Event key={c.id} icon="✓" at={c.at}>
                <ActorLabel actor={c.author} short />
                <span>
                  ’s {c.anchor.type === 'section' ? 'section comment' : c.anchor.type === 'file' ? 'whole-file comment' : 'text comment'} on{' '}
                  <b>{basename(c.file)}</b>
                  {c.anchor.type !== 'file' && c.anchor.section && <> · {c.anchor.type === 'section' ? `§ ${c.anchor.section}` : `in ${c.anchor.section}`}</>} was
                  resolved
                </span>
                <button className="link" onClick={() => setExpanded((s) => new Set(s).add(c.id))}>
                  Show
                </button>
              </Event>
            )
          return (
            <li key={c.id} className="feed-item">
              <span className="feed-gutter">
                {c.author.kind === 'user' ? <Avatar userId={c.author.userId} /> : <span className="feed-bot">🤖</span>}
              </span>
              <div className="feed-thread">
                <div className="feed-thread-head">
                  <span className="mono feed-path" title={c.file}>
                    {c.file}
                  </span>
                  <Kind c={c} src={latest.files[c.file]} />
                  {c.placement === 'outdated' && <span className="tag tag-outdated">Outdated</span>}
                  {c.placement === 'outdated' ? (
                    c.lastSeen && <ViewInVersion c={c} n={c.lastSeen} />
                  ) : (
                    <button className="link feed-open" onClick={() => onOpenComment(c)}>
                      View in document →
                    </button>
                  )}
                </div>
                <Context c={c} src={latest.files[c.file]} />
                <CommentCard c={c} showContext={false} />
                {c.status === 'resolved' && (
                  <button
                    className="link feed-hide"
                    onClick={() =>
                      setExpanded((s) => {
                        const n = new Set(s)
                        n.delete(c.id)
                        return n
                      })
                    }
                  >
                    Hide resolved thread
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {/* the summary box at the end, like the PR merge box */}
      <section className="feed-summary">
        <div className="feed-summary-row">
          <span className="feed-summary-title">Review</span>
          <StatusControl />
        </div>
        <div className="feed-summary-row">
          <span>
            {open.length === 0 ? 'No open threads.' : `${open.length} open thread${open.length === 1 ? '' : 's'}:`}
          </span>
          <span className="feed-summary-files">
            {openByFile.map(({ f, n }) => (
              <span key={f}>
                {basename(f)} <span className="muted">({n})</span>
              </span>
            ))}
          </span>
        </div>
        <div className="feed-summary-row">
          <span>Reviewers</span>
          <span className="feed-summary-files">
            {idea.reviewers.map((r) =>
              r.kind === 'user' ? (
                <span key={r.userId} className="actor">
                  <Avatar userId={r.userId} size="sm" /> {users[r.userId].name}
                  <span className="muted">{r.lastSeenVersion === latest.n ? 'seen latest' : `last saw v${r.lastSeenVersion}`}</span>
                </span>
              ) : (
                <span key={r.name} className="muted">
                  {r.name}: not opened yet
                </span>
              ),
            )}
          </span>
        </div>
      </section>
    </div>
  )
}

function Event({ icon, at, children }: { icon: string; at: string; children: ReactNode }) {
  return (
    <li className="feed-item feed-event">
      <span className="feed-gutter">
        <span className="feed-icon" aria-hidden>
          {icon}
        </span>
      </span>
      <div className="feed-event-body">
        {children}
        <span className="feed-time">{ago(at)}</span>
      </div>
    </li>
  )
}

// Where a section sits: its heading level, parent headings (skipping the
// document's H1), and the subsections it contains.
function sectionInfo(src: string | undefined, title: string) {
  if (!src) return null
  const secs = splitSections(src)
  const i = secs.findIndex((x) => x.title === title)
  if (i < 0) return null
  const me = secs[i]
  const path: string[] = []
  let level = me.level
  for (let j = i - 1; j >= 1; j--)
    if (secs[j].level < level && secs[j].level > 1) {
      path.unshift(secs[j].title!)
      level = secs[j].level
    }
  const subsections: string[] = []
  for (let j = i + 1; j < secs.length && secs[j].level > me.level; j++) subsections.push(secs[j].title!)
  const first = me.body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find((b) => b && !b.startsWith('```'))
  return { level: me.level, path, subsections, first }
}

// The header label: what the comment is attached to.
function Kind({ c, src }: { c: PlacedComment; src: string | undefined }) {
  if (c.anchor.type === 'file') return <span className="feed-kind">Whole file</span>
  const section = c.anchor.section
  const info = section ? sectionInfo(src, section) : null
  const crumb = section ? [...(info?.path ?? []), section].join(' › ') : null
  if (c.anchor.type === 'section')
    return (
      <>
        <span className="feed-kind feed-kind-section" title="Attached to a whole section, not specific text">
          § Section comment
        </span>
        <span className="feed-crumb">{crumb}</span>
      </>
    )
  return (
    <>
      <span className="feed-kind feed-kind-text" title="Attached to specific text">
        Text comment
      </span>
      {crumb && <span className="feed-crumb muted">in {crumb}</span>}
    </>
  )
}

// What a thread is about: for a section, the section itself drawn with the
// same outline as the anchored view; for text, the line with the quote
// highlighted; nothing for whole-file comments.
function Context({ c, src }: { c: PlacedComment; src: string | undefined }) {
  if (c.anchor.type === 'file') return null
  if (c.anchor.type === 'section') {
    const info = sectionInfo(src, c.anchor.section)
    if (!info)
      return (
        <div className="feed-section is-outdated">
          <span className="feed-section-title">{c.anchor.section}</span>
          <span className="muted">
            This section isn’t in the latest version{c.lastSeen ? `; it was last in v${c.lastSeen}` : ''}.
          </span>
        </div>
      )
    // first line of the section, as text: list markers and link targets dropped
    const line = info.first
      ?.split('\n')[0]
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    return (
      <div className="feed-section">
        <div className="feed-section-box">
          <span className="feed-section-level">H{info.level}</span>
          <div className="feed-section-title">{c.anchor.section}</div>
          {line && (
            <p className="feed-section-first">
              <Md text={line} />
              {(info.first!.includes('\n') || info.subsections.length > 0) && ' …'}
            </p>
          )}
        </div>
        <div className="feed-section-extent">
          Applies to the whole section
          {info.subsections.length > 0 && (
            <>
              , including {info.subsections.length === 1 ? 'its subsection' : 'its subsections'} <b>{info.subsections.length > 1 ? `${info.subsections.slice(0, -1).join(', ')} and ${info.subsections.at(-1)}` : info.subsections[0]}</b>
            </>
          )}
          .
        </div>
      </div>
    )
  }
  if (c.placement === 'outdated')
    return (
      <blockquote className="feed-quote is-outdated">
        <q>{c.anchor.quote}</q>
        <span className="muted"> isn’t in the latest version{c.lastSeen ? `; it was last in v${c.lastSeen}` : ''}</span>
      </blockquote>
    )
  if (!src) return null
  // one line of source = one paragraph, list item or table row here
  const quote = c.anchor.quote
  const plain = src
    .split('\n')
    .map((l) => htmlText(renderMarkdown(l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''), c.file, [])).trim())
  const para = plain.find((t) => t.includes(quote)) ?? quote
  const at = para.indexOf(quote)
  return (
    <blockquote className="feed-quote">
      {para.slice(0, at)}
      <mark className="anchor">{quote}</mark>
      {para.slice(at + quote.length)}
    </blockquote>
  )
}
