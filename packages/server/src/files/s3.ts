// Files in an S3-compatible bucket, for deployments: AWS S3, Google Cloud
// Storage, Cloudflare R2, or SeaweedFS on your own machines (Azure Blob Storage
// has no S3 API). Keys are `<prefix><first two hex>/<hash>`, so the bucket can be
// shared with other things (the Rivet Engine's data, say) under other
// prefixes. A stored file never changes, so a put of content already there
// writes nothing, and two app nodes storing the same content at once write
// the same bytes.
import { S3Client } from 'bun'
import { contentHash } from '@ideaf/core'
import { assertContentHash, type FileStore, verified } from './store.ts'

export interface S3Settings {
  bucket: string
  /** The store's URL, for anything but AWS (https://storage.example.com, or http://seaweedfs:8333). */
  endpoint?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  /** Where under the bucket files go (default `files/`). */
  prefix?: string
  /** Bucket-in-the-hostname URLs (AWS's default); off, the bucket goes in the path, as most self-hosted stores want. */
  virtualHostedStyle?: boolean
}

export class S3FileStore implements FileStore {
  readonly #client: S3Client
  readonly #prefix: string

  constructor(settings: S3Settings) {
    this.#client = new S3Client({
      bucket: settings.bucket,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      ...(settings.region ? { region: settings.region } : {}),
      ...(settings.accessKeyId ? { accessKeyId: settings.accessKeyId } : {}),
      ...(settings.secretAccessKey ? { secretAccessKey: settings.secretAccessKey } : {}),
      ...(settings.virtualHostedStyle ? { virtualHostedStyle: true } : {}),
    })
    this.#prefix = settings.prefix ?? 'files/'
  }

  #key(hash: string): string {
    return `${this.#prefix}${hash.slice(0, 2)}/${hash}`
  }

  async put(content: Uint8Array<ArrayBuffer>): Promise<string> {
    const hash = await contentHash(content)
    const key = this.#key(hash)
    if (!(await this.#client.exists(key))) {
      // a copy: the caller may change its buffer while the upload is under way
      await this.#client.write(key, content.slice(), { type: 'application/octet-stream' })
    }
    return hash
  }

  async get(hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
    assertContentHash(hash)
    const bytes = await this.#read(hash)
    return bytes && verified(hash, bytes)
  }

  async #read(hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      return new Uint8Array(await this.#client.file(this.#key(hash)).arrayBuffer())
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }
      throw error
    }
  }

  async has(hash: string): Promise<boolean> {
    assertContentHash(hash)
    return this.#client.exists(this.#key(hash))
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'NoSuchKey' || code === 'NotFound' || /\b404\b|NoSuchKey/.test(String(error))
}
