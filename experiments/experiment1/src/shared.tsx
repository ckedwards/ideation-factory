// PROTOTYPE: building blocks used by the idea page and the feed.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import { idea, me, users, type Actor, type IdeaStatus } from './data'
import { useStore, type Theme } from './store'
import { ago, sectionOf, wrapQuote } from './lib'
import type { PlacedComment } from './useIdeaView'

// ---------- people & bots ----------

export function Avatar({ userId, size = 'md' }: { userId: string; size?: 'sm' | 'md' }) {
  const u = users[userId]
  return (
    <span className={`avatar avatar-${size}`} data-user={userId} title={u?.name}>
      {u?.initials ?? '?'}
    </span>
  )
}

export function ActorLabel({ actor, short }: { actor: Actor; short?: boolean }) {
  if (actor.kind === 'user')
    return (
      <span className="actor">
        <Avatar userId={actor.userId} size="sm" />
        <span className="actor-name">{users[actor.userId]?.name}</span>
      </span>
    )
  return (
    <span className="actor actor-bot" title={actor.kind === 'userbot' ? 'Bot acting for a person' : 'Fully automated'}>
      <span className="bot-mark" aria-hidden>
        🤖
      </span>
      <span className="actor-name">{actor.bot}</span>
      {actor.kind === 'userbot' ? (
        <span className="actor-behalf">
          {short ? 'for' : 'on behalf of'} <span className="actor-person">{users[actor.userId]?.name}</span>
        </span>
      ) : (
        <span className="tag tag-bot">automated</span>
      )}
    </span>
  )
}

// ---------- idea chrome ----------

const STATUSES: IdeaStatus[] = ['draft', 'requesting review', 'changes in progress']

export function StatusControl() {
  const { state, dispatch } = useStore()
  const canEdit = idea.ownerId === me.id
  return (
    <label className={`status status-${state.status.replace(/ /g, '-')}`}>
      <span className="status-dot" aria-hidden />
      <select
        value={state.status}
        disabled={!canEdit}
        onChange={(e) => dispatch({ type: 'setStatus', status: e.target.value as IdeaStatus })}
        aria-label="Idea status"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>
    </label>
  )
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'contrast', label: 'High contrast' },
]

export function ThemeToggle() {
  const { state, dispatch } = useStore()
  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={state.theme === t.id}
          className={state.theme === t.id ? 'on' : ''}
          onClick={() => dispatch({ type: 'setTheme', theme: t.id })}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Md({ text }: { text: string }) {
  return <span className="md-inline" dangerouslySetInnerHTML={{ __html: marked.parseInline(text, { async: false }) as string }} />
}

// ---------- the document ----------

export type AnchorLayout = Record<string, number>

export function MarkdownView({
  html,
  comments,
  activeId,
  changed,
  onAnchorClick,
  onFileLink,
  onLayout,
  onRendered,
  className = '',
  rootRef,
}: {
  html: string
  comments?: PlacedComment[]
  activeId?: string | null
  changed?: Set<string>
  onAnchorClick?: (id: string) => void
  onFileLink?: (path: string) => void
  onLayout?: (pos: AnchorLayout) => void
  onRendered?: (root: HTMLDivElement) => void
  className?: string
  rootRef?: RefObject<HTMLDivElement | null>
}) {
  const own = useRef<HTMLDivElement>(null)
  const ref = rootRef ?? own
  const key = (comments ?? []).map((c) => `${c.id}:${c.status}:${c.placement}:${JSON.stringify(c.anchor)}`).join('|')

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    root.innerHTML = html

    if (changed) {
      let on = false
      for (const el of Array.from(root.children) as HTMLElement[]) {
        if (el.dataset.section) on = changed.has(el.dataset.section)
        if (on) el.classList.add('sec-changed')
      }
    }

    for (const c of comments ?? []) {
      if (c.placement !== 'anchored') continue
      if (c.anchor.type === 'selection') wrapQuote(root, c.anchor.quote, c.id)
      if (c.anchor.type === 'section') {
        const h = Array.from(root.querySelectorAll<HTMLElement>('[data-section]')).find(
          (x) => x.dataset.section === (c.anchor as { section: string }).section,
        )
        if (h) {
          h.classList.add('anchor-section')
          h.dataset.commentId = h.dataset.commentId ?? c.id
        }
      }
      if (c.status === 'resolved')
        root.querySelectorAll(`[data-comment-id="${c.id}"]`).forEach((m) => m.classList.add('is-resolved'))
    }
    if (activeId) root.querySelectorAll(`[data-comment-id="${activeId}"]`).forEach((m) => m.classList.add('is-active'))
    onRendered?.(root)

    if (onLayout) {
      const report = () => {
        const top = root.getBoundingClientRect().top
        const pos: AnchorLayout = {}
        root.querySelectorAll<HTMLElement>('[data-comment-id]').forEach((m) => {
          const id = m.dataset.commentId!
          if (pos[id] === undefined) pos[id] = m.getBoundingClientRect().top - top
        })
        onLayout(pos)
      }
      report()
      const ro = new ResizeObserver(report)
      ro.observe(root)
      return () => ro.disconnect()
    }
  }, [html, key, activeId, changed])

  return (
    <div
      ref={ref}
      className={`prose ${className}`}
      onClick={(e) => {
        const t = e.target as HTMLElement
        const link = t.closest<HTMLElement>('[data-file]')
        if (link) {
          e.preventDefault()
          onFileLink?.(link.dataset.file!)
          return
        }
        const mark = t.closest<HTMLElement>('[data-comment-id]')
        if (mark) onAnchorClick?.(mark.dataset.commentId!)
      }}
    />
  )
}

