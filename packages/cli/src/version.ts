// The cli's version: the release's, when a release builds it (scripts/release-assets.sh passes
// --define IDEAF_RELEASE='"v0.1.<n>"'), otherwise its package.json's (bundled into the binary).
import pkg from '../package.json' with { type: 'json' }

declare const IDEAF_RELEASE: string | undefined

export const VERSION: string = typeof IDEAF_RELEASE === 'string' ? IDEAF_RELEASE.replace(/^v/, '') : pkg.version
