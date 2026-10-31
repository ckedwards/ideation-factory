// Approach 1's schema: Better Auth's own migration tooling (getMigrations, what
// `auth generate` prints) run against an empty in-memory bun:sqlite database
// with the same plugins, written to schema.sql. The directory actor applies
// that file in onMigrate. Also writes schema.md: every table and column.
//
//   bun src/gen-schema.ts
import { Database } from 'bun:sqlite'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from './auth.ts'

const db = new Database(':memory:')
const options = authOptions(db)
const { toBeCreated, toBeAdded, compileMigrations, runMigrations } = await getMigrations(options as never)
const sql = await compileMigrations()
await Bun.write(new URL('../schema.sql', import.meta.url), sql)
console.log(`schema.sql: ${toBeCreated.length} tables, ${toBeAdded.length} additions`)

// Apply it and describe what we got, from SQLite itself.
await runMigrations()
const lines: string[] = ['# Better Auth schema (generated)', '', 'From `bun src/gen-schema.ts`: Better Auth 1.7.14 with this spike\'s plugins, on SQLite.', '']
for (const { name } of db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]) {
  lines.push(`## ${name}`, '', '| column | type | not null | key |', '|---|---|---|---|')
  const fks = db.query(`PRAGMA foreign_key_list("${name}")`).all() as { from: string; table: string; to: string; on_delete: string }[]
  for (const c of db.query(`PRAGMA table_info("${name}")`).all() as { name: string; type: string; notnull: number; pk: number }[]) {
    const fk = fks.find((f) => f.from === c.name)
    lines.push(`| ${c.name} | ${c.type} | ${c.notnull ? 'yes' : ''} | ${c.pk ? 'primary' : fk ? `→ ${fk.table}.${fk.to} (${fk.on_delete})` : ''} |`)
  }
  const idx = db.query(`PRAGMA index_list("${name}")`).all() as { name: string; unique: number; origin: string }[]
  for (const i of idx) {
    const cols = (db.query(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).map((x) => x.name)
    lines.push(`- ${i.unique ? 'unique' : 'index'} (${cols.join(', ')})${i.origin === 'pk' ? ' [pk]' : ''}`)
  }
  lines.push('')
}
await Bun.write(new URL('../schema.md', import.meta.url), lines.join('\n'))
console.log('schema.md written')
