// Home: your ideas, and what's changed in the ideas you can see. What's
// waiting on your review comes with reviews (step 9), and unread updates with
// the inbox.
import { Link, Page, PageHeader, Section } from '@ideaf/ui'
import { useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { meQuery } from '../api.ts'
import { IdeaList } from '../components/IdeaList.tsx'
import { ideaInfo } from '../ideas.ts'
import { ideasQuery } from '../lists.ts'

export const Route = createFileRoute('/')({
  staticData: { nav: 'home' },
  loader: async ({ context: { queryClient } }) => {
    const me = await queryClient.ensureQueryData(meQuery)
    await Promise.all([
      queryClient.ensureInfiniteQueryData(ideasQuery({ owner: me.id })),
      queryClient.ensureInfiniteQueryData(ideasQuery()),
    ])
  },
  component: Home,
})

function Home() {
  const { data: me } = useSuspenseQuery(meQuery)
  const mine = useInfiniteQuery(ideasQuery({ owner: me.id }))
  const recent = useInfiniteQuery(ideasQuery())
  const yours = (mine.data?.pages[0]?.items ?? []).slice(0, 5)
  // what changed in others' ideas: yours are above
  const others = (recent.data?.pages[0]?.items ?? []).filter((row) => row.owner.id !== me.id).slice(0, 10)
  return (
    <Page>
      <PageHeader title="Home" sub={`Signed in as @${me.handle}.`} />
      <Section title="Your ideas" action={<Link href={`/@${me.handle}`}>See all</Link>}>
        <IdeaList
          ideas={yours.map((row) => ideaInfo(row, me.id))}
          hide={{ author: true }}
          empty="No ideas yet. Start one with ideaf start."
        />
      </Section>
      <Section title="Recently changed" action={<Link href="/ideas">See all</Link>}>
        <IdeaList ideas={others.map((row) => ideaInfo(row, me.id))} empty="Nothing shared with you yet." />
      </Section>
    </Page>
  )
}
