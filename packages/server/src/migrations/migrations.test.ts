// Schema changes: every actor's database must reach the same schema however old
// it is, and keep its data. See "Schema changes" in docs/mvp/architecture-backend.md.
//
// During the alpha there are no migrations: a schema change edits v1 in place
// and re-freezes it (delete frozen/<schema>-v1.sql, then run freeze.ts), and
// local data is thrown away (see AGENTS.md). Once something ships:
//
// When you add a migration:
// 1. append it (never edit a migration that has shipped);
// 2. run `bun packages/server/src/migrations/freeze.ts` to freeze the new version;
// 3. add a test below that writes data the way the previous version did,
//    migrates, and reads it back the way the new code does.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { contentHash } from '@ideaf/core'
import { inProcessCore } from '../core-pool/runner.ts'
import { COLUMNS } from '../directory/schema.ts'
import { IDEA_COLUMNS } from '../idea/schema.ts'
import { fts5Search } from '../directory/search.ts'
import { SqlDirectory } from '../directory/sql-directory.ts'
import { MemoryFileStore } from '../files/memory.ts'
import { IdeaService } from '../idea/service.ts'
import { DEFAULT_LIMITS } from '../limits.ts'
import { emptyDatabase, frozenPath, loadFrozen, SCHEMAS, schemaStatements } from './schemas.ts'

for (const schema of SCHEMAS) {
  describe(`${schema.name} schema`, () => {
    test('every version is frozen', () => {
      for (let v = 1; v <= schema.version; v++) {
        if (!existsSync(frozenPath(schema.name, v))) {
          throw new Error(`${schema.name} v${v} isn't frozen: run \`bun packages/server/src/migrations/freeze.ts\``)
        }
      }
    })

    test('upgrading from every frozen version gives the same schema as a fresh database', async () => {
      const fresh = emptyDatabase()
      await schema.migrate(fresh.sql)
      const expected = schemaStatements(fresh.db)
      for (let v = 1; v <= schema.version; v++) {
        const old = loadFrozen(await Bun.file(frozenPath(schema.name, v)).text())
        await schema.migrate(old.sql)
        // differs if a shipped migration was edited instead of a new one appended
        expect(schemaStatements(old.db), `upgrading ${schema.name} from v${v}`).toEqual(expected)
        expect(old.db.query('SELECT version FROM schema_version').all()).toEqual([{ version: schema.version }])
      }
    })

    test('migrating again changes nothing', async () => {
      const { db, sql } = emptyDatabase()
      await schema.migrate(sql)
      const once = schemaStatements(db)
      await schema.migrate(sql)
      expect(schemaStatements(db)).toEqual(once)
    })
  })
}

test("the idea actor's types match its schema", async () => {
  const idea = SCHEMAS.find((s) => s.name === 'idea')!
  const { db, sql } = emptyDatabase()
  await idea.migrate(sql)
  const tables = (
    db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
  ).map((t) => t.name)
  expect(tables).toEqual(Object.keys(IDEA_COLUMNS).toSorted())
  for (const [table, columns] of Object.entries(IDEA_COLUMNS)) {
    const actual = (db.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name)
    expect(actual.toSorted(), `columns of ${table}`).toEqual([...columns].toSorted())
  }
})

describe("the directory's types match its schema", () => {
  test('every table and column the queries are typed against exists, and nothing else', async () => {
    const directory = SCHEMAS.find((s) => s.name === 'directory')!
    const { db, sql } = emptyDatabase()
    await directory.migrate(sql)
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
    )
      .map((t) => t.name)
      // the search index is a full-text table with its own interface, not part of DB
      .filter((name) => name !== 'idea_search' && !name.startsWith('idea_search_') && !name.startsWith('sqlite_'))
    expect(tables).toEqual(Object.keys(COLUMNS).toSorted())
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const actual = (db.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name)
      expect(actual.toSorted(), `columns of ${table}`).toEqual([...columns].toSorted())
    }
  })
})

