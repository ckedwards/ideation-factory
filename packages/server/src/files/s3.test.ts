// The S3 file store: the FileStore contract against a fake S3 server in
// process (what the store asks of S3: PUT, GET and HEAD, path-style, with S3's
// errors), and against a real store when one is set:
//
//   IDEAF_TEST_S3_ENDPOINT=http://localhost:8333 IDEAF_TEST_S3_BUCKET=ideaf-test \
//   IDEAF_TEST_S3_ACCESS_KEY_ID=… IDEAF_TEST_S3_SECRET_ACCESS_KEY=… bun run test
//
// (CI runs SeaweedFS for it.)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fileStoreContract } from './contract.ts'
import { LocalFolderFileStore } from './local-folder.ts'
import { S3FileStore } from './s3.ts'
import { fileStoreFromEnv } from './settings.ts'

/** Just enough S3 for the store: objects in memory, signatures not checked. */
function fakeS3() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>()
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const key = decodeURIComponent(new URL(request.url).pathname)
      requests.push(`${request.method} ${key}`)
      if (request.method === 'PUT') {
        objects.set(key, new Uint8Array(await request.arrayBuffer()))
        return new Response(null, { status: 200, headers: { etag: '"x"' } })
      }
      const object = objects.get(key)
      if (!object) {
        return request.method === 'HEAD'
          ? new Response(null, { status: 404 })
          : new Response(
              '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
              { status: 404, headers: { 'content-type': 'application/xml' } },
            )
      }
      return new Response(request.method === 'HEAD' ? null : object, {
        status: 200,
        headers: { 'content-length': String(object.byteLength), etag: '"x"' },
      })
    },
  })
  return { endpoint: `http://127.0.0.1:${server.port}`, objects, requests, stop: () => server.stop(true) }
}

let fake: ReturnType<typeof fakeS3>
beforeAll(() => {
  fake = fakeS3()
})
afterAll(() => fake.stop())

const credentials = { accessKeyId: 'test', secretAccessKey: 'test-secret', region: 'us-east-1' }
let n = 0

fileStoreContract(
  'S3FileStore (a fake S3)',
  async () => new S3FileStore({ bucket: 'ideaf', endpoint: fake.endpoint, prefix: `run${++n}/`, ...credentials }),
)

describe('S3FileStore', () => {
  test('keys files under its prefix by hash, and writes content already there only once', async () => {
    const store = new S3FileStore({ bucket: 'ideaf', endpoint: fake.endpoint, prefix: 'files/', ...credentials })
    const hash = await store.put(new TextEncoder().encode('kept once'))
    await store.put(new TextEncoder().encode('kept once'))
    expect([...fake.objects.keys()]).toContain(`/ideaf/files/${hash.slice(0, 2)}/${hash}`)
    expect(fake.requests.filter((r) => r === `PUT /ideaf/files/${hash.slice(0, 2)}/${hash}`)).toHaveLength(1)
  })
})

// a real S3-compatible store, when the environment names one
const real = process.env.IDEAF_TEST_S3_ENDPOINT
if (real) {
  fileStoreContract(
    `S3FileStore (${real})`,
    async () =>
      new S3FileStore({
        bucket: process.env.IDEAF_TEST_S3_BUCKET ?? 'ideaf-test',
        endpoint: real,
        region: process.env.IDEAF_TEST_S3_REGION ?? 'us-east-1',
        accessKeyId: process.env.IDEAF_TEST_S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.IDEAF_TEST_S3_SECRET_ACCESS_KEY ?? '',
        prefix: `test-${crypto.randomUUID()}/`,
      }),
  )
}

describe('which store', () => {
  test('a bucket when IDEAF_S3_BUCKET is set, a folder otherwise; settings checked', () => {
    expect(fileStoreFromEnv({}, '/data')).toBeInstanceOf(LocalFolderFileStore)
    expect(
      fileStoreFromEnv({ IDEAF_S3_BUCKET: 'ideaf', IDEAF_S3_ENDPOINT: 'http://seaweedfs:8333' }, '/data'),
    ).toBeInstanceOf(S3FileStore)
    expect(() => fileStoreFromEnv({ IDEAF_S3_BUCKET: 'b', IDEAF_S3_ACCESS_KEY_ID: 'only-one' }, '/d')).toThrow('both')
    expect(() => fileStoreFromEnv({ IDEAF_S3_BUCKET: 'b', IDEAF_S3_VIRTUAL_HOSTED: 'yes' }, '/d')).toThrow('on or off')
  })
})
