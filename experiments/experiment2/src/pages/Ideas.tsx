// PROTOTYPE: idea search across all teams, as Open | Closed lists.
import { useStore } from '../store'
import { visibleIdeas } from '../model'
import { PageHeader, SearchInput, useParam } from '../ui'
import { IdeaBrowser } from './IdeaBrowser'

export function Ideas() {
  const { state } = useStore()
  const [q, setQ] = useParam<string>('q', '')
  return (
    <div className="page">
      <PageHeader title="Ideas" sub="Search across every team. Ideas in locked teams show up only for their members." />
      <SearchInput value={q} onChange={setQ} placeholder="Search by title, team, author or description" label="Search ideas" autoFocus />
      <IdeaBrowser pool={visibleIdeas(state)} query={q} teamFilter />
    </div>
  )
}
