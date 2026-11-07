// The web app: the router (routes are the files in routes/), the server's
// data through TanStack Query, and ui's links navigating with the router.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError } from '@ideaf/api'
import { applyTheme, LinkProvider } from '@ideaf/ui'
import '@ideaf/ui/theme.css'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { RouterLink } from './link.tsx'
import { routeTree } from './routeTree.gen.ts'
import { signIn } from './session.ts'
import { savedTheme } from './theme.ts'

const queryClient = new QueryClient({
  // the session ended (signed out elsewhere, or marked inactive): sign in again
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'unauthorized') {
        signIn()
      }
    },
  }),
  // the client already retries what's worth retrying (a dropped connection, a 503)
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // a link's data starts loading on hover; Query decides whether it's still fresh
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

applyTheme(savedTheme())

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LinkProvider value={RouterLink}>
        <RouterProvider router={router} />
      </LinkProvider>
    </QueryClientProvider>
  </StrictMode>,
)
