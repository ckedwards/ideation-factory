// Which file store a node uses, from the environment: a bucket when
// IDEAF_S3_BUCKET is set (every node of a deployment with more than one must
// share it), otherwise a folder under IDEAF_DATA, which suits one machine.
//
// - IDEAF_S3_BUCKET: the bucket;
// - IDEAF_S3_ENDPOINT: the store's URL, for anything but AWS (http://seaweedfs:8333);
// - IDEAF_S3_REGION (default us-east-1), IDEAF_S3_ACCESS_KEY_ID and IDEAF_S3_SECRET_ACCESS_KEY,
//   or neither, for Bun's S3_* or AWS_* variables (its client doesn't fetch an
//   instance's or a pod's role itself);
// - IDEAF_S3_PREFIX: where files go in it (default files/);
// - IDEAF_S3_VIRTUAL_HOSTED=on: the bucket in the hostname, as AWS prefers; the path otherwise.
import { join } from 'node:path'
import { LocalFolderFileStore } from './local-folder.ts'
import { S3FileStore } from './s3.ts'
import type { FileStore } from './store.ts'

export function fileStoreFromEnv(env: Record<string, string | undefined>, data: string): FileStore {
  const bucket = env.IDEAF_S3_BUCKET
  if (!bucket) {
    return new LocalFolderFileStore(join(data, 'files'))
  }
  const hosted = env.IDEAF_S3_VIRTUAL_HOSTED ?? 'off'
  if (hosted !== 'on' && hosted !== 'off') {
    throw new Error(`IDEAF_S3_VIRTUAL_HOSTED is on or off, not "${hosted}"`)
  }
  if (Boolean(env.IDEAF_S3_ACCESS_KEY_ID) !== Boolean(env.IDEAF_S3_SECRET_ACCESS_KEY)) {
    throw new Error(
      'set both IDEAF_S3_ACCESS_KEY_ID and IDEAF_S3_SECRET_ACCESS_KEY, or neither (to use the S3_* or AWS_* variables)',
    )
  }
  const prefix = env.IDEAF_S3_PREFIX ?? 'files/'
  return new S3FileStore({
    bucket,
    region: env.IDEAF_S3_REGION || 'us-east-1',
    prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix,
    ...(env.IDEAF_S3_ENDPOINT ? { endpoint: env.IDEAF_S3_ENDPOINT } : {}),
    ...(env.IDEAF_S3_ACCESS_KEY_ID ? { accessKeyId: env.IDEAF_S3_ACCESS_KEY_ID } : {}),
    ...(env.IDEAF_S3_SECRET_ACCESS_KEY ? { secretAccessKey: env.IDEAF_S3_SECRET_ACCESS_KEY } : {}),
    ...(hosted === 'on' ? { virtualHostedStyle: true } : {}),
  })
}
