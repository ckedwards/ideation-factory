// Moving an idea into, out of, or to another team: pick where, see who
// loses and gains access before anything changes, adjust, then confirm.
// It then lives at its new address (its old one still leads there).
import { useState } from 'react'
import { Button, Link, Page, PageHeader, Section, Stack, Toast } from '@ideaf/ui'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api, membershipsQuery, teamQuery } from '../../../../api.ts'
import { TeamPicker, type TeamRefLite } from '../../../../components/TeamPicker.tsx'
import { ideaLinks } from './-components/links.ts'
import { MovePreview } from './-components/MovePreview.tsx'
import { accessQuery, ideaQuery } from './-components/queries.ts'
import { type Subject, subjectKey, useSubjectNames } from './-components/subjects.ts'

export const Route = createFileRoute('/$place/idea/$number/move')({
  loader: ({ context: { queryClient, idea } }) =>
    Promise.all([
      queryClient.query({ ...ideaQuery(idea), staleTime: 'static' }),
      queryClient.query({ ...accessQuery(idea), staleTime: 'static' }),
    ]),
  component: Move,
})

/** Where to: a team, or out of any team. */
type Destination = { team: TeamRefLite } | { out: true }

function Move() {
  const { idea: id, place, number } = Route.useRouteContext()
  const links = ideaLinks(place, number)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [to, setTo] = useState<Destination | null>(null)
  const [keep, setKeep] = useState<Subject[]>([])
  const [skip, setSkip] = useState<Subject[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const { data: access } = useSuspenseQuery(accessQuery(id))
  const from = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const team = to && 'team' in to ? to.team.id : null
  const input = (adjust: boolean) => ({
    idea: id,
    team,
    ...(adjust && keep.length ? { keep } : {}),
    ...(adjust && skip.length ? { skip } : {}),
  })
  // as it would be with no adjustments (what can be kept or left out), and as adjusted
  const plain = useQuery({
    queryKey: ['idea', id, 'move', team],
    queryFn: () => api.previewMove(input(false)),
    enabled: to !== null,
  })
  const adjusted = useQuery({
    queryKey: ['idea', id, 'move', team, keep.map(subjectKey), skip.map(subjectKey)],
    queryFn: () => api.previewMove(input(true)),
    enabled: to !== null,
  })
  const preview = adjusted.data ?? plain.data
  const now = new Set(plain.data?.grants.now.map((g) => subjectKey(g.subject)) ?? [])
  const after = new Set(plain.data?.grants.after.map((g) => subjectKey(g.subject)) ?? [])
  const removed = plain.data?.grants.now.filter((g) => !after.has(subjectKey(g.subject))) ?? []
  const added = plain.data?.grants.after.filter((g) => !now.has(subjectKey(g.subject))) ?? []
  const names = useSubjectNames([...removed, ...added].map((g) => g.subject))
  const move = useMutation({
    mutationFn: () => api.moveIdea(input(true)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['idea', id] })
      await queryClient.invalidateQueries({ queryKey: membershipsQuery.queryKey })
      const moved = await api.getIdea({ idea: id })
      void navigate({ href: ideaLinks(moved.place, moved.number).overview })
    },
    onError: (error) => setProblem(error.message),
  })
  const toggle = (list: Subject[], set: (s: Subject[]) => void, key: string, on: boolean, from: Subject[]) =>
    set(on ? [...list, from.find((s) => subjectKey(s) === key)!] : list.filter((s) => subjectKey(s) !== key))

  if (!access.you.share) {
    return (
      <Page>
        <PageHeader title={idea.title} sub="Move" crumbs={<Link href={links.overview}>← Overview</Link>} />
        <p>Only someone who can share it can move it.</p>
      </Page>
    )
  }
  return (
    <Page>
      <PageHeader
        title={idea.title}
        sub="Move it to another team"
        crumbs={<Link href={links.sharing}>← Sharing</Link>}
      />
      <Section title="Where to">
        <Stack gap={3}>
          <p>It’s {idea.team === null ? 'in no team' : `in ${from.data?.name ?? 'its team'}`} now.</p>
          <TeamPicker
            label="Move it to"
            value={to && 'team' in to ? to.team : null}
            onChange={(picked) => {
              setTo(picked ? { team: picked } : null)
              setKeep([])
              setSkip([])
            }}
            exclude={idea.team ? [idea.team] : []}
          />
          {idea.team !== null && (
            <div>
              <Button variant="ghost" onClick={() => setTo({ out: true })}>
                Or take it out of any team
              </Button>
            </div>
          )}
        </Stack>
      </Section>
      {to && preview && (
        <Section title="What changes">
          <MovePreview
            from={from.data?.name ?? 'no team'}
            to={'team' in to ? to.team.name : 'no team'}
            losing={preview.losing}
            gaining={preview.gaining}
            removed={removed.map((g) => ({
              key: subjectKey(g.subject),
              label: names.get(subjectKey(g.subject))?.label ?? '…',
              checked: keep.some((s) => subjectKey(s) === subjectKey(g.subject)),
            }))}
            added={added.map((g) => ({
              key: subjectKey(g.subject),
              label: names.get(subjectKey(g.subject))?.label ?? '…',
              checked: skip.some((s) => subjectKey(s) === subjectKey(g.subject)),
            }))}
            onKeep={(key, on) =>
              toggle(
                keep,
                setKeep,
                key,
                on,
                removed.map((g) => g.subject),
              )
            }
            onSkip={(key, on) =>
              toggle(
                skip,
                setSkip,
                key,
                on,
                added.map((g) => g.subject),
              )
            }
            onConfirm={() => move.mutate()}
            moving={move.isPending}
          />
        </Section>
      )}
      <Toast message={problem} onDismiss={() => setProblem(null)} />
    </Page>
  )
}