// ---------- creating comments from a selection ----------

type Pending = { quote: string; section?: string; range: Range }

export function SelectionComposer({
  rootRef,
  file,
  version,
  enabled = true,
  onCreated,
}: {
  rootRef: RefObject<HTMLDivElement | null>
  file: string
  version: number
  enabled?: boolean
  onCreated?: () => void
}) {
  const { state, dispatch } = useStore()
  const [pending, setPending] = useState<Pending | null>(null)
  const [mode, setMode] = useState<'menu' | 'comment' | 'suggest' | 'section'>('menu')
  const [body, setBody] = useState('')
  const [replacement, setReplacement] = useState('')
  const [, force] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return
    const up = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return
      // let the browser finish updating the selection first
      setTimeout(() => {
        const sel = window.getSelection()
        const root = rootRef.current
        if (!sel || sel.isCollapsed || !root || !root.contains(sel.anchorNode)) return
        // ignore selections inside comment threads rendered in the document
        if (sel.anchorNode?.parentElement?.closest('[data-slot]')) return
        const quote = sel.toString().split('\n')[0].trim()
        if (!quote) return
        const range = sel.getRangeAt(0).cloneRange()
        setPending({ quote, section: sectionOf(range.startContainer, root), range })
        setMode('menu')
        setBody('')
        setReplacement(quote)
      })
    }
    const down = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return
      setPending((p) => (p && (mode === 'menu' || !body.trim()) ? null : p))
    }
    const move = () => force((n) => n + 1)
    document.addEventListener('mouseup', up)
    document.addEventListener('mousedown', down)
    window.addEventListener('scroll', move, true)
    window.addEventListener('resize', move)
    return () => {
      document.removeEventListener('mouseup', up)
      document.removeEventListener('mousedown', down)
      window.removeEventListener('scroll', move, true)
      window.removeEventListener('resize', move)
    }
  }, [enabled, rootRef, mode, body])

  if (!pending) return null
  const r = pending.range.getBoundingClientRect()
  const reattaching = state.reattachId

  const close = () => {
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }
  const submit = () => {
    if (mode === 'section' && pending.section) {
      dispatch({ type: 'addComment', file, version, anchor: { type: 'section', section: pending.section }, body })
    } else {
      dispatch({
        type: 'addComment',
        file,
        version,
        anchor: { type: 'selection', quote: pending.quote, section: pending.section },
        body,
        replacement: mode === 'suggest' ? replacement : undefined,
      })
    }
    close()
    onCreated?.()
  }

  return createPortal(
    <div
      ref={box}
      className={`composer composer-${mode}`}
      style={{ top: `calc(${r.bottom}px + var(--space-2))`, left: `max(var(--space-3), min(${r.left}px, calc(100vw - var(--composer-width) - var(--space-3))))` }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) submit()
      }}
    >
      {mode === 'menu' ? (
        <div className="composer-menu">
          {reattaching ? (
            <button
              className="primary"
              onClick={() => {
                dispatch({ type: 'reattach', file, version, anchor: { type: 'selection', quote: pending.quote, section: pending.section } })
                close()
              }}
            >
              Attach comment here
            </button>
          ) : (
            <>
              <button onClick={() => setMode('comment')}>Comment</button>
              <button onClick={() => setMode('suggest')}>Suggest edit</button>
              {pending.section && (
                <button className="ghost" onClick={() => setMode('section')} title="Comment on the whole section">
                  On “{pending.section}”
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="composer-form">
          <div className="composer-context">
            {mode === 'section' ? (
              <>Section · {pending.section}</>
            ) : (
              <q>{pending.quote.length > 80 ? pending.quote.slice(0, 80) + '…' : pending.quote}</q>
            )}
          </div>
          {mode === 'suggest' && (
            <textarea
              className="composer-replacement"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              rows={3}
              autoFocus
              aria-label="Replacement text"
            />
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            autoFocus={mode !== 'suggest'}
            placeholder={mode === 'suggest' ? 'Why? (optional)' : 'Leave a comment…'}
          />
          <div className="composer-actions">
            <span className="hint">⌘↵ to post · Esc to cancel</span>
            <button className="ghost" onClick={close}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={mode === 'suggest' ? replacement === pending.quote : !body.trim()}
              onClick={submit}
            >
              {mode === 'suggest' ? 'Suggest' : 'Comment'}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

// File-level comment box (no anchor).
export function FileCommentBox({ file, version, onDone }: { file: string; version: number; onDone?: () => void }) {
  const { dispatch } = useStore()
  const [body, setBody] = useState('')
  const post = () => {
    if (!body.trim()) return
    dispatch({ type: 'addComment', file, version, anchor: { type: 'file' }, body })
    setBody('')
    onDone?.()
  }
  return (
    <div className="file-comment-box">
      <textarea
        rows={2}
        value={body}
        placeholder="Comment on this file…"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && post()}
      />
      <button className="primary" disabled={!body.trim()} onClick={post}>
        Comment
      </button>
    </div>
  )
}

// ---------- a comment thread ----------

export function CommentCard({
  c,
  active,
  onSelect,
  showContext = true,
  extra,
}: {
  c: PlacedComment
  active?: boolean
  onSelect?: (id: string) => void
  showContext?: boolean
  extra?: ReactNode
}) {
  const { state, dispatch } = useStore()
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const owner = idea.ownerId === me.id
  const resolved = c.status === 'resolved'
  const s = c.suggestion

  const send = () => {
    if (!reply.trim()) return
    dispatch({ type: 'reply', id: c.id, body: reply })
    setReply('')
    setReplying(false)
  }

  return (
    <article
      className={`card ${active ? 'is-active' : ''} ${resolved ? 'is-resolved' : ''} ${c.placement === 'lost' ? 'is-lost' : ''} ${c.author.kind !== 'user' ? 'by-bot' : ''}`}
      onClick={() => onSelect?.(c.id)}
      data-card-id={c.id}
    >
      <header className="card-head">
        <ActorLabel actor={c.author} />
        <span className="card-time">{ago(c.at)}</span>
      </header>

      {showContext && (
        <div className="card-context">
          {c.placement === 'lost' ? (
            <span className="tag tag-lost" title="The text this comment pointed at is gone">
              Lost
            </span>
          ) : null}
          {c.anchor.type === 'file' && <span className="tag">Whole file</span>}
          {c.anchor.type === 'section' && <span className="tag">§ {c.anchor.section}</span>}
          {c.anchor.type === 'selection' && c.placement === 'lost' && <q className="card-quote">{c.anchor.quote}</q>}
          {c.version < state.versions[state.versions.length - 1].n && <span className="tag tag-faint">on v{c.version}</span>}
          {resolved && <span className="tag tag-ok">Resolved</span>}
        </div>
      )}

      {c.body && (
        <div className="card-body">
          <Md text={c.body} />
        </div>
      )}

      {s && c.anchor.type === 'selection' && (
        <div className={`suggestion suggestion-${s.state}`}>
          <div className="suggestion-label">
            Suggested edit{s.state !== 'open' && <> · {s.state}</>}
          </div>
          <div className="suggestion-diff">
            <del>{s.state === 'accepted' ? '' : c.anchor.quote}</del>
            <ins>{s.replacement}</ins>
          </div>
          {s.state === 'open' && owner && c.placement !== 'lost' && (
            <div className="suggestion-actions">
              <button
                className="primary"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'acceptSuggestion', id: c.id })
                }}
              >
                Accept → new version
              </button>
              <button
                className="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'rejectSuggestion', id: c.id })
                }}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {c.replies.length > 0 && (
        <ol className="replies">
          {c.replies.map((r) => (
            <li key={r.id}>
              <header className="card-head">
                <ActorLabel actor={r.author} short />
                <span className="card-time">{ago(r.at)}</span>
              </header>
              <div className="card-body">
                <Md text={r.body} />
              </div>
            </li>
          ))}
        </ol>
      )}

      {replying ? (
        <div className="reply-box" onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            rows={2}
            value={reply}
            placeholder="Reply…"
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
              if (e.key === 'Escape') setReplying(false)
            }}
          />
          <div className="row-end">
            <button className="ghost" onClick={() => setReplying(false)}>
              Cancel
            </button>
            <button className="primary" disabled={!reply.trim()} onClick={send}>
              Reply
            </button>
          </div>
        </div>
      ) : (
        <footer className="card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="link" onClick={() => setReplying(true)}>
            Reply
          </button>
          <button className="link" onClick={() => dispatch({ type: 'toggleResolved', id: c.id })}>
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          {c.placement === 'lost' && owner && (
            <button
              className="link"
              onClick={() => dispatch({ type: 'startReattach', id: state.reattachId === c.id ? null : c.id })}
            >
              {state.reattachId === c.id ? 'Cancel re-attach' : 'Re-attach…'}
            </button>
          )}
          {extra}
        </footer>
      )}
    </article>
  )
}

export function ReattachBanner() {
  const { state, dispatch } = useStore()
  const c = state.comments.find((x) => x.id === state.reattachId)
  if (!c) return null
  return (
    <div className="reattach-banner" role="status">
      Select text in any file to re-attach the comment from <ActorLabel actor={c.author} short />.
      <button className="ghost" onClick={() => dispatch({ type: 'startReattach', id: null })}>
        Cancel
      </button>
    </div>
  )
}

// ---------- table of contents ----------

export type TocEntry = { title: string; level: number; line: number }

// H2–H4 from the markdown source (H1 is the document title), with line numbers.
export function tocEntries(src: string): TocEntry[] {
  const out: TocEntry[] = []
  let fence = false
  src.split('\n').forEach((l, line) => {
    if (l.startsWith('```')) fence = !fence
    const m = !fence && /^(#{2,4})\s+(.*)$/.exec(l)
    if (m) out.push({ title: m[2].trim(), level: m[1].length, line })
  })
  return out
}

// The heading you're reading: the last one above `offset` from the top of the
// scroll area. Works for a scrolling element or the window.
export function useScrollSpy(getRoot: () => HTMLElement | null, getScroller: () => HTMLElement | Window | null, offset: number, deps: unknown[]) {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const scroller = getScroller()
    if (!scroller) return
    const update = () => {
      const root = getRoot()
      if (!root) return
      const top = (scroller instanceof Window ? 0 : scroller.getBoundingClientRect().top) + offset
      // at the very bottom the last headings can't reach the top; use the last one on screen
      const el = scroller instanceof Window ? document.documentElement : scroller
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      const bottom = scroller instanceof Window ? window.innerHeight : scroller.getBoundingClientRect().bottom
      let current: string | null = null
      root.querySelectorAll<HTMLElement>('h2[data-section], h3[data-section], h4[data-section]').forEach((h) => {
        const t = h.getBoundingClientRect().top
        if (t <= top || (atBottom && t < bottom)) current = h.dataset.section!
      })
      setActive(current)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, deps)
  return active
}

export function Toc({
  entries,
  active,
  counts,
  changed,
  onJump,
  className = '',
}: {
  entries: TocEntry[]
  active: string | null
  counts?: Record<string, number>
  changed?: Set<string>
  onJump: (e: TocEntry) => void
  className?: string
}) {
  if (entries.length === 0) return <div className={`toc toc-empty ${className}`}>No headings in this file.</div>
  return (
    <nav className={`toc ${className}`} aria-label="Table of contents">
      <ol>
        {entries.map((e) => (
          <li key={`${e.line}-${e.title}`} className={`toc-l${e.level}`}>
            <button className={active === e.title ? 'on' : ''} aria-current={active === e.title ? 'location' : undefined} onClick={() => onJump(e)}>
              <span className="toc-title">{e.title}</span>
              {changed?.has(e.title) && <span className="toc-changed" title="Changed vs the target branch" />}
              {!!counts?.[e.title] && (
                <span className="toc-count" title={`${counts[e.title]} open comment${counts[e.title] > 1 ? 's' : ''}`}>
                  {counts[e.title]}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

// Open comments per section title (text comments count toward their section).
export function sectionCounts(comments: PlacedComment[]) {
  const counts: Record<string, number> = {}
  for (const c of comments) {
    if (c.status !== 'unresolved' || c.placement !== 'anchored' || c.anchor.type === 'file') continue
    const s = c.anchor.section
    if (s) counts[s] = (counts[s] ?? 0) + 1
  }
  return counts
}
