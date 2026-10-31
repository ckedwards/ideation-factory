#!/usr/bin/env bun
// Freezes each schema's current version, after adding a migration:
//   bun packages/server/src/migrations/freeze.ts
// writes migrations/frozen/<schema>-v<version>.sql for any version not frozen
// yet. A frozen file is never changed afterwards: it's what an existing actor's
// database looks like at that version, and the tests upgrade from it.
import { existsSync } from 'node:fs'
import { dump, emptyDatabase, frozenPath, SCHEMAS } from './schemas.ts'

for (const schema of SCHEMAS) {
  const path = frozenPath(schema.name, schema.version)
  if (existsSync(path)) {
    console.log(`${schema.name} v${schema.version} is already frozen`)
    continue
  }
  const { db, sql } = emptyDatabase()
  await schema.migrate(sql)
  await Bun.write(path, dump(db, schema.version))
  console.log(`froze ${schema.name} v${schema.version} → ${path}`)
}
