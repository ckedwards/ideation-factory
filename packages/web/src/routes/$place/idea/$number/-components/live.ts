// Each idea's live comments, shared by its overview and its files: one
// collection (and one live socket) per idea, kept while a page shows it and
// for a minute after (the collection's gcTime).
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../../../../../api.ts'
import { accessToken } from '../../../../../session.ts'
import { type CommentsCollection, commentsCollection } from './comments.ts'
import { draftQuery, ideaQuery } from './queries.ts'

const collections = new Map<string, CommentsCollection>()

export function commentsOf(idea: string, queryClient: QueryClient): CommentsCollection {
  let found = collections.get(idea)
  if (!found) {
    found = commentsCollection(idea, {
      api,
      open: (path) => new WebSocket(`${location.origin.replace(/^http/, 'ws')}${path}`),
      token: accessToken,
      // a new version: read the idea again, and a page following the latest moves on to it
      onVersion: () => void queryClient.invalidateQueries({ queryKey: ideaQuery(idea).queryKey, exact: true }),
      // the draft is someone's to read only if they can edit; a query nobody holds isn't fetched
      onDraft: () => void queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true }),
    })
    collections.set(idea, found)
  }
  return found
}
