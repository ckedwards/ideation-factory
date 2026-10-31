// Where file contents live: by content hash, so a stored file never changes and
// the same content is only stored once. Versions hold manifests (path → hash);
// the bytes are here. Local dev uses a folder, tests use memory, and
// production uses an S3-compatible bucket. Every implementation must pass the
// contract tests in contract.ts.
export interface FileStore {
  /** Stores the content and returns its hash. Storing the same content again is a no-op. */
  put(content: Uint8Array<ArrayBuffer>): Promise<string>
  /** The content with this hash, or null if it isn't stored. */
  get(hash: string): Promise<Uint8Array<ArrayBuffer> | null>
  has(hash: string): Promise<boolean>
}

const HASH = /^[0-9a-f]{64}$/

/** Throws unless `hash` is a content hash (64 lowercase hex characters). Keys never come from anything else. */
export function assertContentHash(hash: string): void {
  if (!HASH.test(hash)) {
    throw new Error(`not a content hash: ${JSON.stringify(hash)}`)
  }
}
