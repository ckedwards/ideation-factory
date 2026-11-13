// An idea's files: the latest version, following new ones, or an older one
// with ?v= (read only); ?file= picks the file.
import { createFileRoute } from '@tanstack/react-router'
import { IdeaView, versionsOf } from './-components/IdeaView.tsx'
import { ideaLinks } from './-components/links.ts'
import { commentsOf } from './-components/live.ts'
import { commentsQuery, filesQuery, ideaQuery, loadIdeaPage, outlineQuery } from './-components/queries.ts'

interface Search {
  file?: string
  v?: number
}

export const Route = createFileRoute('/$place/idea/$number/files')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const v = Number(search['v'])
    return {
      ...(typeof search['file'] === 'string' ? { file: search['file'] } : {}),
      ...(Number.isInteger(v) && v > 0 ? { v } : {}),
    }
  },
  loaderDeps: ({ search }) => ({ v: search.v }),
  loader: async ({ context: { queryClient, idea }, deps }) => {
    // the page in one read, then anything it didn't fill (an older version, an idea loaded already)
    await loadIdeaPage(queryClient, idea)
    const summary = await queryClient.query({ ...ideaQuery(idea), staleTime: 'static' })
    const { version } = versionsOf(deps, summary.latest)
    await Promise.all([
      queryClient.query({ ...filesQuery(idea, version), staleTime: 'static' }),
      queryClient.query({ ...outlineQuery(idea, version), staleTime: 'static' }),
      commentsOf(idea, queryClient).preload(),
      version < summary.latest ? queryClient.query({ ...commentsQuery(idea, version), staleTime: 'static' }) : null,
    ])
  },
  component: Files,
})

function Files() {
  const { idea, place, number } = Route.useRouteContext()
  const { file, v } = Route.useSearch()
  return <IdeaView id={idea} links={ideaLinks(place, number)} v={v} file={file} />
}
