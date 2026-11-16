import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { AppShell } from './AppShell.tsx'
import { Page, Section } from './Page.tsx'
import { SideNav } from './SideNav.tsx'
import { Stack } from './Stack.tsx'
import { Button } from '../controls/Button.tsx'
import { SearchInput } from '../controls/SearchInput.tsx'
import { ThemeToggle, type Theme } from '../controls/ThemeToggle.tsx'
import { IdeaRow } from '../ideas/IdeaRow.tsx'
import { PageHeader } from '../page/PageHeader.tsx'
import { Empty } from '../page/Empty.tsx'
import { UserName } from '../people/UserName.tsx'
import { ideas, riley } from '../stories/fixtures.ts'

function Nav() {
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<Theme>('auto')
  return (
    <SideNav
      brand={
        <>
          <span aria-hidden>✳</span> Ideation Factory
        </>
      }
      search={
        <SearchInput value={query} onChange={setQuery} label="Search everything" placeholder="Search" shortcut="/" />
      }
      groups={[
        {
          items: [
            { href: '#home', label: 'Home', current: true },
            { href: '#notifications', label: 'Notifications', count: 4 },
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
            { href: '#teams/payments', label: 'Payments' },
            { href: '#teams/security', label: '🔒 Security', note: 'Active' },
          ],
        },
      ]}
      footer={
        <>
          <UserName person={riley} withAvatar />
          <ThemeToggle value={theme} onChange={setTheme} />
        </>
      }
    />
  )
}

const meta = {
  title: 'Layout/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  args: { nav: <Nav />, children: null },
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

// A page that needs the width (an idea's document): no site navigation, the page gives its own way home
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
    await expect(canvas.queryByRole('link', { name: 'Notifications' })).toBeNull()
    await expect(canvas.getByRole('main')).toHaveTextContent('The document has the whole width.')
  },
}
