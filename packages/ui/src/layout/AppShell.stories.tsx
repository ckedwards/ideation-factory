import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { AppShell } from './AppShell.tsx'
import { Page, Section } from './Page.tsx'
import { SideNav } from './SideNav.tsx'
import { Stack } from './Stack.tsx'
import { Button } from '../controls/Button.tsx'
import { ThemeToggle, type Theme } from '../controls/ThemeToggle.tsx'
import { IdeaRow } from '../ideas/IdeaRow.tsx'
import { PageHeader } from '../page/PageHeader.tsx'
import { Empty } from '../page/Empty.tsx'
import { UserName } from '../people/UserName.tsx'
import { ideas, riley } from '../stories/fixtures.ts'

// the app's bar: only what's global, the site's name and you
function Bar() {
  const [theme, setTheme] = useState<Theme>('auto')
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <strong>✳ Ideation Factory</strong>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <ThemeToggle value={theme} onChange={setTheme} />
        <UserName person={riley} withAvatar />
      </span>
    </div>
  )
}

function Nav() {
  return (
    <SideNav
      groups={[
        {
          items: [
            { href: '#home', label: 'Home', current: true },
            { href: '#ideas', label: 'Ideas' },
            { href: '#me', label: '🔒 Your ideas' },
            { href: '#teams', label: 'Teams' },
            { href: '#groups', label: 'Groups' },
            { href: '#admin', label: 'Site admin', admin: true },
          ],
        },
        {
          title: 'Your teams',
          items: [
            { href: '#teams/mobile', label: 'Mobile', note: 'All' },
            { href: '#teams/payments', label: 'Payments', count: 4 },
            { href: '#teams/security', label: '🔒 Security', note: 'Active' },
          ],
        },
      ]}
    />
  )
}

const meta = {
  title: 'Layout/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  args: { nav: <Nav />, bar: <Bar />, children: null },
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

// The home page, built only from components, as a page in the app would be
export const HomePage: Story = {
  args: {
    children: (
      <Page>
        <PageHeader
          title="Home"
          sub="What’s waiting on you, and your open ideas."
          actions={<Button variant="primary">New idea</Button>}
        />
        <Section title="Waiting on your review" action={<a href="#notifications">See all</a>}>
          <Stack gap={2}>
            <IdeaRow idea={ideas.inReview} />
            <IdeaRow idea={ideas.requirementsMet} />
          </Stack>
        </Section>
        <Section title="Your open ideas">
          <Stack gap={2}>
            <IdeaRow idea={ideas.draft} hide={{ author: true }} />
            <IdeaRow idea={ideas.private} hide={{ author: true }} />
          </Stack>
        </Section>
      </Page>
    ),
  },
}

export const EmptyPage: Story = {
  args: {
    children: (
      <Page>
        <PageHeader title="Notifications" />
        <Empty>You’re all caught up.</Empty>
      </Page>
    ),
  },
}

// A page that needs the width (an idea's): no navigation column, but the bar is still across the top
export const Bare: Story = {
  args: {
    bare: true,
    children: (
      <Page>
        <PageHeader title="Move background jobs to a queue" />
        <p>The document has the whole width.</p>
      </Page>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('link', { name: 'Home' })).toBeNull()
    await expect(canvasElement.querySelector('.app-shell-bar')).toHaveTextContent('Ideation Factory')
    await expect(canvas.getByRole('main')).toHaveTextContent('The document has the whole width.')
  },
}

// A phone: the same bar, with the navigation behind Menu at its end, over the page; a link in it closes it.
export const Phone: Story = {
  globals: { viewport: { value: 'mobile2' } },
  args: {
    children: (
      <Page>
        <PageHeader title="Home" />
        <p>The page starts at the top, under the bar.</p>
      </Page>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const menu = canvas.getByRole('button', { name: 'Menu' })
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    menu.click()
    await expect(await canvas.findByRole('button', { name: 'Close', hidden: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // following a link closes it (the story's links go nowhere)
    const teams = canvas.getByRole('link', { name: 'Teams', hidden: true })
    teams.addEventListener('click', (event) => event.preventDefault())
    teams.click()
    await expect(await canvas.findByRole('button', { name: 'Menu', hidden: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}
