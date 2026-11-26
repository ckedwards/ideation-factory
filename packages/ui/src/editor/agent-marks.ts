// An agent's edit in a live draft (docs/handoff-live-editing.md, step 7): it lands at once, and so
// that it doesn't read as the page jumping, the words it put in are underlined in violet dots, with
// its name on a flag above them, as people's carets have. What it took out isn't shown: the draft's
// changes have that, with "Undo this change".
//
// A mark stays 3 seconds, then fades over one. Pointing at its words or its flag starts the 3 seconds
// again. The clock runs whether or not the words are on screen, and stops while the window is in the
// background, so an edit made while you were in another app is still marked when you're back.
// Screen readers are told what the agent wrote, once, as it lands. With reduced motion, the fade is
// left out. live.ts marks the steps the server says an agent made.
import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

/** How long a mark stays before it fades, and how long the fade takes. */
export const AGENT_MARK_MS = 3000
export const AGENT_FADE_MS = 1000

/** Where an agent's edit landed: what it put in, in this document's positions (a deletion is empty). */
export interface AgentEdit {
  name: string
  ranges: Array<{ from: number; to: number }>
}

interface AgentMark extends AgentEdit {
  id: string
  fading: boolean
}

type Meta = { add: AgentEdit[] } | { fade: string; fading: boolean } | { remove: string }

interface MarksState {
  marks: Map<string, AgentMark>
  decorations: DecorationSet
}

export const agentMarksKey = new PluginKey<MarksState>('agentMarks')

let made = 0

/** A transaction that marks agents' edits, as it lands. */
export const markAgentEdits = (tr: Transaction, edits: AgentEdit[]) =>
  tr.setMeta(agentMarksKey, { add: edits } satisfies Meta).setMeta('addToHistory', false)

/** The marks shown now (for tests). */
export const agentMarksOf = (state: EditorState): Array<AgentEdit & { fading: boolean }> =>
  [...(agentMarksKey.getState(state)?.marks.values() ?? [])].map(({ name, ranges, fading }) => ({
    name,
    ranges,
    fading,
  }))

function decorate(state: EditorState, marks: Map<string, AgentMark>): DecorationSet {
  const decorations: Decoration[] = []
  for (const mark of marks.values()) {
    const fading = mark.fading ? ' is-fading' : ''
    for (const { from, to } of mark.ranges) {
      if (from < to) {
        decorations.push(Decoration.inline(from, to, { class: `agent-edit${fading}`, 'data-agent-mark': mark.id }))
      }
    }
    const at = mark.ranges[0]
    if (at) {
      decorations.push(
        Decoration.widget(Math.min(at.from, state.doc.content.size), () => flag(mark), {
          // drawn again when it starts or stops fading, so its fade starts from the beginning
          key: `agent:${mark.id}:${mark.fading}`,
          side: -1,
          ignoreSelection: true,
        }),
      )
    }
  }
  return DecorationSet.create(state.doc, decorations)
}

function flag(mark: AgentMark): HTMLElement {
  const at = document.createElement('span')
  at.className = 'agent-at'
  at.setAttribute('contenteditable', 'false')
  at.setAttribute('aria-hidden', 'true')
  // the name is drawn by CSS (as a caret's is), so it isn't read as part of the words beside it
  const name = document.createElement('span')
  name.className = `live-flag agent-flag${mark.fading ? ' is-fading' : ''}`
  name.dataset['name'] = mark.name
  name.dataset['agentMark'] = mark.id
  at.append(name)
  return at
}

/** What screen readers are told: what each agent wrote, or that it took words out. */
function said(state: EditorState, edits: AgentEdit[]): string {
  return edits
    .map(({ name, ranges }) => {
      const words = ranges
        .map(({ from, to }) => state.doc.textBetween(from, to, ' ', ' ').trim())
        .filter(Boolean)
        .join(' … ')
      return words ? `${name} changed the draft: “${words}”.` : `${name} took words out of the draft.`
    })
    .join(' ')
}

