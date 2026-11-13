import { setup } from 'rivetkit'
import { directory } from './actors/directory.ts'
import { idea } from './actors/idea.ts'
import { search } from './actors/search.ts'

export const registry = setup({ use: { idea, directory, search } })
export type Registry = typeof registry
