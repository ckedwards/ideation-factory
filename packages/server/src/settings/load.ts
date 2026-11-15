// Loads the settings (schema.ts) from, each over the one before:
//
// 1. the defaults;
// 2. ideaf.yaml: IDEAF_CONFIG's path, or /etc/ideaf/ideaf.yaml when it's there;
// 3. secrets.yaml, the same keys but only the secrets: IDEAF_SECRETS's path, or
//    /etc/ideaf/secrets.yaml when it's there;
// 4. the environment: IDEAF__<KEY> for each key (IDEAF__FILES__S3__BUCKET);
//
// and then a secret's <key>_file (auth.secret_file, IDEAF__AUTH__SECRET_FILE) names a file holding
// it, as Docker and Kubernetes hand secrets out. Everything is checked before the server starts:
// a mistake names its key and where it came from.
import { existsSync, readFileSync } from 'node:fs'
import { envName, SECRETS, type Settings, settingsSchema } from './schema.ts'

export const CONFIG_FILE = '/etc/ideaf/ideaf.yaml'
export const SECRETS_FILE = '/etc/ideaf/secrets.yaml'

export class SettingsError extends Error {}

export interface Loaded {
  settings: Settings
  /** Things to fix that don't stop it starting: a secret written in ideaf.yaml, say. */
  warnings: string[]
  /** Where the settings came from, for the log. */
  sources: string[]
}

type Tree = Record<string, unknown>
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Which source set each key, for naming it in a mistake. */
type Origins = Map<string, string>

/**
 * The settings for this process. `files` names the two files (null for none) in place of
 * IDEAF_CONFIG, IDEAF_SECRETS and the files in /etc/ideaf.
 */
export function loadSettings(
  env: Record<string, string | undefined> = process.env,
  files: { config?: string | null; secrets?: string | null } = {},
): Loaded {
  const config = files.config !== undefined ? files.config : (env.IDEAF_CONFIG ?? found(CONFIG_FILE))
  const secrets = files.secrets !== undefined ? files.secrets : (env.IDEAF_SECRETS ?? found(SECRETS_FILE))
  const tree: Tree = {}
  const origins: Origins = new Map()
  const warnings: string[] = []
  const sources: string[] = []

  if (config) {
    const values = readYaml(config)
    for (const key of SECRETS) {
      if (get(values, key) !== undefined) {
        warnings.push(
          `${config} has the secret ${key} in it: keep secrets in secrets.yaml, the environment, or a file of their own (${key}_file)`,
        )
      }
    }
    merge(tree, values, config, origins)
    sources.push(config)
  }
  if (secrets) {
    const values = readYaml(secrets)
    const allowed = new Set(SECRETS.flatMap((key) => [key, `${key}_file`]))
    const others = leaves(values).filter((key) => !allowed.has(key))
    if (others.length > 0) {
      throw new SettingsError(
        `${secrets} is for secrets only (${SECRETS.join(', ')}), not: ${others.join(', ')}; put those in ideaf.yaml`,
      )
    }
    merge(tree, values, secrets, origins)
    sources.push(secrets)
  }
  const fromEnv = environment(env)
  if (leaves(fromEnv).length > 0) {
    for (const key of leaves(fromEnv)) {
      origins.set(key, envName(key))
    }
    merge(tree, fromEnv, null, origins)
    sources.push('the environment')
  }
  readSecretFiles(tree, origins)
  return { settings: parse(tree, origins), warnings, sources }
}

/** Settings from values as ideaf.yaml would have them, for tests. */
export function settingsFrom(values: Tree = {}): Settings {
  const tree = structuredClone(values)
  readSecretFiles(tree, new Map())
  return parse(tree, new Map())
}

const found = (path: string) => (existsSync(path) ? path : null)

function readYaml(path: string): Tree {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new SettingsError(`can't read ${path}: ${(error as Error).message}`)
  }
  let value: unknown
  try {
    value = Bun.YAML.parse(text)
  } catch (error) {
    throw new SettingsError(`${path} isn't YAML: ${(error as Error).message}`)
  }
  if (value === null || value === undefined) {
    return {}
  }
  if (!isTree(value)) {
    throw new SettingsError(`${path} must be a mapping of settings, like "url: https://ideas.example.com"`)
  }
  return withoutBlanks(value)
}

