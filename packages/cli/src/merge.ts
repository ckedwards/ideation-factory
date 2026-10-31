// A 3-way merge of a file: your copy and the server's, from the base they both
// came from. Conflicting regions are left with git-style markers.
import { merge } from 'node-diff3'

export function mergeFile(local: string, base: string, server: string, serverLabel: string): { content: string; conflict: boolean } {
  if (local === server) return { content: local, conflict: false }
  if (local === base) return { content: server, conflict: false }
  if (server === base) return { content: local, conflict: false }
  const merged = merge(local.split('\n'), base.split('\n'), server.split('\n'), {
    excludeFalseConflicts: true,
    label: { a: 'yours', b: serverLabel },
  })
  return { content: merged.result.join('\n'), conflict: merged.conflict }
}
