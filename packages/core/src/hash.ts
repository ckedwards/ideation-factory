// The content hash: SHA-256 of the raw bytes, as lowercase hex. Files are
// stored by it, uploads name their base by it, and the cli and server must
// compute it identically, so it lives here, once.
export async function contentHash(content: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
