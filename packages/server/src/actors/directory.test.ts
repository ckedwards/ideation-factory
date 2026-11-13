// The directory actor through RivetKit: the contract's flows are covered by
// sql-directory.test.ts; this checks the actor itself, and that FTS5 with the
// trigram tokenizer works in RivetKit's own SQLite.
import { beforeAll, expect, test } from 'bun:test'
import type { Client } from 'rivetkit/client'
import type { Registry } from '../registry.ts'
import { startTestActors } from '../testing.ts'

let actors: Client<Registry>
beforeAll(async () => {
  actors = await startTestActors()
}, 60_000)

type Directory = ReturnType<Client<Registry>['directory']['getOrCreate']>

/** What a search finds once the search actor has caught up: it indexes from its queue, after the directory commits. */
async function found(d: Directory, user: string, q: string, expected: string[]): Promise<string[]> {
  let ids: string[] = []
  for (let i = 0; i < 50; i++) {
    ids = (await d.searchIdeas(user, q)).items.map((idea) => idea.id)
    if (JSON.stringify(ids) === JSON.stringify(expected)) {
      break
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return ids
}

test('teams, ideas, access, lists and search through the actor', async () => {
  // a fresh directory per test run, so earlier runs' rows don't interfere
  const d = actors.directory.getOrCreate([`test-${crypto.randomUUID()}`])
  await d.ensureUser({ id: 'u-riley', handle: 'riley', name: 'Riley' })
  await d.ensureUser({ id: 'u-maya', handle: 'maya', name: 'Maya' })
  const team = await d.createTeam('u-riley', { handle: 'core', name: 'Core' })
  if (!team.ok) {
    throw new Error(team.error.message)
  }
  await d.addMember('u-riley', 'team', team.value.id, 'u-maya')
  await d.registerIdea({
    id: 'i1',
    title: 'Offline-first sync',
    description: '',
    team: team.value.id,
    owner: 'u-riley',
    status: 'draft',
    latest: 1,
    createdAt: 1,
    updatedAt: 1,
  })

  expect(await d.permission('i1', 'u-maya')).toEqual({ view: true, edit: false, share: false, owner: false })
  expect((await d.listIdeas('u-maya')).items.map((i) => i.id)).toEqual(['i1'])
  expect(await found(d, 'u-maya', 'line', ['i1'])).toEqual(['i1'])

  // index updates arrive through the queue, without waiting, and are applied in batches
  for (let n = 2; n <= 5; n++) {
    await d.send('index', {
      id: 'i1',
      title: `Offline sync rev${n}`,
      description: '',
      status: 'draft',
      latest: n,
      openComments: n,
      updatedAt: n,
    })
  }
  for (let i = 0; i < 50 && (await d.idea('i1'))?.latest !== 5; i++) {
    await new Promise((r) => setTimeout(r, 50))
  }
  expect(await d.idea('i1')).toMatchObject({ title: 'Offline sync rev5', latest: 5, openComments: 5 })
  expect(await found(d, 'u-maya', 'rev5', ['i1'])).toEqual(['i1'])
})
