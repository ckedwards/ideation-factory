#!/usr/bin/env bun
// Operator commands, run where the server runs: they talk to the Rivet Engine
// directly (RIVET_ENDPOINT, or the local engine in development), as the
// server does, so they need no sign-in. A site admin page can call the same
// directory actions later.
//
//   bun packages/server/src/admin.ts rotate-signing-key
//       The key access tokens are signed with is replaced. Tokens it signed
//       keep working until they expire (15 minutes). Keys rotate by themselves
//       every 30 days; this is for doing it sooner.
//   bun packages/server/src/admin.ts rotate-signing-key --emergency
//       Every signing key is withdrawn, as when one may have leaked: every
//       outstanding access token stops working within a minute, and clients
//       refresh (sessions and refresh tokens aren't affected).
//   bun packages/server/src/admin.ts deactivate <handle or ID>
//       Someone has left: they're signed out everywhere, can't sign in or get
//       new tokens, and their writes are refused at once. Their ideas and
//       comments stay. (With SCIM, the identity provider does this.)
//   bun packages/server/src/admin.ts reactivate <handle or ID>
//       Lets them back in.
//   bun packages/server/src/admin.ts release-handle <@person or team>
//       Frees a squatted handle: whoever holds it gets a generated one, and no
//       old handle leads anywhere, so links through it stop working. That's
//       why it's an admin's decision.
//   bun packages/server/src/admin.ts reindex-search
//       Rebuilds the search index (the search actor's) from the directory's
//       ideas, should it be lost or out of step.
//
// In development, run it through the worktree's settings:
//   bun scripts/worktree.ts exec -- bun packages/server/src/admin.ts rotate-signing-key
import { createClient } from 'rivetkit/client'
import { directoryOf } from './actors/pools.ts'
import type { Registry } from './registry.ts'

const USAGE = `usage: bun packages/server/src/admin.ts <command>
  rotate-signing-key [--emergency]
  deactivate <handle or ID>
  reactivate <handle or ID>
  release-handle <@person or team>
  reindex-search`

export async function admin(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  const [command, ...rest] = argv
  const endpoint = env.RIVET_ENDPOINT ?? `http://127.0.0.1:${env.RIVET_RUN_ENGINE_PORT ?? 6420}`
  const directory = () => directoryOf(createClient<Registry>(endpoint))

  if (command === 'rotate-signing-key' && rest.every((f) => f === '--emergency')) {
    const emergency = rest.includes('--emergency')
    const { retired } = await directory().rotateSigningKeys(emergency)
    console.log(
      emergency
        ? `Withdrew ${retired} signing key(s): access tokens stop working within a minute, and clients refresh.`
        : `Retired ${retired} signing key(s): new tokens get a new key, and tokens already out keep working until they expire.`,
    )
    return 0
  }

  if ((command === 'deactivate' || command === 'reactivate') && rest.length === 1) {
    const inactive = command === 'deactivate'
    const found = await directory().user(rest[0]!)
    if (!found) {
      console.error(`no one is called ${rest[0]}`)
      return 1
    }
    const person = await directory().setInactive(found.id, inactive)
    const who = `@${person!.handle}${person!.name && person!.name !== person!.handle ? ` (${person!.name})` : ''}`
    console.log(
      inactive
        ? `Deactivated ${who}: signed out everywhere, no new sign-ins or tokens, and their writes are refused. Their reads stop when their access tokens expire, within 15 minutes.`
        : `Reactivated ${who}: they can sign in again.`,
    )
    return 0
  }

  if (command === 'reindex-search' && rest.length === 0) {
    const sent = await directory().reindexSearch()
    console.log(`Sent ${sent} ideas' titles to the search index; it catches up in a moment.`)
    return 0
  }

  if (command === 'release-handle' && rest.length === 1) {
    const released = await directory().releaseHandle(rest[0]!)
    const what = released.kind === 'user' ? `@${released.handle}` : `the team handle ${released.handle}`
    if (!released.owner) {
      console.error(`no one holds ${what}, and it leads nowhere: nothing to release`)
      return 1
    }
    console.log(
      released.renamedTo
        ? `Released ${what}: its holder is ${released.kind === 'user' ? '@' : ''}${released.renamedTo} now, and links through ${what} stop working.`
        : `Released ${what}: it no longer leads to its old ${released.kind === 'user' ? 'person' : 'team'}.`,
    )
    return 0
  }

  console.error(USAGE)
  return 2
}

if (import.meta.main) {
  process.exit(await admin(process.argv.slice(2), process.env))
}
