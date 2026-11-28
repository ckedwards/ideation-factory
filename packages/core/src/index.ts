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
// - A block's new source as the smallest command, for editing in place (edit.ts)
// - An idea's draft: changes on the latest version, checked as they're built (draft.ts)
// - An editor's blocks, as they are on screen, turned into draft changes (changes.ts)
// - What a suggested edit replaces, and the command accepting it applies (suggest.ts)
// - The link fixes renaming or moving files needs (links.ts)

export { applyBatch, type BatchResult, type Conflict, type ConflictReason, type StepResult } from './apply.ts'
export { blocksOfSource, type DraftChanges, draftChanges, type EditorBlock, type MovedWords } from './changes.ts'
export { Batch, batchJsonSchema, Command, Position } from './batch.ts'
export {
  addChange,
  type BuiltDraft,
  buildDraft,
  type DeletedFile,
  type DraftAddition,
  DraftChange,
  type DraftEntry,
  type DraftFile,
  type DraftUnit,
  unitSource,
} from './draft.ts'
export { type BlockEdit, blockEdit } from './edit.ts'
export { filesInFolder, folderRenames, type LinkFix, linkFixes, type Rename, renameChanges } from './links.ts'
export { contentHash } from './hash.ts'
export {
  type Anchor,
  type AnchorInput,
  type AnchorState,
  checkAnchor,
  type Comment,
  type CommentOutcome,
  createIdea,
  type Idea,
  type IdeaFile,
  pathProblem,
  textAnchor,
} from './idea.ts'
export {
  markdownTree,
  type ParsedFile,
  parseMarkdown,
  type PlainText,
  type Section,
  plainLine,
  type Unit,
  type UnitKind,
} from './markdown.ts'
export { type FileOutline, type OutlineEntry, outline } from './outline.ts'
export { type Skipped, type Suggestion, suggestionCommand, suggestionSource } from './suggest.ts'
export { applyUpload, type Upload, type UploadResult } from './upload.ts'
