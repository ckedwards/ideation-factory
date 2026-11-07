// What changed needs a range (/changes/1..3); without one, the overview.
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/$place/idea/$number/changes/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$place/idea/$number', params, replace: true })
  },
})
