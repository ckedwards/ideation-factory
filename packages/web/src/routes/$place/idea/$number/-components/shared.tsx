// What an idea's pages share: the people they name, the idea's team as its
// chip shows it, comments as the cards show them, and writing comments and
// suggestions.
import { ApiError } from '@ideaf/api'
import { markdownTree } from '@ideaf/core'
import { type CommentInfo, MarkdownView, type Person, type TeamRef } from '@ideaf/ui'
import { useQueries } from '@tanstack/react-query'
import { personQuery } from '../../../../../api.ts'
import { type CommentsCollection, pendingId } from './comments.ts'
import { actorOf, type Thread } from './view.ts'

/** The people named on a page, loaded once each and kept; someone still loading shows by ID. */
export function usePeople(ids: string[]): Map<string, Person> {
  const unique = [...new Set(ids)]
  const results = useQueries({ queries: unique.map((id) => personQuery(id)) })
  return new Map(
    results.flatMap(({ data }) =>
      data ? [[data.id, { id: data.id, name: data.name, handle: data.handle, inactive: data.inactive }]] : [],
    ),
  )
}

/** The idea's team as its chip shows it; someone's own idea is "Your ideas" or "Riley Park's ideas". */
export function teamRef(
  idea: { team: string | null; owner: string },
  team: { name: string; archived: boolean } | undefined,
  people: Map<string, Person>,
  me: string,
): TeamRef {
  if (idea.team === null) {
    const owner = people.get(idea.owner)
    return { name: idea.owner === me ? 'Your ideas' : `${owner?.name ?? 'Someone'}’s ideas`, personal: true }
  }
  return team ? { name: team.name, archived: team.archived } : { name: 'Team' }
}

/**
 * A thread as a comment card shows it; `titles` names sections by their
 * heading's ID. `drafted`: the suggestions in the idea's draft as it is now,
 * for people who can read it (the thread says as of when it was read).
 */
export function commentInfo(
  thread: Thread,
  people: Map<string, Person>,
  titles: Map<string, string>,
  drafted?: Set<string>,
): CommentInfo {
  const anchor = thread.anchor
  return {
    id: thread.id,
    author: actorOf(thread.author, people),
    at: thread.createdAt,
    body: <MarkdownView tree={markdownTree(thread.body)} variant="compact" />,
    target:
      anchor?.kind === 'text'
        ? { kind: 'text', quote: anchor.quote }
        : anchor?.kind === 'section'
          ? { kind: 'section', title: titles.get(anchor.section) ?? 'A section' }
          : { kind: 'file' },
    resolved: thread.resolved,
    ...(thread.pending ? { pending: true } : {}),
    outdated: thread.state === 'outdated',
    ...(thread.suggestion
      ? {
          suggestion: {
            // the Markdown it replaces, when that isn't just the text as it reads
            ...(anchor?.kind === 'text' && anchor.quote === thread.suggestion.old
              ? {}
              : { old: thread.suggestion.old }),
            replacement: thread.suggestion.new,
            state:
              thread.suggestion.decision?.kind ??
              ((drafted ? drafted.has(thread.id) : thread.suggestion.inDraft) ? 'in-draft' : 'open'),
          },
        }
      : {}),
    ...(thread.lastVersion !== null ? { lastSeenIn: thread.lastVersion } : {}),
    replies: thread.replies.map((r) => ({
      id: r.id,
      author: actorOf(r.author, people),
      at: r.createdAt,
      body: <MarkdownView tree={markdownTree(r.body)} variant="compact" />,
      ...(r.pending ? { pending: true } : {}),
    })),
  }
}

/**
 * Writing comments on the latest version, through its live collection: each
 * write shows at once, and if the server refuses it, it goes away and `onProblem` says why.
 */
export function commentWrites(
  comments: CommentsCollection,
  me: string,
  version: number,
  onProblem: (message: string) => void,
) {
  const caller = { user: me, bot: null, purpose: 'me' as const }
  const settle = (tx: { when(state: 'settled'): Promise<unknown> }) =>
    void tx
      .when('settled')
      .catch((error: unknown) =>
        onProblem(
          error instanceof ApiError && error.code === 'stale_version'
            ? 'The idea has a new version. Read it, then comment again.'
            : `That didn’t work: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
  const thread = (
    anchor: Thread['anchor'],
    body: string,
    suggestion: Thread['suggestion'],
    pending: boolean,
  ): Thread => ({
    id: pendingId(),
    author: caller,
    createdAt: Date.now(),
    body,
    version,
    pending,
    resolved: false,
    state: 'exact',
    anchor,
    lastVersion: version,
    addressedIn: [],
    suggestion,
    replies: [],
  })
  return {
    /** `pending`: part of your review, which only you see until you submit it. */
    comment: (anchor: Thread['anchor'], body: string, pending = false) =>
      settle(comments.insert(thread(anchor, body, null, pending))),
    /** A suggestion: `old` is what it replaces (suggestionSource), `replacement` its Markdown. */
    suggest: (anchor: Thread['anchor'], old: string, replacement: string, body: string, pending = false) =>
      settle(comments.insert(thread(anchor, body, { old, new: replacement, decision: null, inDraft: false }, pending))),
    /** Deletes one of your pending comments, with its replies. */
    remove: (id: string) => settle(comments.delete(id)),
    reject: (id: string) =>
      settle(
        comments.update(id, (draft) => {
          if (draft.suggestion) {
            draft.suggestion.decision = { kind: 'rejected', by: caller, at: Date.now(), version: null }
            draft.resolved = true
          }
        }),
      ),
    reply: (thread: string, body: string, pending = false) =>
      settle(
        comments.update(thread, (draft) => {
          draft.replies.push({ id: pendingId(), author: caller, createdAt: Date.now(), body, version, pending })
        }),
      ),
    resolve: (thread: string, resolved: boolean) =>
      settle(
        comments.update(thread, (draft) => {
          draft.resolved = resolved
        }),
      ),
  }
}
