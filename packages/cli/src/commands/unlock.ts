// ideaf unlock: remove an idea's lock left by an ideaf that crashed, was
// interrupted, or ran on another machine with the repository on a shared disk.
// Like `rm .git/index.lock` for git, but it says who held it, and won't remove
// one held by an ideaf still running here unless forced.
import { CliError, type Context, EXIT } from '../context.ts'
import { lockHolder, removeLock } from '../workspace.ts'

export async function unlock(ctx: Context, flags: { idea?: string; force?: boolean }): Promise<number> {
  const id = await ctx.ideaId(flags.idea)
  const lock = await lockHolder(ctx.ws, id)
  if (!lock) {
    ctx.say(`${id} isn't locked.`)
    ctx.result({ idea: id, removed: false, holder: null })
    return EXIT.ok
  }
  const who = lock.holder
    ? `pid ${lock.holder.pid} on ${lock.holder.host}, since ${new Date(lock.holder.at).toISOString()}`
    : 'an unknown process'
  if (lock.running && !flags.force) {
    throw new CliError(
      `${id} is locked by an ideaf that's still running (${who}); wait for it, or pass --force to remove the lock anyway`,
      EXIT.busy,
      'busy',
      lock.holder ?? undefined,
    )
  }
  await removeLock(ctx.ws, id)
  ctx.say(`Removed the lock on ${id} (held by ${who}).`)
  ctx.result({ idea: id, removed: true, holder: lock.holder })
  return EXIT.ok
}
