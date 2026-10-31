import { bunSql } from '../idea/sql-bun.ts'
import { directoryContract } from './contract.ts'
import { migrateDirectory } from './schema.ts'
import { fts5Search } from './search.ts'
import { SqlDirectory } from './sql-directory.ts'

directoryContract('SqlDirectory on SQLite', async () => {
  const sql = bunSql()
  const search = fts5Search()
  await migrateDirectory(sql, [search.migrate])
  return new SqlDirectory({ sql, search })
})
