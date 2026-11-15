import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCHEMA_FILE, settingsJsonSchema } from './json-schema.ts'
import { loadSettings, settingsFrom } from './load.ts'
import { envName } from './schema.ts'
import { engineEnv } from './start.ts'

const dir = mkdtempSync(join(tmpdir(), 'ideaf-settings-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const file = (name: string, text: string) => {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}
const SECRET = 'a'.repeat(40)
const none = { config: null, secrets: null }

describe('the sources, each over the one before', () => {
  test('defaults, then ideaf.yaml, then secrets.yaml, then the environment', () => {
    const config = file(
      'order.yaml',
      'url: https://ideas.example.test\nsite_admins: [a@example.test]\ndirectory:\n  calls: 8\nfiles:\n  s3:\n    bucket: from-yaml\n',
    )
    const secrets = file('order-secrets.yaml', `auth:\n  secret: ${SECRET}\n`)
    const { settings, sources, warnings } = loadSettings(
      { IDEAF__FILES__S3__BUCKET: 'from-env', IDEAF__SITE_ADMINS: 'b@example.test, c@example.test' },
      { config, secrets },
    )
    expect(settings.url).toBe('https://ideas.example.test')
    expect(settings.directory.calls).toBe(8)
    expect(settings.files.s3?.bucket).toBe('from-env')
    expect(settings.files.s3?.region).toBe('us-east-1')
    expect(settings.site_admins).toEqual(['b@example.test', 'c@example.test'])
    expect(settings.auth.secret).toBe(SECRET)
    expect(settings.port).toBe(8080)
    expect(sources).toEqual([config, secrets, 'the environment'])
    expect(warnings).toEqual([])
  })

  test('a key left blank is one not set, as in an example not filled in yet', () => {
    const secrets = file('blank-secrets.yaml', 'auth:\n  secret:\nengine:\n  token:\n')
    const { settings } = loadSettings({}, { config: null, secrets })
    expect(settings.auth.secret).toBeUndefined()
    expect(settings.engine.token).toBeUndefined()
  })

  test('IDEAF_CONFIG and IDEAF_SECRETS name the files', () => {
    const config = file('named.yaml', 'port: 9090\n')
    const secrets = file('named-secrets.yaml', `engine:\n  token: ${SECRET}\n`)
    const { settings } = loadSettings({ IDEAF_CONFIG: config, IDEAF_SECRETS: secrets })
    expect(settings.port).toBe(9090)
    expect(settings.engine.token).toBe(SECRET)
  })

  test('every key is a variable named for its path', () => {
    expect(envName('files.s3.bucket')).toBe('IDEAF__FILES__S3__BUCKET')
    const { settings } = loadSettings(
      {
        IDEAF__AUTH__SSO__AUTO_CREATE: 'off',
        IDEAF__LIMITS__MAX_FILE_BYTES: '65536',
        IDEAF__ENGINE__NODE_VERSION: '7',
      },
      none,
    )
    expect(settings.auth.sso.auto_create).toBe('off')
    expect(settings.limits.max_file_bytes).toBe(65536)
    expect(settings.engine.node_version).toBe(7)
  })

  test("other IDEAF_ variables aren't settings (the cli's, a test's)", () => {
    expect(loadSettings({ IDEAF_TOKEN: 'x', IDEAF_INDEX_DELAY_MS: '100' }, none).sources).toEqual([])
  })
})

describe('secrets', () => {
  test('<key>_file reads the secret from a file, from the YAML or the environment', () => {
    const path = file('auth-secret', `${SECRET}\n`)
    expect(settingsFrom({ auth: { secret_file: path } }).auth.secret).toBe(SECRET)
    expect(loadSettings({ IDEAF__AUTH__SECRET_FILE: path }, none).settings.auth.secret).toBe(SECRET)
    const smtp = file('smtp-url', 'smtps://u:p@smtp.example.test:465')
    expect(loadSettings({ IDEAF__EMAIL__SMTP_URL_FILE: smtp }, none).settings.email.smtp_url).toBe(
      'smtps://u:p@smtp.example.test:465',
    )
  })

  test('a secret and its file both set, or a file that isn’t there, is a mistake', () => {
    const path = file('both', SECRET)
    expect(() => settingsFrom({ auth: { secret: SECRET, secret_file: path } })).toThrow('not both')
    expect(() => settingsFrom({ auth: { secret_file: join(dir, 'missing') } })).toThrow("can't read auth.secret_file")
    expect(() => settingsFrom({ auth: { secret_file: 'relative' } })).toThrow('full path')
  })

  test('only a secret may have a file: anything else is no such setting', () => {
    expect(() => settingsFrom({ url_file: '/x' })).toThrow('url_file: no such setting')
  })

  test('secrets.yaml takes secrets only', () => {
    const secrets = file('mixed-secrets.yaml', `auth:\n  secret: ${SECRET}\nurl: https://x.example.test\n`)
    expect(() => loadSettings({}, { config: null, secrets })).toThrow('for secrets only')
    expect(() => loadSettings({}, { config: null, secrets })).toThrow('url')
  })

  test('a secret written in ideaf.yaml works, with a warning to move it', () => {
    const config = file('leaky.yaml', `auth:\n  secret: ${SECRET}\n`)
    const { settings, warnings } = loadSettings({}, { config, secrets: null })
    expect(settings.auth.secret).toBe(SECRET)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('auth.secret')
  })
})

describe('mistakes, named by their key and where they came from', () => {
  test('values', () => {
    const config = file('wrong.yaml', 'directory:\n  calls: lots\nauth:\n  personal_tokens: maybe\n')
    const load = () => loadSettings({ IDEAF__AUTH__SECRET: 'short' }, { config, secrets: null })
    expect(load).toThrow(`directory.calls (${config}): a whole number from 1 to 1024`)
    expect(load).toThrow(`auth.personal_tokens (${config}): on, admins, off, not "maybe"`)
    expect(load).toThrow('auth.secret (IDEAF__AUTH__SECRET): at least 32 characters')
  })

  test('keys that aren’t settings, from either', () => {
    const config = file('typo.yaml', 'files:\n  bucket: x\n')
    expect(() => loadSettings({}, { config, secrets: null })).toThrow(`files.bucket (${config}): no such setting`)
    expect(() => loadSettings({ IDEAF__FILES__S3__BUKET: 'x', IDEAF__FILES__S3__BUCKET: 'y' }, none)).toThrow(
      'files.s3.buket (IDEAF__FILES__S3__BUKET): no such setting',
    )
  })

  test('names and files that can’t be settings', () => {
    expect(() => loadSettings({ IDEAF__FILES____BUCKET: 'x' }, none)).toThrow("isn't a setting's name")
    expect(() => loadSettings({ IDEAF__FILES: 'x' }, none)).toThrow('files (IDEAF__FILES): a group of settings')
    expect(() => loadSettings({}, { config: file('list.yaml', '- a\n- b\n'), secrets: null })).toThrow('a mapping')
    expect(() => loadSettings({}, { config: file('bad.yaml', 'url: [\n'), secrets: null })).toThrow("isn't YAML")
    expect(() => loadSettings({}, { config: join(dir, 'missing.yaml'), secrets: null })).toThrow("can't read")
  })
})

describe('the engine, for RivetKit', () => {
  const engine = (values: Record<string, unknown>, env: Record<string, string> = {}, build: string | null = null) =>
    engineEnv(settingsFrom({ engine: values }), env, build)

  test('its endpoint with the namespace and token in it, the pool, and the node version', () => {
    expect(engine({ endpoint: 'http://127.0.0.1:6420', token: 'tok', pool: 'directory' }, {}, '1700000000')).toEqual({
      RIVET_ENDPOINT: 'http://default:tok@127.0.0.1:6420',
      RIVET_POOL: 'directory',
      RIVET_NODE_VERSION: '1700000000',
    })
    expect(engine({ node_version: 42 }, {}, '1700000000')).toEqual({ RIVET_NODE_VERSION: '42' })
    expect(engine({})).toEqual({})
  })

  test("RivetKit's own variables win", () => {
    const env = { RIVET_ENDPOINT: 'http://other:6420', RIVET_POOL: 'p', RIVET_NODE_VERSION: '1' }
    expect(
      engine({ endpoint: 'http://127.0.0.1:6420', token: 'tok', pool: 'directory', node_version: 2 }, env),
    ).toEqual({})
  })
})

describe("ideaf.yaml's JSON Schema", () => {
  test('deploy/ideaf.schema.json is current (bun packages/server/src/settings/json-schema.ts writes it)', () => {
    expect(readFileSync(SCHEMA_FILE, 'utf8')).toBe(settingsJsonSchema())
  })
})
