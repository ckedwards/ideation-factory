import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { CopyText } from './CopyText.tsx'

const meta = {
  title: 'Labels/CopyText',
  component: CopyText,
  args: { text: 'mobile/idea/9', label: 'The idea’s address' },
} satisfies Meta<typeof CopyText>

export default meta
type Story = StoryObj<typeof meta>

// Copying puts the text on the clipboard and says so
export const Copying: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const write = fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const label = within(canvasElement)
    await userEvent.click(label.getByRole('button', { name: 'Copy the idea’s address' }))
    await expect(write).toHaveBeenCalledWith('mobile/idea/9')
    await expect(await label.findByRole('button', { name: 'The idea’s address copied' })).toHaveTextContent('Copied')
  },
}
