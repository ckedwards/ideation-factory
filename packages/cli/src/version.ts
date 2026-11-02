// The cli's version, from its package.json (bundled into the compiled binary).
import pkg from '../package.json' with { type: 'json' }

export const VERSION: string = pkg.version
