// A list of ideas, as every list page shows them (Home, Ideas, a team's or a
// person's page): ui's IdeaRow for each, a note when there are none, and
// "Show more" while there are more to load.
import type { ReactNode } from 'react'
import { Button, Empty, type IdeaInfo, IdeaRow, type IdeaRowHide, Stack } from '@ideaf/ui'

export interface IdeaListProps {
  ideas: IdeaInfo[]
  /** A search, highlighted in each row. */
  query?: string | undefined
  /** What the page already says (on a team's page, the team). */
  hide?: IdeaRowHide
  /** What to say when there are none. */
  empty: ReactNode
  /** More to load: a button that loads them, saying so while it does. */
  more?: { loading: boolean; onMore: () => void } | null
}

export function IdeaList({ ideas, query, hide, empty, more }: IdeaListProps) {
  if (ideas.length === 0) {
    return <Empty>{empty}</Empty>
  }
  return (
    <Stack gap={3}>
      {ideas.map((idea) => (
        <IdeaRow key={idea.id} idea={idea} query={query} {...(hide ? { hide } : {})} />
      ))}
      {more && (
        <div>
          <Button variant="ghost" onClick={more.onMore} disabled={more.loading}>
            {more.loading ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </Stack>
  )
}
