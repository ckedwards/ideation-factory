import type { Meta, StoryObj } from '@storybook/react-vite'
import { Row, Stack } from './Stack.tsx'
import { Button } from '../controls/Button.tsx'
import { StatusPill } from '../ideas/StatusPill.tsx'
import { Tag } from '../labels/Tag.tsx'

const meta = { title: 'Layout/Stack and Row', component: Stack, args: { children: null } } satisfies Meta<typeof Stack>

export default meta
type Story = StoryObj<typeof meta>

export const StackGaps: Story = {
  render: () => (
    <Row gap={6} align="start">
      {([1, 3, 5] as const).map((gap) => (
        <Stack key={gap} gap={gap}>
          <Tag>gap {gap}</Tag>
          <StatusPill status="draft" />
          <StatusPill status="requesting review" />
        </Stack>
      ))}
    </Row>
  ),
}

export const RowToolbar: Story = {
  render: () => (
    <Row justify="between">
      <Row>
        <Button size="sm">Open</Button>
        <Button size="sm">Closed</Button>
      </Row>
      <Button variant="primary">New idea</Button>
    </Row>
  ),
}

// Wraps onto more lines when there isn't room
export const RowWrapping: Story = {
  render: () => (
    <div style={{ maxWidth: '16rem' }}>
      <Row>
        {['Mobile', 'Payments', 'Platform', 'Docs', 'Security', 'Design'].map((name) => (
          <Tag key={name}>{name}</Tag>
        ))}
      </Row>
    </div>
  ),
}
