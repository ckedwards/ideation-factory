# Ideation Factory MVP: core

**Status:** built (step 1 of the [implementation plan](../implementation-plan.md)). How `packages/core` models an idea's content, and the decisions it settles. The behavior it implements is in the [overview](../architecture.md) (Editing with commands, Keeping comments anchored) and the [backend](architecture-backend.md).

## The model

- **Units:** a file is parsed into units, in document order: headings, and the blocks between them (paragraphs, list items, code blocks, tables, quotes, footnotes, and a few kinds with no text: HTML, thematic breaks, front matter, link definitions). Units never overlap. A list item's unit is its own content and its nested items are units of their own, except an item with text after its nested list, which is one unit.
- **Sections:** each heading starts one, running to the next heading of the same or a higher level. A section's *body* is what comes before its first subsection.
- **The plain-text form:** each unit's text with Markdown syntax removed and whitespace collapsed, units separated by a newline. Every character records its source offset, and no two share one. Text comments are anchored on this form, so re-wrapping or adding bold doesn't disturb them.
- **Pieces:** every edit is described as how each new file is made from old text: pieces copied from a range of an old file (possibly another file, for a move) or new text. That says exactly where every old character went, so IDs and comments are followed exactly. Commands build pieces precisely. Uploads and `set-section` build them from a diff (diff-match-patch with semantic cleanup, so a rewritten sentence reads as rewritten rather than keeping scattered letters).

## Decisions

These are the plan's "decisions to make early".

1. **IDs.** Short and readable, from one counter per idea, never reused: `f1` for files, `s2` for sections (carried by their heading), `b3` for blocks. A version stores each file's unit IDs as a list in parse order, so they need no markers in the Markdown. An ID follows a unit when all of the unit's surviving characters (or its explicit replacement) land in exactly one new unit, and no other old unit's do. A heading follows only its own surviving text or an explicit rename; a heading rewritten in an upload is a different heading, apart from the rename-in-place rule.
2. **The parser.** `mdast-util-from-markdown` with GFM (tables, task lists, strikethrough, footnotes) and front matter. The web app must parse with the same: remark-parse with remark-gfm and remark-frontmatter is built on these exact packages, so source positions agree.
3. **What's stored.** Per version, for each file: its ID, path, content hash (contents in the bucket) and unit IDs. Per comment, per version: its anchor, which is a file, a section ID, or a plain-text range with the text it covered. The idea actor's tables are step 2.
4. **The batch format.** `{ base, steps: [...] }` with nine commands (`replace`, `insert`, `delete`, `move`, `rename-heading`, `set-section`, `rename-file`, `create-file`, `delete-file`), defined once with zod in `batch.ts` and published as JSON Schema from it (`batchJsonSchema()`). Steps can say which comments they address, and `delete`, `move`, `rename-heading` and `set-section` can carry `expect`: the target's current text, so a stale step conflicts instead of acting on changed text.

## Behavior worth knowing

- **Partly overlapping comments keep the untouched part.** A comment on "might rain", after `replace` "rain" → "snow", covers "might", marked *changed*. A comment entirely on the replaced text covers the new text.
- **A surviving part with no letters or digits doesn't count.** If only the full stop of a rewritten sentence survives, the comment is *outdated*.
- **In an upload, the diff keeps the longest text in place.** If two blocks swap places, the shorter one is the one that "moved". Either way, every comment stays on its own text.
- **A section moved in an upload keeps its section comments only if its whole body moved unchanged with it.** Moved and edited, they become *outdated*, as the design says. With commands, they always follow.
- **`set-section` rewrites the body without headings.** To add a subsection, use `insert`.
- **Moving a nested list item keeps the indentation of its later lines.** Moving it to a different depth may need a `replace` afterwards.
- **Comments on units with no text** (HTML blocks, thematic breaks) aren't possible; such units keep their IDs in an upload when their file is unchanged, or when they match exactly one unit elsewhere.

## Performance

On a large idea (40 files, 890 KB, 500 comments), on a laptop: a step of a batch takes about 25 ms, moving a section to another file about 40 ms, an upload of one edited file about 140 ms, and an upload of all 40 files, each edited, about 0.7 s, mostly Markdown parsing. A step only follows the files it touches. That's fine to start with; heavy work moves to worker threads per [scale concerns](scale-concerns.md) concern 4 if measurement says so.
