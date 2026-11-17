// An idea's review as its pages use it: the status, reviewers, verdicts and
// requirements, and every way of acting on them (asking, the status, a
// verdict, closing, reopening, dismissing). The idea's bar uses it for the
// status, the review button and closing; the overview's review column for
// the rest. Each write reads the reviews and the idea again after it.
import { ApiError } from '@ideaf/api'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { api, meQuery } from '../../../../../api.ts'
import { requirementWords } from '../../../../../ideas.ts'
import { rereadComments } from './comments.ts'
import { ideaQuery, reviewsQuery } from './queries.ts'
import type { ReviewPanelProps, ReviewRow } from './ReviewPanel.tsx'
import { usePeople } from './shared.tsx'
import { type Subject, subjectKey, useSubjectNames } from './subjects.ts'
import { actorOf, statusOf } from './view.ts'

export function useReview(id: string, onNote: (note: string) => void): ReviewPanelProps {
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const { data: reviews } = useSuspenseQuery(reviewsQuery(id))
  const { data: me } = useSuspenseQuery(meQuery)
  const people = usePeople(reviews.reviews.flatMap((r) => [r.by.user, ...(r.dismissed ? [r.dismissed.by.user] : [])]))
  const asked = reviews.reviewers.filter(
    (s): s is Extract<Subject, { kind: 'user' | 'group' }> => s.kind === 'user' || s.kind === 'group',
  )
  const names = useSubjectNames(asked)
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: reviewsQuery(id).queryKey, exact: true })
    void queryClient.invalidateQueries({ queryKey: ideaQuery(id).queryKey, exact: true })
  }
  /** Sends a write, reading the reviews again after; its error goes to the form that sent it. */
  const send = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } finally {
      reread()
    }
  }
  /** The same, for a write with no form of its own: its error is a note. */
  const noted = (fn: () => Promise<unknown>) =>
    void send(fn).catch((error: unknown) => onNote(error instanceof ApiError ? error.message : String(error)))

  // the groups one of whose members' approvals counts toward a rule that names them
  const approvedGroups = new Set(
    reviews.requirements.checks.flatMap((c) =>
      c.kind === 'groups' ? c.groups.filter((g) => g.approvedBy.length > 0).map((g) => g.id) : [],
    ),
  )
  const seen = new Map(reviews.seen.map((r) => [r.user, r.version]))
  return {
    status: statusOf(reviews.status),
    latest: reviews.latest,
    reviewers: asked.map((s) => ({
      key: subjectKey(s),
      subject: s,
      label: names.get(subjectKey(s))?.label ?? '…',
      // a group's approval, from the requirement checks
      ...(subjectKey(s).startsWith('group:') ? { approved: approvedGroups.has((s as { id: string }).id) } : {}),
      // the latest version a person has opened
      ...(subjectKey(s).startsWith('user:') ? { seen: seen.get((s as { id: string }).id) ?? null } : {}),
    })),
    reviews: reviews.reviews.map((r): ReviewRow => ({
      ...r,
      by: actorOf(r.by, people),
      dismissed: r.dismissed ? { ...r.dismissed, by: actorOf(r.dismissed.by, people) } : null,
    })),
    requirements: reviews.requirements.checks.map(requirementWords),
    canEdit: idea.you.edit,
    canReview: idea.owner !== me.id,
    onAsk: idea.you.share
      ? (subject, ask) => send(() => api.setReviewer({ idea: id, subject, reviewer: ask }))
      : undefined,
    onStatus: (status) =>
      noted(() =>
        api.setStatus({
          idea: id,
          // ui's words, as the api's
          status: status.replace(/ /g, '-') as 'draft' | 'requesting-review' | 'changes-in-progress',
        }),
      ),
    onClose: (reason, note) => send(() => api.closeIdea({ idea: id, reason, ...(note ? { note } : {}) })),
    onReopen: () => noted(() => api.reopenIdea({ idea: id })),
    pending: reviews.pending,
    onReview: (verdict, body) =>
      send(async () => {
        await api.reviewIdea({
          idea: id,
          version: reviews.latest,
          ...(verdict ? { verdict } : {}),
          ...(body ? { body } : {}),
        })
        // your pending comments are out now
        await rereadComments(id)
      }),
    onDiscard: () =>
      noted(async () => {
        await api.discardReview({ idea: id })
        await rereadComments(id)
      }),
    onDismiss: (reviewer, reason) => send(() => api.dismissReview({ idea: id, reviewer, reason })),
  }
}
