// Every page: signed in first (to the sign-in page if not), then the app's
// frame, its navigation beside the page.
import { useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, redirect, useMatches, useNavigate } from '@tanstack/react-router'
import { AppShell, Empty, Link, Page, PageHeader, SearchInput, type Theme } from '@ideaf/ui'
import { membershipsQuery, meQuery, unreadQuery } from '../api.ts'
import { AppNav, type NavPage } from '../components/AppNav.tsx'
import { SiteLinks } from '../components/SiteLinks.tsx'
import { accessToken, SignedOut, signInHref, signOut } from '../session.ts'
import { SiteProvider } from '../site.tsx'
import { savedTheme, setTheme } from '../theme.ts'
import './-root.css'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    try {
      await accessToken()
    } catch (error) {
      if (error instanceof SignedOut) {
        // the sign-in page is the server's, not a route: a whole page load
        throw redirect({ href: signInHref(), reloadDocument: true })
      }
      throw error
    }
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.query({ ...meQuery, staleTime: 'static' }),
      context.queryClient.query({ ...membershipsQuery, staleTime: 'static' }),
    ]),
  component: Root,
  notFoundComponent: NotFound,
})

function Root() {
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: memberships } = useSuspenseQuery(membershipsQuery)
  const unread = useQuery(unreadQuery)
  const [theme, pickTheme] = useState<Theme>(savedTheme)
  // the deepest route that names itself in the nav
  const current = useMatches({
    select: (matches) => matches.findLast((m) => m.staticData.nav !== undefined)?.staticData.nav ?? null,
  })
  const wide = useMatches({ select: (matches) => matches.some((m) => m.staticData.wide) })
  // the team whose pages these are (a person's are under @)
  const currentTeam = useMatches({
    select: (matches) => {
      const place = (matches.findLast((m) => 'place' in m.params)?.params as { place?: string } | undefined)?.place
      return place && !place.startsWith('@') ? place : null
    },
  })
  const site = {
    theme,
    onThemeChange: (next: Theme) => {
      pickTheme(next)
      setTheme(next)
    },
    onSignOut: () => void signOut(),
  }
  return (
    <SiteProvider value={site}>
      <AppShell
        bare={wide}
        bar={<SiteLinks bar />}
        nav={
          <AppNav
            me={me}
            teams={memberships.teams}
            current={current}
            unread={unread.data ?? 0}
            theme={theme}
            onThemeChange={site.onThemeChange}
            onSignOut={site.onSignOut}
            watching={memberships.watching}
            currentTeam={currentTeam}
          />
        }
      >
        <Outlet />
      </AppShell>
    </SiteProvider>
  )
}

// No page here, or one you can't see: they look the same, on purpose (an idea you can't see doesn't say
// it exists), so say both, and offer a way to find what was meant.
function NotFound() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <Page>
      <PageHeader title="Not found" />
      <Empty action={<Link href="/">Go home</Link>}>
        There’s no page here, or you don’t have access to it. If someone sent you the link, ask them to share it with
        you.
      </Empty>
      <form
        className="not-found-search"
        onSubmit={(event) => {
          event.preventDefault()
          if (q.trim()) {
            void navigate({ to: '/ideas', search: { q: q.trim() } })
          }
        }}
      >
        <SearchInput label="Search ideas" placeholder="Search ideas by title" value={q} onChange={setQ} />
      </form>
    </Page>
  )
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The nav link this page is under. */
    nav?: NavPage
    /** The page needs the width: no site navigation, so it gives its own way home (an idea's document). */
    wide?: boolean
  }
}
