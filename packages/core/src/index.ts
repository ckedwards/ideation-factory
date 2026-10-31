// @ideaf/core: what an idea's content means, as pure functions. Web-standard
// APIs only, so it runs unchanged in Workers, browsers and Bun.
//
// Step 1 of the build plan (see docs/implementation-plan.md) fills this in:
// Markdown blocks and sections with stable IDs, the plain-text form comments are
// matched in (with a map back to source positions), the edit commands, and
// re-anchoring an upload from its base.

export { contentHash } from './hash.ts'
