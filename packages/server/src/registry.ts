import { setup } from 'rivetkit'
import { directory } from './actors/directory.ts'
import { idea } from './actors/idea.ts'

export const registry = setup({ use: { idea, directory } })
export type Registry = typeof registry
