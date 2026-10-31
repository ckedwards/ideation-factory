import { setup } from 'rivetkit'
import { idea } from './actors/idea.ts'

export const registry = setup({ use: { idea } })
export type Registry = typeof registry
