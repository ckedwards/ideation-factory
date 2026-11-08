// What an idea's write tells inboxes: its events, cut down to what an inbox
// row shows (who, when, and what). Resolving a thread and changing the draft
// tell no one; pending comments never get here (they send no events until
// their review is submitted).
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
        return []
    }
  })
}

/** The start of what was said, for the inbox row. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat
}
