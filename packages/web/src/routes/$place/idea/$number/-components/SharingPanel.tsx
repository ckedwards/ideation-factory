// Who can see an idea, and what else they can do, and where it is: its team, with the way to move it.
// Someone with share access changes all of it. Shown in a dialog over the idea (its overview's
// Sharing), which /sharing opens too.
import { useState } from 'react'
import { Link, Stack, Toast } from '@ideaf/ui'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { api, personQuery, teamQuery } from '../../../../../api.ts'
import { accessOf } from './access.ts'
import { AccessList, type GrantRow } from './AccessList.tsx'
import type { IdeaLinks } from './links.ts'
import { accessQuery, ideaQuery } from './queries.ts'
import { ShareAdder } from './ShareAdder.tsx'
import { type Subject, subjectKey, useSubjectNames } from './subjects.ts'

export function SharingPanel({ id, links }: { id: string; links: IdeaLinks }) {
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
      label: name?.name ?? name?.label ?? '…',
      kind: g.subject.kind,
      href: name?.href,
      everyone: g.subject.kind === 'everyone',
      edit: g.edit,
      share: g.share,
    }
  })
  const subjectOf = (row: GrantRow) => access.grants.find((g) => subjectKey(g.subject) === row.key)!.subject
  return (
    <Stack gap={4}>
      <p className="sharing-where">
        {idea.team === null
          ? 'In no team: only its owner, and those it’s shared with, can see it.'
          : `In ${team.data?.name ?? 'its team'}.`}{' '}
        {access.you.share && <Link href={links.move}>Move it</Link>}
      </p>
      <AccessList
        owner={owner.data ?? { id: idea.owner, name: '…' }}
        grants={rows}
        canShare={access.you.share}
        onLevel={(row, level) => share.mutate({ subject: subjectOf(row), access: accessOf(level) })}
        onRemove={(row) => share.mutate({ subject: subjectOf(row), access: null })}
        adder={<ShareAdder onShare={(subject, level) => share.mutate({ subject, access: accessOf(level) })} />}
      />
      <Toast message={problem} onDismiss={() => setProblem(null)} />
    </Stack>
  )
}
