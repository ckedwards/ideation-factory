// @ideaf/core: what an idea's content means, as pure functions. Web-standard
// APIs only, so it runs unchanged in browsers and Bun.
//
// - Markdown parsed into units (headings and blocks) and sections, with a
//   plain-text form that maps back to source positions (markdown.ts)
// - Stable IDs and comment anchors carried from version to version (idea.ts,
//   follow.ts)
// - The edit commands, as a pure function from an idea and a batch to the next
//   version or a conflict (batch.ts, apply.ts)
// - Re-anchoring an uploaded copy from its base (upload.ts)
// - The structured view agents and the web editor read (outline.ts)

export { applyBatch, type BatchResult, type Conflict, type ConflictReason, type StepResult } from './apply.ts'
export { Batch, batchJsonSchema, Command, Position } from './batch.ts'
export { contentHash } from './hash.ts'
export {
  type Anchor,
  type AnchorState,
  type Comment,
  type CommentOutcome,
  createIdea,
  type Idea,
  type IdeaFile,
  pathProblem,
  textAnchor,
} from './idea.ts'
export { type ParsedFile, parseMarkdown, type PlainText, type Section, type Unit, type UnitKind } from './markdown.ts'
export { type FileOutline, type OutlineEntry, outline } from './outline.ts'
export { applyUpload, type Upload, type UploadResult } from './upload.ts'