/** The plugin: agents' edits marked, kept on their words as everyone types, and faded on their clock. */
export function agentMarks(holdMs = AGENT_MARK_MS, fadeMs = AGENT_FADE_MS): Plugin<MarksState> {
  return new Plugin<MarksState>({
    key: agentMarksKey,
    state: {
      init: () => ({ marks: new Map(), decorations: DecorationSet.empty }),
      apply: (tr, value, _, state) => {
        const meta = tr.getMeta(agentMarksKey) as Meta | undefined
        // nothing marked: typing has nothing to move
        if ((!tr.docChanged || value.marks.size === 0) && !meta) {
          return value
        }
        const marks = new Map<string, AgentMark>()
        for (const [id, mark] of value.marks) {
          marks.set(id, {
            ...mark,
            // typing at either edge of the agent's words isn't the agent's
            ranges: mark.ranges.map(({ from, to }) => {
              const start = tr.mapping.map(from, 1)
              return { from: start, to: Math.max(start, tr.mapping.map(to, -1)) }
            }),
          })
        }
        if (meta && 'add' in meta) {
          for (const edit of meta.add) {
            const id = `a${++made}`
            marks.set(id, { ...edit, id, fading: false })
          }
        } else if (meta && 'fade' in meta) {
          const mark = marks.get(meta.fade)
          if (mark) {
            marks.set(mark.id, { ...mark, fading: meta.fading })
          }
        } else if (meta && 'remove' in meta) {
          marks.delete(meta.remove)
        }
        return { marks, decorations: decorate(state, marks) }
      },
    },
    props: { decorations: (state) => agentMarksKey.getState(state)?.decorations ?? null },
    view: (view: EditorView) => {
      // for screen readers: a polite status of its own, beside the page rather than in the editor
      const status = document.createElement('div')
      status.className = 'visually-hidden'
      status.setAttribute('role', 'status')
      document.body.append(status)
      const clocks = new Map<string, { shown: number; fadedAt: number }>()
      // the mark pointed at, from the pointer's events (its words, or its flag)
      let pointed: string | null = null
      const markOf = (target: EventTarget | null) =>
        target instanceof Element
          ? (target.closest('[data-agent-mark]')?.getAttribute('data-agent-mark') ?? null)
          : null
      const over = (event: MouseEvent) => {
        pointed = markOf(event.target)
      }
      const out = (event: MouseEvent) => {
        pointed = markOf(event.relatedTarget)
      }
      view.dom.addEventListener('mouseover', over)
      view.dom.addEventListener('mouseout', out)
      let timer: ReturnType<typeof setInterval> | undefined
      let last = 0

      const set = (meta: Meta) =>
        view.dispatch(view.state.tr.setMeta(agentMarksKey, meta).setMeta('addToHistory', false))
      const tick = () => {
        const now = performance.now()
        const dt = now - last
        last = now
        const inFront = document.visibilityState === 'visible' && document.hasFocus()
        for (const mark of agentMarksKey.getState(view.state)?.marks.values() ?? []) {
          const clock = clocks.get(mark.id) ?? { shown: 0, fadedAt: 0 }
          clocks.set(mark.id, clock)
          if (pointed === mark.id) {
            // pointing starts the 3 seconds again, and brings a fading mark back
            clock.shown = 0
            if (mark.fading) {
              set({ fade: mark.id, fading: false })
            }
          } else if (!mark.fading) {
            if (inFront) {
              clock.shown += dt
            }
            if (clock.shown >= holdMs) {
              clock.fadedAt = now
              set({ fade: mark.id, fading: true })
            }
          } else if (now - clock.fadedAt >= fadeMs) {
            clocks.delete(mark.id)
            set({ remove: mark.id })
          }
        }
      }
      // the clock runs only while there's a mark
      const running = (state: EditorState) => {
        const any = (agentMarksKey.getState(state)?.marks.size ?? 0) > 0
        if (any && timer === undefined) {
          last = performance.now()
          timer = setInterval(tick, 100)
        } else if (!any && timer !== undefined) {
          clearInterval(timer)
          timer = undefined
          clocks.clear()
        }
      }
      return {
        update: (view, before) => {
          const now = agentMarksKey.getState(view.state)
          const was = agentMarksKey.getState(before)
          if (now !== was && now) {
            const added = [...now.marks.values()].filter((m) => !was?.marks.has(m.id))
            if (added.length > 0) {
              status.textContent = said(view.state, added)
            }
          }
          running(view.state)
        },
        destroy: () => {
          clearInterval(timer)
          view.dom.removeEventListener('mouseover', over)
          view.dom.removeEventListener('mouseout', out)
          status.remove()
        },
      }
    },
  })
}
