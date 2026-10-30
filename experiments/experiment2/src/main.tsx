// PROTOTYPE: experiment 2, the rest of the site around the idea page.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import './theme.css'
import './site.css'
import { StoreProvider } from './store'
import { Layout } from './Layout'
import { Home } from './pages/Home'
import { Notifications } from './pages/Notifications'
import { Ideas } from './pages/Ideas'
import { Teams } from './pages/Teams'
import { TeamPage } from './pages/Team'
import { Groups } from './pages/Groups'
import { GroupPage } from './pages/Group'
import { GroupSettings, NewGroup, NewTeam, TeamSettings } from './pages/EntitySettings'
import { Settings } from './pages/Settings'
import { Admin } from './pages/Admin'
import { SignUp } from './pages/SignUp'

const rootRoute = createRootRoute({ component: Layout })
const route = (path: string, component: () => React.ReactNode) => createRoute({ getParentRoute: () => rootRoute, path, component })

const routeTree = rootRoute.addChildren([
  route('/', Home),
  route('/notifications', Notifications),
  route('/ideas', Ideas),
  route('/teams', Teams),
  route('/teams/new', NewTeam),
  route('/teams/$teamId', TeamPage),
  route('/teams/$teamId/settings', TeamSettings),
  route('/groups', Groups),
  route('/groups/new', NewGroup),
  route('/groups/$groupId', GroupPage),
  route('/groups/$groupId/settings', GroupSettings),
  route('/settings', Settings),
  route('/admin', Admin),
  route('/signup', SignUp),
])

const router = createRouter({ routeTree })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  </StrictMode>,
)
