// A team's settings (/mobile/settings): its members, people asking to join,
// and for its admins, its rules for new ideas. Someone's own settings are at
// /settings.
import { ApiError } from '@ideaf/api'
import { Section } from '@ideaf/ui'
import { useMutation, useQueries, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, redirect, useNavigate } from '@tanstack/react-router'
import { api } from '../../api.ts'
import { ContainerSettings } from '../../components/ContainerSettings.tsx'
import { groupByHandleQuery, teamByHandleQuery } from '../../places.ts'
import { TeamPolicies, type TeamDefaults } from './-components/TeamPolicies.tsx'
import { TeamProfile } from './-components/TeamProfile.tsx'

export const Route = createFileRoute('/$place/settings')({
  loader: async ({ context: { queryClient }, params }) => {
    if (params.place.startsWith('@')) {
      throw redirect({ to: '/settings', replace: true })
    }
    try {
      await queryClient.query({ ...teamByHandleQuery(params.place), staleTime: 'static' })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        throw notFound()
      }
      throw error
    }
  },
  component: TeamSettings,
})

function TeamSettings() {
  const { place } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: team } = useSuspenseQuery(teamByHandleQuery(place))
  const groups = useQueries({ queries: team.defaults.groups.map((g) => groupByHandleQuery(g.group)) })
  const update = useMutation({
    mutationFn: (changes: Omit<Parameters<typeof api.updateTeam>[0], 'team'>) =>
      api.updateTeam({ team: team.handle, ...changes }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamByHandleQuery(place).queryKey }),
  })
  const defaults: TeamDefaults = {
    members: team.defaults.members,
    public: team.defaults.public,
    groups: team.defaults.groups.map((g, i) => {
      const found = groups[i]?.data
      return { group: found ?? { id: g.group, handle: g.group, name: 'A group' }, edit: g.edit }
    }),
  }
  return (
    <ContainerSettings kind="team" container={team} href={`/${team.handle}`}>
      {({ onProblem }) => (
        <>
          <Section title="Profile">
            <TeamProfile
              name={team.name}
              handle={team.handle}
              description={team.description}
              onSave={async (changes) => {
                const saved = await api.updateTeam({ team: team.handle, ...changes })
                await queryClient.invalidateQueries({ queryKey: ['team'] })
                if (saved.handle !== team.handle) {
                  // its new address; the old one keeps leading here
                  void navigate({ to: '/$place/settings', params: { place: saved.handle }, replace: true })
                }
              }}
            />
          </Section>
          <Section title="Its ideas">
            <TeamPolicies
              createPolicy={team.createPolicy}
              defaults={defaults}
              onCreatePolicy={(createPolicy) =>
                update.mutate({ createPolicy }, { onError: (e) => onProblem(e.message) })
              }
              onDefaults={(next) =>
                update.mutate(
                  {
                    defaults: {
                      members: next.members,
                      public: next.public,
                      groups: next.groups.map((g) => ({ group: g.group.id, edit: g.edit })),
                    },
                  },
                  { onError: (e) => onProblem(e.message) },
                )
              }
            />
          </Section>
        </>
      )}
    </ContainerSettings>
  )
}