describe('data survives migration', () => {
  test('an idea written at v1 reads back through IdeaService after migrating', async () => {
    const idea = SCHEMAS.find((s) => s.name === 'idea')!
    const { sql } = emptyDatabase()
    await idea.migrate(sql, 1)

    // rows as version 1 wrote them
    const files = new MemoryFileStore()
    const source = '# Plan\n\nThe quick brown fox.\n'
    const hash = await files.put(new TextEncoder().encode(source))
    expect(hash).toBe(await contentHash(source))
    const caller = JSON.stringify({ user: 'riley', bot: null, purpose: 'me' })
    await sql.execute("INSERT INTO idea VALUES ('i1', 'Plan', '', 'riley', 'draft', 1000, 1, 2, NULL, NULL)")
    await sql.execute("INSERT INTO versions VALUES (1, NULL, 1000, ?, 'created', 4)", caller)
    await sql.execute(`INSERT INTO version_files VALUES (1, 'f1', 'plan.md', ?, ?, '["s2","b3"]')`, hash, source.length)
    await sql.execute(
      'INSERT INTO comments (id, parent, version, author, created_at, body) VALUES (?, NULL, 1, ?, 1001, ?)',
      'c1',
      caller,
      'Which brown?',
    )
    const anchor = JSON.stringify({ kind: 'text', file: 'f1', start: 15, end: 20, quote: 'brown' })
    await sql.execute("INSERT INTO anchors VALUES ('c1', 1, 'exact', ?)", anchor)

    await idea.migrate(sql)
    const service = new IdeaService('i1', { sql, files, core: inProcessCore(), limits: DEFAULT_LIMITS })
    expect(await service.summary()).toMatchObject({ title: 'Plan', owner: 'riley', latest: 1 })
    expect((await service.pull()).files).toEqual([{ file: 'f1', path: 'plan.md', hash, content: source }])
    expect((await service.comments())[0]).toMatchObject({ id: 'c1', state: 'exact', anchor: { quote: 'brown' } })
    // and it takes new writes
    const write = await service.write({
      key: 'k',
      caller: { user: 'riley', bot: null, purpose: 'me' },
      write: { type: 'edit', batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'brown', new: 'red' }] } },
    })
    expect(write.result).toMatchObject({ ok: true, value: { version: 2 } })
  })

  test('the directory written at v1 reads back through SqlDirectory after migrating', async () => {
    const directory = SCHEMAS.find((s) => s.name === 'directory')!
    const { sql } = emptyDatabase()
    await directory.migrate(sql, 1)

    // rows as version 1 wrote them
    await sql.execute(
      "INSERT INTO users VALUES ('u-riley', 'riley', 'Riley', NULL, 0, 1), ('u-maya', 'maya', 'Maya', NULL, 0, 1)",
    )
    await sql.execute(
      `INSERT INTO teams VALUES ('t1', 'core', 'Core', '', 'u-riley', 1, 0, 'members', '{"members":"view","public":false,"groups":[]}')`,
    )
    await sql.execute(
      "INSERT INTO memberships VALUES ('team', 't1', 'u-riley', 'admin', 1), ('team', 't1', 'u-maya', 'member', 1)",
    )
    await sql.execute("INSERT INTO ideas VALUES ('i1', 'Offline sync', 't1', 'u-riley', 'draft', 1, 1, 1)")
    await sql.execute("INSERT INTO grants VALUES ('i1', 'team', 't1', 0, 0, 1)")
    await sql.execute("INSERT INTO idea_search (id, title) VALUES ('i1', 'Offline sync')")

    await directory.migrate(sql)
    const d = new SqlDirectory({ sql, search: fts5Search() })
    expect(await d.permission('i1', 'u-maya')).toEqual({ view: true, edit: false, share: false, owner: false })
    expect((await d.listIdeas('u-maya')).items.map((i) => i.id)).toEqual(['i1'])
    expect((await d.searchIdeas('u-maya', 'offline')).items.map((i) => i.id)).toEqual(['i1'])
    expect((await d.team('core'))!.members).toBe(2)
  })
})
