import { contentHash } from '@ideaf/core'
import { CliError, type Context, EXIT } from '../context.ts'
import { readText, scanMarkdown, scopeFrom, setActiveIdea, writeState } from '../workspace.ts'

export async function start(ctx: Context, flags: { title?: string; description?: string; team?: string }, path: string | undefined): Promise<number> {
  const scope = scopeFrom(ctx.ws, ctx.io.cwd, path)
  const paths = await scanMarkdown(ctx.ws, scope)
  if (paths.length === 0) throw new CliError(`no Markdown files in ${scope || 'this folder'}`, EXIT.usage, 'no_files')

  let title = flags.title?.trim()
  if (!title && ctx.io.interactive && !ctx.json) title = ctx.io.prompt('Title:')?.trim()
  if (!title) throw new CliError('an idea needs a title: pass --title "…"', EXIT.usage, 'no_title')

  const files = await Promise.all(paths.map(async (p) => ({ path: p, content: (await readText(ctx.ws, p))! })))
  const created = await ctx.api.createIdea({ title, ...(flags.description ? { description: flags.description } : {}), ...(flags.team ? { team: flags.team } : {}), files })
  const pulled = await ctx.api.pull({ idea: created.idea, version: created.version })

  const local = new Map(await Promise.all(files.map(async (f) => [f.path, await contentHash(f.content)] as const)))
  await writeState(ctx.ws, {
    idea: created.idea,
    server: ctx.server,
    version: created.version,
    branch: ctx.ws.git?.branch ?? null,
    files: Object.fromEntries(pulled.files.filter((f) => local.get(f.path) === f.hash).map((f) => [f.path, { file: f.file, base: f.hash, version: created.version }])),
  })
  await setActiveIdea(ctx.ws, created.idea)

  ctx.say(`Started "${title}" (${created.idea}), v${created.version} with ${paths.length} file${paths.length === 1 ? '' : 's'}:`)
  for (const f of pulled.files) ctx.say(`  ${f.file}  ${f.path}`)
  ctx.result({ idea: created.idea, version: created.version, files: pulled.files.map((f) => ({ file: f.file, path: f.path })) })
  return EXIT.ok
}
