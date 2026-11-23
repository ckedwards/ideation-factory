// What an idea's write tells inboxes: its events, cut down to what an inbox
// row shows (who, when, and what). Resolving a thread and changing the draft
// tell no one; pending comments never get here (they send no events until
// their review is submitted).
import { plainLine } from '@ideaf/core'
import type { InboxEvent } from '../directory/types.ts'
import type { IdeaEvent } from './service.ts'

export function inboxEvents(events: IdeaEvent[], at: number): InboxEvent[] {
  return events.flatMap((e): InboxEvent[] => {
    switch (e.name) {
      case 'version':
        return [
          { kind: 'version', actor: e.payload.by, at, detail: { version: e.payload.version, how: e.payload.how } },
        ]
      case 'comment': {
        const { thread } = e.payload
        const anchor = thread.anchor
        return [
          {
            kind: thread.suggestion ? 'suggestion' : 'comment',
            actor: e.payload.by,
            at,
            detail: {
              comment: thread.id,
              ...(anchor?.kind === 'text' ? { quote: anchor.quote } : {}),
              body: excerpt(thread.body),
              // a suggestion's change, so an email can show what it would change, not only why
              ...(thread.suggestion ? change(thread.suggestion.old, thread.suggestion.new) : {}),
            },
          },
        ]
      }
      case 'reply':
        return [
          {
            kind: 'reply',
            actor: e.payload.by,
            at,
            detail: { comment: e.payload.reply.id, parent: e.payload.parent, body: excerpt(e.payload.reply.body) },
          },
        ]
      case 'review': {
        const { review } = e.payload
        return [
          review.dismissed
            ? {
                kind: 'dismissed',
                actor: e.payload.by,
                at,
                detail: { reviewer: review.reviewer, verdict: review.verdict },
              }
            : { kind: 'review', actor: e.payload.by, at, detail: { verdict: review.verdict, version: review.version } },
        ]
      }
      case 'status':
        return [{ kind: 'status', actor: e.payload.by, at, detail: { status: e.payload.status } }]
      case 'decided':
        return [
          {
            kind: 'decided',
            actor: e.payload.by,
            at,
            detail: { comment: e.payload.comment, decision: e.payload.decision.kind },
          },
        ]
      case 'resolved':
      case 'draft':
      case 'draftSteps':
        return []
    }
  })
}

/**
 * What publishing a review's pending comments tells inboxes, from their rows
 * (read before the transaction that publishes them): each a comment,
 * suggestion or reply by the reviewer.
 */
export function publishedInboxEvents(
  rows: Array<{ id: string; parent: string | null; body: string; suggestion: string | null; quote: string | null }>,
  by: InboxEvent['actor'],
  at: number,
): InboxEvent[] {
  return rows.map((r): InboxEvent =>
    r.parent
      ? { kind: 'reply', actor: by, at, detail: { comment: r.id, parent: r.parent, body: excerpt(r.body) } }
      : {
          kind: r.suggestion ? 'suggestion' : 'comment',
          actor: by,
          at,
          detail: {
            comment: r.id,
            ...(r.quote ? { quote: r.quote } : {}),
            body: excerpt(r.body),
            ...(r.suggestion ? suggested(r.suggestion) : {}),
          },
        },
  )
}

/** A suggestion's change, its old and new text cut short if they're long. */
function change(old: string, replacement: string): { old: string; new: string } {
  const cut = (text: string) => (text.length > 500 ? `${text.slice(0, 500)}…` : text)
  return { old: cut(old), new: cut(replacement) }
}

/** A pending suggestion's change, from its row's JSON. */
function suggested(json: string): { old: string; new: string } | Record<string, never> {
  const parsed = JSON.parse(json) as { old?: unknown; new?: unknown }
  return typeof parsed.old === 'string' && typeof parsed.new === 'string' ? change(parsed.old, parsed.new) : {}
}

/** The start of what was said, for the inbox row: as it reads, without its Markdown. */
function excerpt(text: string): string {
  const flat = plainLine(text)
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat
}
