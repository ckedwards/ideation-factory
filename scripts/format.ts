#!/usr/bin/env bun
// `bun run format`: fixes what oxlint can (repeating, since one pass can leave
// a nested body unbraced), lays the code out with oxfmt, then reports anything
// left that needs a person.
const paths = ['packages', 'scripts']

for (let pass = 0; pass < 10; pass++) {
  const fixed = Bun.spawnSync(['bunx', 'oxlint', '--fix', ...paths], { stdout: 'pipe', stderr: 'pipe' })
  if (fixed.exitCode === 0) {
    break
  }
}
Bun.spawnSync(['bunx', 'oxfmt', ...paths], { stdout: 'pipe', stderr: 'pipe' })
const check = Bun.spawnSync(['bunx', 'oxlint', ...paths], { stdio: ['inherit', 'inherit', 'inherit'] })
process.exit(check.exitCode ?? 1)
