import { setup } from 'rivetkit'
import { directory } from './actors/directory.ts'
import { idea } from './actors/idea.ts'
import { search } from './actors/search.ts'
import { MAX_MESSAGE_BYTES } from './limits.ts'

export const registry = setup({
  use: { idea, directory, search },
  // an idea's files go to its actor in one call and come back in one answer (limits.ts)
  maxIncomingMessageSize: MAX_MESSAGE_BYTES,
  maxOutgoingMessageSize: MAX_MESSAGE_BYTES,
})
export type Registry = typeof registry
