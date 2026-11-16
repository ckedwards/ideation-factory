// Every page: signed in first (to the sign-in page if not), then the app's
// frame, its navigation beside the page.
import { useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, redirect, useMatches } from '@tanstack/react-router'
import { AppShell, Empty, Link, Page, PageHeader, type Theme } from '@ideaf/ui'
import { membershipsQuery, meQuery, unreadQuery } from '../api.ts'
import { AppNav, type NavPage } from '../components/AppNav.tsx'
import { QuickSearch } from '../components/QuickSearch.tsx'
import { SiteLinks } from '../components/SiteLinks.tsx'
import { accessToken, SignedOut, signInHref, signOut } from '../session.ts'
import { savedTheme, setTheme } from '../theme.ts'

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
  return (
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
          onThemeChange={(next) => {
            pickTheme(next)
            setTheme(next)
          }}
          onSignOut={() => void signOut()}
          search={<QuickSearch />}
        />
      }
    >
      <Outlet />
    </AppShell>
  )
}

function NotFound() {
  return (
    <Page>
      <PageHeader title="Not found" />
      <Empty action={<Link href="/">Go home</Link>}>There’s no page here.</Empty>
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
