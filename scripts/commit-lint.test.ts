import { describe, expect, test } from 'bun:test'
import { lintCommitMessage } from './commit-lint.ts'

const BODY = '\n\nExplains why the change was made, in a sentence or two.'
const ok = (message: string) => expect(lintCommitMessage(message)).toEqual([])
const bad = (message: string, problem: string) => expect(lintCommitMessage(message).join('\n')).toContain(problem)

describe('the first line', () => {
  test('type, optional package scope, summary', () => {
    ok(`feat(server): add the directory actor${BODY}`)
    ok(`fix: correct search across packages${BODY}`)
    ok(`build(dev-infra): give each worktree its own engine${BODY}`)
    ok('docs: describe the access model')
  })

  test('only the listed types; there is no chore', () => {
    bad(`chore: tidy up${BODY}`, 'there is no "chore"')
    bad(`feature: add x${BODY}`, '"feature" isn\'t a commit type')
  })

  test('only package scopes, and docs has none', () => {
    bad(`test(directory): search with a longer word${BODY}`, '"directory" isn\'t a scope')
    bad('docs(server): describe it', 'docs commits have no scope')
  })

  test('the summary: imperative, lowercase start, no full stop', () => {
    bad(`feat(cli): Add unlock${BODY}`, 'lowercase')
    bad(`feat(cli): add unlock.${BODY}`, 'full stop')
    bad(`feat(cli): added unlock${BODY}`, 'imperative')
    bad(`fix(core): fixes the anchor${BODY}`, 'imperative')
    ok(`fix(core): handle RTL text in anchors${BODY}`)
  })

  test('a malformed first line says what the format is', () => {
    bad('Update stuff', 'must be "<type>(<scope>): <summary>"')
    bad(`feat(server):missing space${BODY}`, 'must be')
  })
})

describe('the body', () => {
  test('is required, except for docs', () => {
    bad('feat(server): add the directory', 'need a body')
    bad('feat(server): add the directory\n\nToo short.', 'need a body')
    ok('docs: fix a typo')
  })

  test('comes after a blank line', () => {
    bad('feat(server): add it\nNo blank line before this explanation.', 'blank line')
  })

  test("git's comments and trailers don't count", () => {
    ok(`feat(cli): add unlock${BODY}\n\n# Please enter the commit message\n# Lines starting with '#' are ignored`)
    bad('feat(cli): add unlock\n\nCo-Authored-By: Someone <a@b.c>', 'need a body')
  })
})

describe('breaking changes', () => {
  const footer = '\n\nBREAKING CHANGE: the batch format renames `in` to `scope`.\n\nRename the field in saved batches.'

  test('need "!" in the title and a BREAKING CHANGE footer', () => {
    ok(`feat(api)!: rename the batch scope field${BODY}${footer}`)
    ok(`refactor!: drop the v1 routes${BODY}${footer}`)
  })

  test('"!" without the footer, or the footer without "!", is refused', () => {
    bad(`feat(api)!: rename the batch scope field${BODY}`, 'needs a "BREAKING CHANGE:')
    bad(`feat(api): rename the batch scope field${BODY}${footer}`, 'needs "!" in the title')
    bad(`feat(api)!: rename it${BODY}\n\nBreaking change: different spelling`, 'exactly as "BREAKING CHANGE:')
  })
})

describe('other kinds of commit', () => {
  test('reverts name the commit', () => {
    ok('revert: feat(cli): add unlock\n\nThis reverts commit 83fe0e9 because it broke CI on Windows.')
    bad('revert: feat(cli): add unlock\n\nIt broke CI on Windows, so take it out for now.', 'This reverts commit')
  })

  test("git's merge commits are left alone; fixups only while working", () => {
    ok("Merge branch 'step-5/directory'")
    bad('fixup! feat(cli): add unlock', 'squash it before it lands')
    expect(lintCommitMessage('fixup! feat(cli): add unlock', { allowFixups: true })).toEqual([])
  })
})
