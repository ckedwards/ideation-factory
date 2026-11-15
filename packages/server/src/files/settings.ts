// Which file store a node uses, from its settings (settings/schema.ts): a bucket when files.s3 is
// set (every node of a deployment with more than one must share it), otherwise a folder under
// data, which suits one machine. Without files.s3's keys, Bun's S3_* or AWS_* variables.
import { join } from 'node:path'
import type { Settings } from '../settings/schema.ts'
import { LocalFolderFileStore } from './local-folder.ts'
import { S3FileStore } from './s3.ts'
import type { FileStore } from './store.ts'

export function fileStoreFrom(settings: Settings): FileStore {
  const s3 = settings.files.s3
  if (!s3) {
    return new LocalFolderFileStore(join(settings.data, 'files'))
  }
  if (Boolean(s3.access_key_id) !== Boolean(s3.secret_access_key)) {
    throw new Error(
      'set both files.s3.access_key_id and files.s3.secret_access_key, or neither (to use the S3_* or AWS_* variables)',
    )
  }
  const prefix = s3.prefix && !s3.prefix.endsWith('/') ? `${s3.prefix}/` : s3.prefix
  return new S3FileStore({
    bucket: s3.bucket,
    region: s3.region,
    prefix,
    ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
    ...(s3.access_key_id ? { accessKeyId: s3.access_key_id } : {}),
    ...(s3.secret_access_key ? { secretAccessKey: s3.secret_access_key } : {}),
    ...(s3.virtual_hosted === 'on' ? { virtualHostedStyle: true } : {}),
  })
}
