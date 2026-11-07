import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { ContainerList } from './ContainerList.tsx'

const meta = {
  title: 'App/ContainerList',
  component: ContainerList,
  args: {
    label: 'Teams',
    empty: 'No teams yet.',
    items: [
      { id: 't1', handle: 'mobile', name: 'Mobile', description: 'The field app.', members: 12, href: '/mobile' },
      { id: 't2', handle: 'payments', name: 'Payments', description: '', members: 1, href: '/payments' },
      {
        id: 't3',
        handle: 'legacy-billing-platform-migration',
        name: 'Legacy billing platform migration working group',
        description: 'Moving the old billing system onto the new platform, one service at a time.',
        members: 3,
        href: '/legacy-billing-platform-migration',
        archived: true,
      },
    ],
  },
} satisfies Meta<typeof ContainerList>

export default meta
type Story = StoryObj<typeof meta>

export const Teams: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('link', { name: 'Mobile' })).toHaveAttribute('href', '/mobile')
    await expect(list.getByText('1 member')).toBeVisible()
  },
}

export const None: Story = { args: { items: [] } }
