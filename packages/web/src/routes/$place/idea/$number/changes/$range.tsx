// What changed in an idea between two versions: /changes/1..3, or /changes/1..
// for everything since v1, following new versions as they come. A range that
// isn't one goes to the overview; one past the latest version, to the latest.
import { createFileRoute, redirect } from '@tanstack/react-router'
import { IdeaView } from '../-components/IdeaView.tsx'
import { ideaLinks, parseRange } from '../-components/links.ts'
import { commentsOf } from '../-components/live.ts'
import { commentsQuery, filesQuery, ideaQuery, outlineQuery } from '../-components/queries.ts'

export const Route = createFileRoute('/$place/idea/$number/changes/$range')({
  validateSearch: (search: Record<string, unknown>): { file?: string } =>
    typeof search['file'] === 'string' ? { file: search['file'] } : {},
  loader: async ({ context: { queryClient, idea, place, number }, params }) => {
    const links = ideaLinks(place, number)
    const range = parseRange(params.range)
    const summary = await queryClient.query({ ...ideaQuery(idea), staleTime: 'static' })
    if (!range || range.from >= summary.latest) {
      throw redirect({ href: links.overview, replace: true })
    }
    if (range.to !== null && range.to > summary.latest) {
      throw redirect({ href: links.changes(range.from), replace: true })
    }
    const version = range.to ?? summary.latest
    await Promise.all([
      queryClient.query({ ...filesQuery(idea, version), staleTime: 'static' }),
      queryClient.query({ ...outlineQuery(idea, version), staleTime: 'static' }),
      queryClient.query({ ...filesQuery(idea, range.from), staleTime: 'static' }),
      commentsOf(idea, queryClient).preload(),
      version < summary.latest ? queryClient.query({ ...commentsQuery(idea, version), staleTime: 'static' }) : null,
    ])
  },
  component: Changes,
})

function Changes() {
  const { idea, place, number } = Route.useRouteContext()
  const { range: text } = Route.useParams()
  const { file } = Route.useSearch()
  const range = parseRange(text)!
  return <IdeaView id={idea} links={ideaLinks(place, number)} v={range.to ?? undefined} base={range.from} file={file} />
}
