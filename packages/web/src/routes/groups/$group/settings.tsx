// A group's settings (/groups/security/settings): its members, and people
// asking to join.
import { ApiError } from '@ideaf/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { ContainerSettings } from '../../../components/ContainerSettings.tsx'
import { groupByHandleQuery } from '../../../places.ts'

export const Route = createFileRoute('/groups/$group/settings')({
  staticData: { nav: 'groups' },
  loader: async ({ context: { queryClient }, params }) => {
    try {
      await queryClient.query({ ...groupByHandleQuery(params.group), staleTime: 'static' })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        throw notFound()
      }
      throw error
    }
  },
  component: GroupSettings,
})

function GroupSettings() {
  const { group: handle } = Route.useParams()
  const { data: group } = useSuspenseQuery(groupByHandleQuery(handle))
  return <ContainerSettings kind="group" container={group} href={`/groups/${group.handle}`} />
}
