// PROTOTYPE: experiment 1, the idea page, at /prototype/idea.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRootRoute, createRoute, createRouter, Outlet, redirect, RouterProvider } from '@tanstack/react-router'
import './theme.css'
import { StoreProvider } from './store'
import { parseSearch } from './lib'
import { IdeaPage } from './IdeaPage'
import { DevState } from './DevState'

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/prototype/idea' } as never)
  },
})

const ideaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prototype/idea',
  validateSearch: parseSearch,
  component: () => (
    <>
      <IdeaPage />
      <DevState />
    </>
  ),
})

const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, ideaRoute]) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  </StrictMode>,
)
