// Every page: signed in first (to the sign-in page if not), then the app's
// frame, its navigation beside the page.
import { useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useMatches } from '@tanstack/react-router'
import { AppShell, Empty, Link, Page, PageHeader, type Theme } from '@ideaf/ui'
import { meQuery } from '../api.ts'
import { AppNav, type NavPage } from '../components/AppNav.tsx'
import { accessToken, signIn, SignedOut, signOut } from '../session.ts'
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
        signIn()
      }
      throw error
    }
  },
  loader: ({ context }) => context.queryClient.query({ ...meQuery, staleTime: 'static' }),
  component: Root,
  notFoundComponent: NotFound,
})

function Root() {
  const { data: me } = useSuspenseQuery(meQuery)
  const [theme, pickTheme] = useState<Theme>(savedTheme)
  // the deepest route that names itself in the nav
  const current = useMatches({
    select: (matches) => matches.findLast((m) => m.staticData.nav !== undefined)?.staticData.nav ?? null,
  })
  return (
    <AppShell
      nav={
        <AppNav
          me={me}
          current={current}
          theme={theme}
          onThemeChange={(next) => {
            pickTheme(next)
            setTheme(next)
          }}
          onSignOut={() => void signOut()}
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
  }
}
