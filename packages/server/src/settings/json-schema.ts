// ideaf.yaml's JSON Schema (deploy/ideaf.schema.json), for editors: completion, descriptions and
// checking as you type. Made from the settings' own definition (schema.ts), with each secret's
// <key>_file beside it; load.test.ts checks the file is current. To write it again:
//
//   bun packages/server/src/settings/json-schema.ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { SECRETS, settingsSchema } from './schema.ts'

type Node = { properties?: Record<string, Node>; default?: unknown; [key: string]: unknown }

export const SCHEMA_FILE = join(import.meta.dir, '../../../../deploy/ideaf.schema.json')

export function settingsJsonSchema(): string {
  // what may be written (no key is required), with the defaults of what's read
  const input = z.toJSONSchema(settingsSchema, { io: 'input', unrepresentable: 'any' }) as Node
  const output = z.toJSONSchema(settingsSchema, { io: 'output', unrepresentable: 'any' }) as Node
  addDefaults(input, output)
  for (const key of SECRETS) {
    const parts = key.split('.')
    let node: Node | undefined = input
    for (const part of parts.slice(0, -1)) {
      node = node?.properties?.[part]
    }
    const name = parts.at(-1)!
    if (node?.properties) {
      node.properties[`${name}_file`] = {
        type: 'string',
        description: `A file holding ${key}, by its full path (/run/secrets/${name}), in place of the secret itself`,
      }
    }
  }
  const schema = {
    $schema: input.$schema,
    $id: 'https://raw.githubusercontent.com/ckedwards/ideation-factory/master/deploy/ideaf.schema.json',
    title: "Ideation Factory's settings (ideaf.yaml)",
    ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== '$schema')),
  }
  return `${JSON.stringify(schema, null, 2)}\n`
}

function addDefaults(into: Node, from: Node): void {
  if (from.default !== undefined && into.default === undefined) {
    into.default = from.default
  }
  for (const [key, node] of Object.entries(into.properties ?? {})) {
    const other = from.properties?.[key]
    if (other) {
      addDefaults(node, other)
    }
  }
}

if (import.meta.main) {
  writeFileSync(SCHEMA_FILE, settingsJsonSchema())
  console.log(`wrote ${SCHEMA_FILE}`)
}
