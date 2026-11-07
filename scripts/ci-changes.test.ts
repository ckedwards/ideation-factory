import { describe, expect, test } from 'bun:test'
import { dependencies, needsStories, STORIES } from './ci-changes.ts'

/** A small bun.lock: ui uses react and core; core uses zod; the server uses jose, and its own (newer) zod. */
function lock(versions: { react?: string; zod?: string; serverZod?: string; jose?: string; extra?: boolean } = {}) {
  const { react = '19.3.1', zod = '4.6.7', serverZod = '4.7.0', jose = '6.2.14', extra = false } = versions
  return `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "root" },
    "packages/core": { "name": "@ideaf/core", "dependencies": { "zod": "^4" } },
    "packages/server": { "name": "@ideaf/server", "dependencies": { "@ideaf/core": "workspace:*", "jose": "6", "zod": "^4.7"${extra ? ', "samlify": "2"' : ''} } },
    "packages/ui": { "name": "@ideaf/ui", "dependencies": { "react": "^19" }, "devDependencies": { "@ideaf/core": "workspace:*" } },
  },
  "packages": {
    "@ideaf/core": ["@ideaf/core@workspace:packages/core"],
    "@ideaf/server": ["@ideaf/server@workspace:packages/server"],
    "@ideaf/ui": ["@ideaf/ui@workspace:packages/ui"],
    "jose": ["jose@${jose}", "", {}, "sha512-x"],
    "react": ["react@${react}", "", { "dependencies": { "scheduler": "^0.27" } }, "sha512-x"],
    "scheduler": ["scheduler@0.27.0", "", {}, "sha512-x"],
    "zod": ["zod@${zod}", "", {}, "sha512-x"],
    "@ideaf/server/zod": ["zod@${serverZod}", "", {}, "sha512-x"],${extra ? '\n    "samlify": ["samlify@2.15.1", "", {}, "sha512-x"],' : ''}
  }
}
`
}

describe('the packages the stories build from', () => {
  test('ui, core, and what they need in turn; not what only the server needs', () => {
    expect([...dependencies(lock(), STORIES.ui)].sort()).toEqual([
      '@ideaf/core@workspace:packages/core',
      '@ideaf/ui@workspace:packages/ui',
      'react@19.3.1',
      'scheduler@0.27.0',
      'zod@4.6.7',
    ])
  })
})

describe('whether a change needs the story tests', () => {
  test('a change to ui, core, the root package.json, the TypeScript settings or the workflow does', () => {
    for (const file of [
      'packages/ui/src/Button.tsx',
      'packages/core/src/markdown.ts',
      'package.json',
      'tsconfig.base.json',
      '.github/workflows/ci.yml',
    ]) {
      expect(needsStories('ui', [file])).toBe(true)
      expect(needsStories('web', [file])).toBe(true)
    }
  })

  test('a change elsewhere does not', () => {
    const elsewhere = ['packages/server/src/app.ts', 'packages/cli/package.json', 'docs/cli.md', 'README.md']
    expect(needsStories('ui', elsewhere)).toBe(false)
    expect(needsStories('web', elsewhere)).toBe(false)
  })

  test('a lockfile change does only if it changes what ui or core resolve to', () => {
    const lockChange = (after: string) =>
      needsStories('ui', ['bun.lock', 'packages/server/package.json'], { before: lock(), after })
    // the server gains a package, or moves its own copy of one ui also uses
    expect(lockChange(lock({ extra: true }))).toBe(false)
    expect(lockChange(lock({ jose: '6.3.0' }))).toBe(false)
    expect(lockChange(lock({ serverZod: '4.8.0' }))).toBe(false)
    // ui's react, or core's zod, moves
    expect(lockChange(lock({ react: '19.3.2' }))).toBe(true)
    expect(lockChange(lock({ zod: '4.6.8' }))).toBe(true)
  })
})

describe("web's stories", () => {
  test('need the web app, and what it builds from: ui, core and the API client', () => {
    for (const file of ['packages/web/src/routes/index.tsx', 'packages/api/src/operations.ts']) {
      expect(needsStories('web', [file])).toBe(true)
      expect(needsStories('ui', [file])).toBe(false)
    }
    // a change to ui is seen by both
    expect(needsStories('web', ['packages/ui/src/Button.tsx'])).toBe(true)
  })
})
