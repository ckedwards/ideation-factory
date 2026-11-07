// Who can see an idea, and what else they can do, and where it is: its team,
// with the way to move it. Someone with share access changes all of it.
import { useState } from 'react'
import { Link, Page, PageHeader, Section, Toast } from '@ideaf/ui'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api, personQuery, teamQuery } from '../../../../api.ts'
import { accessOf } from './-components/access.ts'
import { AccessList, type GrantRow } from './-components/AccessList.tsx'
import { ideaLinks } from './-components/links.ts'
import { accessQuery, ideaQuery } from './-components/queries.ts'
import { ShareAdder } from './-components/ShareAdder.tsx'
import { type Subject, subjectKey, useSubjectNames } from './-components/subjects.ts'

export const Route = createFileRoute('/$place/idea/$number/sharing')({
  loader: ({ context: { queryClient, idea } }) =>
    Promise.all([
      queryClient.query({ ...ideaQuery(idea), staleTime: 'static' }),
      queryClient.query({ ...accessQuery(idea), staleTime: 'static' }),
    ]),
  component: Sharing,
})

function Sharing() {
  const { idea: id, place, number } = Route.useRouteContext()
  const links = ideaLinks(place, number)
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const { data: access } = useSuspenseQuery(accessQuery(id))
  const owner = useQuery(personQuery(idea.owner))
  const team = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const names = useSubjectNames(access.grants.map((g) => g.subject))
  const share = useMutation({
    mutationFn: (input: { subject: Subject; access: { edit: boolean; share: boolean } | null }) =>
      api.setAccess({ idea: id, ...input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['idea', id] }),
    onError: (error) => setProblem(error.message),
  })
  const rows: GrantRow[] = access.grants.map((g) => {
    const name = names.get(subjectKey(g.subject))
    return {
      key: subjectKey(g.subject),
      label: name?.label ?? '…',
      href: name?.href,
      everyone: g.subject.kind === 'everyone',
      edit: g.edit,
      share: g.share,
    }
  })
  const subjectOf = (row: GrantRow) => access.grants.find((g) => subjectKey(g.subject) === row.key)!.subject

  return (
    <Page>
      <PageHeader title={idea.title} sub="Sharing" crumbs={<Link href={links.overview}>← Overview</Link>} />
      <Section title="Who has access">
        <AccessList
          owner={owner.data ?? { id: idea.owner, name: '…' }}
          grants={rows}
          canShare={access.you.share}
          onLevel={(row, level) => share.mutate({ subject: subjectOf(row), access: accessOf(level) })}
          onRemove={(row) => share.mutate({ subject: subjectOf(row), access: null })}
          adder={<ShareAdder onShare={(subject, level) => share.mutate({ subject, access: accessOf(level) })} />}
        />
      </Section>
      <Section title="Where it is" action={access.you.share ? <Link href={links.move}>Move it</Link> : undefined}>
        <p>
          {idea.team === null
            ? 'In no team: only its owner, and those it’s shared with, can see it.'
            : `In ${team.data?.name ?? 'its team'}.`}
        </p>
      </Section>
      <Toast message={problem} onDismiss={() => setProblem(null)} />
    </Page>
  )
}
