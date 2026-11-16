// The teams a group is part of, on the group's page: its members are each team's, at up to the
// role shown. The group's admins can take it out of a team (it leaves), after seeing who'd leave the
// team with it; the team's admins are the others who can.
import { useState } from 'react'
import { Button, Dialog, Link, Stack } from '@ideaf/ui'
import './ContainerList.css'
import './MemberTable.css'

export interface GroupTeamInfo {
  team: { id: string; handle: string; name: string }
  role: 'member' | 'maintainer'
  added: number
  /** How many are in the team only through this group. */
  leaving: number
}

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`)

export interface GroupTeamsProps {
  group: { name: string }
  teams: GroupTeamInfo[]
  /** The group's admins take it out of a team. */
  admin: boolean
  onLeave: (team: GroupTeamInfo['team']) => void
}

export function GroupTeams({ group, teams, admin, onLeave }: GroupTeamsProps) {
  const [leaving, setLeaving] = useState<GroupTeamInfo | null>(null)
  if (teams.length === 0) {
    return <p className="member-none">{group.name} isn’t part of any team.</p>
  }
  return (
    <Stack gap={3}>
      <ul className="container-list" aria-label="Teams">
        {teams.map((t) => (
          <li key={t.team.id} className="container-row member-row">
            <span>
              <Link href={`/${t.team.handle}`}>{t.team.name}</Link>
              <span className="member-row-role">
                {' '}
                · its members are {t.role === 'maintainer' ? 'maintainers' : 'members'}
              </span>
            </span>
            {admin && (
              <Button size="sm" variant="ghost" aria-label={`Leave team ${t.team.name}`} onClick={() => setLeaving(t)}>
                Leave team
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={leaving !== null}
        title={`Take ${group.name} out of ${leaving?.team.name ?? 'the team'}?`}
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaving(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (leaving) {
                  onLeave(leaving.team)
                }
                setLeaving(null)
              }}
            >
              Leave team
            </Button>
          </>
        }
      >
        <p>
          {leaving?.leaving
            ? `${people(leaving.leaving)} in ${leaving.team.name} only through ${group.name} will leave it, with the access it gave them.`
            : `Everyone in ${group.name} is in ${leaving?.team.name ?? 'it'} some other way too, so nobody leaves.`}
        </p>
      </Dialog>
    </Stack>
  )
}
