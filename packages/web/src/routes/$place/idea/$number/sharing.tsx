// An idea's sharing: a dialog over its overview now. This address still works, and opens it.
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/$place/idea/$number/sharing')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$place/idea/$number', params, search: { sharing: true }, replace: true })
  },
})
