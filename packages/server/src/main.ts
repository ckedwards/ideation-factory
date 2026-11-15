// @ideaf/server: one app node (node.ts). Its settings come first (settings/start.ts), as RivetKit
// takes the engine's from them when the registry is set up: so the node, and the registry with it,
// is imported only once they're applied.
import { startWithSettings } from './settings/start.ts'

const settings = startWithSettings()
const { startNode } = await import('./node.ts')
await startNode(settings)
