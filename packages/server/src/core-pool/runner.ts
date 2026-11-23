// Where core's CPU work runs. The server uses a pool of worker threads, so a
// large upload or batch slows only its own idea, not every actor on the node
// (scale concerns, concern 4). Tests run it in process.
import {
  type Anchor,
  type AnchorInput,
  applyBatch,
  applyUpload,
  type Batch,
  type BatchResult,
  type BuiltDraft,
  buildDraft,
  type DraftChanges,
  type DraftEntry,
  draftChanges,
  type EditorBlock,
  type MovedWords,
  checkAnchor,
  type Comment,
  createIdea,
  type FileOutline,
  type Idea,
  outline,
  suggestionSource,
  type Upload,
  type UploadResult,
} from '@ideaf/core'

export interface CoreRunner {
  /** `key` routes an idea's work to the same worker every time, so that worker's parse cache keeps its latest version parsed. */
  applyBatch(key: string, idea: Idea, comments: Comment[], batch: Batch): Promise<BatchResult>
  applyUpload(key: string, idea: Idea, comments: Comment[], upload: Upload): Promise<UploadResult>
  outline(key: string, idea: Idea): Promise<FileOutline[]>
  createIdea(
    key: string,
    files: Array<{ path: string; source: string }>,
  ): Promise<{ ok: true; idea: Idea } | { ok: false; message: string }>
  checkAnchor(key: string, idea: Idea, input: AnchorInput): Promise<ReturnType<typeof checkAnchor>>
  suggestionSource(key: string, idea: Idea, anchor: Anchor): Promise<ReturnType<typeof suggestionSource>>
  buildDraft(key: string, idea: Idea, comments: Comment[], entries: DraftEntry[]): Promise<BuiltDraft>
  /**
   * The changes that make `draft` read as `files` do: the draft's live documents, as changes on the
   * latest version, with words seen moved between blocks as moves (so their comments go with them).
   */
  draftChanges(
    key: string,
    draft: Idea,
    files: Record<string, EditorBlock[]>,
    words?: MovedWords[],
  ): Promise<DraftChanges>
  close(): Promise<void>
}

function tryCreateIdea(
  files: Array<{ path: string; source: string }>,
): { ok: true; idea: Idea } | { ok: false; message: string } {
  try {
    return { ok: true, idea: createIdea(files) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export const core = {
  applyBatch,
  applyUpload,
  outline,
  createIdea: tryCreateIdea,
  checkAnchor,
  suggestionSource,
  buildDraft,
  draftChanges,
}
export type CoreMethod = keyof typeof core

export function inProcessCore(): CoreRunner {
  return {
    applyBatch: async (_key, idea, comments, batch) => applyBatch(idea, comments, batch),
    applyUpload: async (_key, idea, comments, upload) => applyUpload(idea, comments, upload),
    outline: async (_key, idea) => outline(idea),
    createIdea: async (_key, files) => tryCreateIdea(files),
    checkAnchor: async (_key, idea, input) => checkAnchor(idea, input),
    suggestionSource: async (_key, idea, anchor) => suggestionSource(idea, anchor),
    buildDraft: async (_key, idea, comments, entries) => buildDraft(idea, comments, entries),
    draftChanges: async (_key, draft, files, words) => draftChanges(draft, files, words),
    close: async () => {},
  }
}