/** A key left blank ("secret:", YAML's null) is one not set, as in an example not filled in yet. */
function withoutBlanks(tree: Tree): Tree {
  const out: Tree = {}
  for (const [key, value] of Object.entries(tree)) {
    if (value === null) {
      continue
    }
    out[key] = isTree(value) ? withoutBlanks(value) : value
  }
  return out
}

/** IDEAF__<KEY> variables as a tree: IDEAF__FILES__S3__BUCKET is files.s3.bucket. */
function environment(env: Record<string, string | undefined>): Tree {
  const tree: Tree = {}
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('IDEAF__') || value === undefined) {
      continue
    }
    const path = name.slice('IDEAF__'.length).toLowerCase().split('__')
    if (path.some((part) => part === '')) {
      throw new SettingsError(`${name} isn't a setting's name: IDEAF__ and its key, like IDEAF__FILES__S3__BUCKET`)
    }
    let node = tree
    for (const part of path.slice(0, -1)) {
      if (node[part] === undefined) {
        node[part] = {}
      }
      if (!isTree(node[part])) {
        throw new SettingsError(`${name} is inside ${envName(path.slice(0, -1).join('.'))}, which is a value`)
      }
      node = node[part]
    }
    if (isTree(node[path.at(-1)!])) {
      throw new SettingsError(`${name} is a group of settings, not one: set the ones inside it`)
    }
    node[path.at(-1)!] = value
  }
  return tree
}

function merge(into: Tree, from: Tree, source: string | null, origins: Origins, prefix = ''): void {
  for (const [key, value] of Object.entries(from)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isTree(value) && isTree(into[key])) {
      merge(into[key], value, source, origins, path)
      continue
    }
    into[key] = isTree(value) ? structuredClone(value) : value
    if (source) {
      for (const leaf of isTree(value) ? leaves(value, path) : [path]) {
        origins.set(leaf, source)
      }
    }
  }
}

function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return isTree(value) ? leaves(value, path) : [path]
  })
}

function get(tree: Tree, path: string): unknown {
  let node: unknown = tree
  for (const part of path.split('.')) {
    if (!isTree(node)) {
      return undefined
    }
    node = node[part]
  }
  return node
}

/** <secret>_file: the secret is the file's contents, without its last line ending. */
function readSecretFiles(tree: Tree, origins: Origins): void {
  for (const key of SECRETS) {
    const parts = key.split('.')
    const parent = get(tree, parts.slice(0, -1).join('.'))
    const name = parts.at(-1)!
    if (!isTree(parent) || parent[`${name}_file`] === undefined) {
      continue
    }
    const path = parent[`${name}_file`]
    if (parent[name] !== undefined) {
      throw new SettingsError(`set ${key} or ${key}_file, not both`)
    }
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new SettingsError(`${key}_file is a file's full path, like /run/secrets/${name}`)
    }
    try {
      parent[name] = readFileSync(path, 'utf8').replace(/\r?\n$/, '')
    } catch (error) {
      throw new SettingsError(`can't read ${key}_file (${path}): ${(error as Error).message}`)
    }
    delete parent[`${name}_file`]
    origins.set(key, `${origins.get(`${key}_file`) ?? key}_file: ${path}`)
  }
}

function parse(tree: Tree, origins: Origins): Settings {
  const result = settingsSchema.safeParse(tree)
  if (result.success) {
    return result.data
  }
  const problems = result.error.issues.flatMap((issue) => {
    const at = issue.path.join('.')
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => {
        const path = at ? `${at}.${key}` : key
        const from = origins.get(path) ?? [...origins].find(([k]) => k.startsWith(`${path}.`))?.[1]
        return `${path}${from ? ` (${from})` : ''}: no such setting`
      })
    }
    const from = origins.get(at)
    const message =
      issue.code === 'invalid_type' && issue.expected === 'object'
        ? `a group of settings, not one value: set the ones inside it (${at}.<key>)`
        : issue.message
    return [`${at || 'the settings'}${from ? ` (${from})` : ''}: ${message}`]
  })
  throw new SettingsError(`the settings have mistakes:\n  ${problems.join('\n  ')}`)
}
