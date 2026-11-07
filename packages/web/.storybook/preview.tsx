// The same themes, text sizes, fixed "now" and accessibility checks as ui's
// stories, and a query client for the components that search the server as
// someone types (nothing is fetched until they do).
// An object here, not the import itself, so Storybook can read it without running it.
import type { Decorator } from '@storybook/react-vite'
import preview from '@ideaf/ui/storybook'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const withQueryClient: Decorator = (Story) => (
  <QueryClientProvider client={queryClient}>
    <Story />
  </QueryClientProvider>
)

export default { ...preview, decorators: [...(preview.decorators as Decorator[]), withQueryClient] }
