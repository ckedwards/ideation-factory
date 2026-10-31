import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileStoreContract } from './contract.ts'
import { LocalFolderFileStore } from './local-folder.ts'

const folders: string[] = []
async function emptyFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'ideaf-files-'))
  folders.push(folder)
  return folder
}
afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })))
})

fileStoreContract('LocalFolderFileStore', async () => new LocalFolderFileStore(await emptyFolder()))

test('LocalFolderFileStore leaves no temporary files behind', async () => {
  const root = await emptyFolder()
  const store = new LocalFolderFileStore(root)
  const hash = await store.put(new TextEncoder().encode('content'))
  expect(await readdir(join(root, hash.slice(0, 2)))).toEqual([hash])
})

test('LocalFolderFileStore survives concurrent puts of the same content', async () => {
  const store = new LocalFolderFileStore(await emptyFolder())
  const content = new TextEncoder().encode('raced')
  const hashes = await Promise.all(Array.from({ length: 20 }, () => store.put(content)))
  expect(new Set(hashes).size).toBe(1)
  expect(await store.get(hashes[0]!)).toEqual(content)
})
