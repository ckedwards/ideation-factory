// Sending an idea's outbox: what its writes tell inboxes, oldest first, each
// kept until the directory says it has applied it. One the directory couldn't
// take is tried again later (IdeaService.outboxFailed waits longer each time)
// without holding up the rest: a late one lands in the right place, since an
// inbox row's latest update is the newest by time, not by arrival.
import type { InboxEvent } from '../directory/types.ts'
import type { IdeaService } from './service.ts'

export type Outbox = Pick<IdeaService, 'outboxDue' | 'outboxSent' | 'outboxFailed' | 'outboxNextAt'>

/** Sends a notification: true once the directory has applied it; false or a throw when it hasn't. */
export type SendNotification = (batch: { id: string; events: InboxEvent[] }) => Promise<boolean>

/** Sends what's due; says when the next is due (null when the outbox is empty). */
export async function sendOutbox(
  outbox: Outbox,
  send: SendNotification,
  log: (fields: Record<string, unknown>) => void,
): Promise<number | null> {
  for (;;) {
    const due = await outbox.outboxDue()
    if (due.length === 0) {
      break
    }
    for (const row of due) {
      let sent = false
      try {
        sent = await send({ id: row.id, events: row.events })
      } catch (error) {
        log({ msg: 'sending a notification failed; trying again', id: row.id, error: String(error) })
      }
      if (sent) {
        await outbox.outboxSent(row.id)
      } else {
        // not due again for a while, so the next pass leaves it
        await outbox.outboxFailed(row.id, row.attempts)
      }
    }
  }
  return outbox.outboxNextAt()
}
