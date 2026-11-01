import type { Meta, StoryObj } from '@storybook/react-vite'
import { PageHeader } from './PageHeader.tsx'
import { Button } from '../controls/Button.tsx'
import { Tag } from '../labels/Tag.tsx'
import { Link } from '../link/Link.tsx'

const meta = {
  title: 'Page/PageHeader',
  component: PageHeader,
  args: { title: 'Ideas', sub: 'Every idea you can see, across all teams.' },
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

export const TitleAndSub: Story = {}

export const TitleOnly: Story = { args: { sub: undefined } }

export const WithActions: Story = {
  args: {
    actions: (
      <>
        <Button>Import</Button>
        <Button variant="primary">New idea</Button>
      </>
    ),
  },
}

export const WithCrumbs: Story = {
  args: {
    title: (
      <>
        Mobile <Tag tone="faint">2,148 members</Tag>
      </>
    ),
    sub: 'The field app, on iOS and Android.',
    crumbs: <Link href="#teams">Teams</Link>,
    actions: <Button>Team settings</Button>,
  },
}

export const LongTitle: Story = {
  args: {
    title: 'Platform Reliability, Observability and Developer Experience Working Group',
    sub: 'Ideas for making the platform easier to run, to watch, and to build on, from every team that depends on it.',
    actions: <Button variant="primary">New idea</Button>,
  },
}
