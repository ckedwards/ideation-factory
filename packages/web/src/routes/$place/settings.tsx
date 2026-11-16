// A team's settings (/mobile/settings): its members, its groups, people asking to join,
// its approval requirements, and for its admins, its profile (General) and who can start ideas
// and what they start with (Access). Someone's own settings are at
// /settings.
import { ApiError } from '@ideaf/api'
import { Section } from '@ideaf/ui'
import { useMutation, useQueries, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, redirect, useNavigate } from '@tanstack/react-router'
import { api } from '../../api.ts'
import { ContainerSettings, type SettingsTab, settingsTabOf } from '../../components/ContainerSettings.tsx'
import { groupByHandleQuery, teamByHandleQuery } from '../../places.ts'
import { TeamPolicies, type TeamDefaults } from './-components/TeamPolicies.tsx'
import { TeamProfile } from './-components/TeamProfile.tsx'
import { RequirementsDraft, type RequirementsView } from './-components/TeamRequirements.tsx'

export const Route = createFileRoute('/$place/settings')({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => settingsTabOf(search['tab']),
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
  const { tab = 'members' } = Route.useSearch()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: team } = useSuspenseQuery(teamByHandleQuery(place))
  const groups = useQueries({ queries: team.defaults.groups.map((g) => groupByHandleQuery(g.group)) })
  const ruleIds = [...new Set(team.requirements.groups.flatMap((r) => r.groups))]
  const ruleGroups = useQueries({ queries: ruleIds.map((id) => groupByHandleQuery(id)) })
  const groupRef = (id: string) => ruleGroups[ruleIds.indexOf(id)]?.data ?? { id, handle: id, name: 'A group' }
  const requirements: RequirementsView = {
    approvals: team.requirements.approvals,
    resolved: team.requirements.resolved,
    groups: team.requirements.groups.map((r) => ({ mode: r.mode, request: r.request, groups: r.groups.map(groupRef) })),
  }
  const setRequirements = useMutation({
    mutationFn: (next: RequirementsView) =>
      api.setTeamRequirements({
        team: team.handle,
        requirements: {
          approvals: next.approvals,
          resolved: next.resolved,
          groups: next.groups.map((r) => ({ mode: r.mode, request: r.request, groups: r.groups.map((g) => g.id) })),
        },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamByHandleQuery(place).queryKey }),
  })
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
    <ContainerSettings
      kind="team"
      container={team}
      href={`/${team.handle}`}
      tab={tab}
      onTab={(next) => void navigate({ to: '.', search: next === 'members' ? {} : { tab: next }, replace: true })}
      pages={[
        {
          id: 'requirements',
          label: 'Approval requirements',
          who: 'maintainer',
          render: ({ onProblem }) => (
            <Section title="Approval requirements">
              <RequirementsDraft
                saved={requirements}
                onSave={(next) => setRequirements.mutateAsync(next).catch((e: Error) => onProblem(e.message))}
              />
            </Section>
          ),
        },
        {
          id: 'general',
          label: 'General',
          who: 'admin',
          render: () => (
            <Section title="General">
              <TeamProfile
                name={team.name}
                handle={team.handle}
                description={team.description}
                onSave={async (changes) => {
                  const saved = await api.updateTeam({ team: team.handle, ...changes })
                  await queryClient.invalidateQueries({ queryKey: ['team'] })
                  if (saved.handle !== team.handle) {
                    // its new address; the old one keeps leading here
                    void navigate({
                      to: '/$place/settings',
                      params: { place: saved.handle },
                      search: { tab: 'general' },
                      replace: true,
                    })
                  }
                }}
              />
            </Section>
          ),
        },
        {
          id: 'access',
          label: 'Access',
          who: 'admin',
          render: ({ onProblem }) => (
            <Section title="Access">
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
          ),
        },
      ]}
    />
  )
}
