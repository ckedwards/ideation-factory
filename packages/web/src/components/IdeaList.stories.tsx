import type { Meta, StoryObj } from '@storybook/react-vite'
import { ideas } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { IdeaList } from './IdeaList.tsx'

const meta = {
  title: 'App/IdeaList',
  component: IdeaList,
  args: { ideas: Object.values(ideas), empty: 'No ideas yet.' },
} satisfies Meta<typeof IdeaList>

export default meta
type Story = StoryObj<typeof meta>

export const Several: Story = {}

// More to load: a button that loads them
export const More: Story = {
  args: { more: { loading: false, onMore: fn() } },
  play: async ({ args, canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Show more' }))
    await expect(args.more!.onMore).toHaveBeenCalled()
  },
}

export const LoadingMore: Story = { args: { more: { loading: true, onMore: fn() } } }

// A search: the words highlighted
export const Search: Story = { args: { query: 'sync' } }

// None: says why
export const None: Story = {
  args: { ideas: [], empty: 'No ideas you can see match “zebra”.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No ideas you can see match “zebra”.')).toBeVisible()
  },
}
