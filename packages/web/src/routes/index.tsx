// Home. What's waiting on your review, your open ideas and unread updates come
// with the lists (step 8, part 4) and reviews (step 9).
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Empty, Page, PageHeader } from '@ideaf/ui'
import { meQuery } from '../api.ts'

export const Route = createFileRoute('/')({
  staticData: { nav: 'home' },
  component: Home,
})

function Home() {
  const { data: me } = useSuspenseQuery(meQuery)
  return (
    <Page>
      <PageHeader title="Home" sub={`Signed in as @${me.handle}.`} />
      <Empty>Your ideas, what’s waiting on your review and what’s changed will be here.</Empty>
    </Page>
  )
}
