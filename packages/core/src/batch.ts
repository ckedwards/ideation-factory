// The batch format: what the web app, the cli, MCP tools and "accept
// suggestion" all send. Defined once, with zod, so the API validates it and
// publishes it as JSON Schema from the same definition.
import { z } from 'zod'

const MAX_MARKDOWN = 1_000_000

const BlockOrSection = z.string().regex(/^[bs][0-9]+$/, 'a block (b…) or section (s…) ID')
const SectionId = z.string().regex(/^s[0-9]+$/, 'a section ID (s…)')
const FileId = z.string().regex(/^f[0-9]+$/, 'a file ID (f…)')
const AnyId = z.string().regex(/^[bsf][0-9]+$/, 'a block, section or file ID')
const Markdown = z.string().max(MAX_MARKDOWN)
const Path = z.string().min(1).max(512)

/** Comment IDs this step addresses; their threads get an "addressed in vN" note. */
const addresses = z.array(z.string().min(1).max(64)).max(100).optional()
/** The target's current text (a block's source, or a section's heading line). The step conflicts if it differs. */
const expect = z.string().max(MAX_MARKDOWN).optional()

export const Position = z.union([
  z.strictObject({ before: BlockOrSection }),
  z.strictObject({ after: BlockOrSection }),
  z.strictObject({ start: FileId }),
  z.strictObject({ end: FileId }),
])

export const Command = z.discriminatedUnion('command', [
  z.strictObject({
    command: z.literal('replace'),
    /** The block, section or file to search in. */
    in: AnyId,
    /** Source text that must occur exactly once in `in`. */
    old: z.string().min(1).max(MAX_MARKDOWN),
    new: Markdown,
    addresses,
  }),
  z.strictObject({ command: z.literal('insert'), at: Position, markdown: Markdown.min(1), addresses }),
  z.strictObject({ command: z.literal('delete'), target: BlockOrSection, expect, addresses }),
  z.strictObject({ command: z.literal('move'), target: BlockOrSection, to: Position, expect, addresses }),
  z.strictObject({
    command: z.literal('rename-heading'),
    target: SectionId,
    title: z.string().min(1).max(500),
    /** Its new level, 1 to 6; it keeps its own without one. Its section follows the new level's nesting. */
    level: z.number().int().min(1).max(6).optional(),
    expect,
    addresses,
  }),
  /** Rewrites a section's own body (up to its first subsection), keeping the heading and subsections. */
  z.strictObject({ command: z.literal('set-section'), target: SectionId, markdown: Markdown, expect, addresses }),
  z.strictObject({ command: z.literal('rename-file'), file: FileId, path: Path, addresses }),
  z.strictObject({ command: z.literal('create-file'), path: Path, markdown: Markdown, addresses }),
  z.strictObject({ command: z.literal('delete-file'), file: FileId, addresses }),
])

export const Batch = z.strictObject({
  /** The version the batch was built from. If the idea has moved on, it's replayed onto the latest. */
  base: z.number().int().positive(),
  steps: z.array(Command).min(1).max(200),
})

export type Position = z.infer<typeof Position>
export type Command = z.infer<typeof Command>
export type Batch = z.infer<typeof Batch>

/** The batch format as JSON Schema, for the API description and MCP tool definitions. */
export function batchJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(Batch) as Record<string, unknown>
}
