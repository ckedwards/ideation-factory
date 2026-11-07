// ideaf start: start an idea from Markdown files, and make it this working
// tree's idea. Branches are the user's to make: the idea is on whichever one
// is checked out.
import { ideaPath } from '@ideaf/api'
import { contentHash } from '@ideaf/core'
import { CliError, type Context, EXIT } from '../context.ts'
import { gitHint, readText, scanMarkdown, scopeFrom, setActiveIdea, writeState } from '../workspace.ts'

export async function start(
  ctx: Context,
  flags: { title?: string; description?: string; team?: string },
  path: string | undefined,
): Promise<number> {
  const scope = scopeFrom(ctx.ws, ctx.io.cwd, path)
  const paths = await scanMarkdown(ctx.ws, scope)
  if (paths.length === 0) {
    throw new CliError(`no Markdown files in ${scope || 'this folder'}`, EXIT.usage, 'no_files')
  }

  let title = flags.title?.trim()
  if (!title && ctx.io.interactive && !ctx.json) {
    title = (await ctx.io.ask('Title'))?.trim()
  }
  if (!title) {
    throw new CliError('an idea needs a title: pass --title "…"', EXIT.usage, 'no_title')
  }

  const files = await Promise.all(paths.map(async (p) => ({ path: p, content: (await readText(ctx.ws, p))! })))
  const hint = gitHint(ctx.ws)
  const created = await ctx.api.createIdea({
    title,
    ...(flags.description ? { description: flags.description } : {}),
    ...(flags.team ? { team: flags.team } : {}),
    files,
    ...(hint ? { gitHint: hint } : {}),
  })
  const pulled = await ctx.api.pull({ idea: created.idea, version: created.version })

  const local = new Map(await Promise.all(files.map(async (f) => [f.path, await contentHash(f.content)] as const)))
  await writeState(ctx.ws, {
    idea: created.idea,
    server: ctx.server,
    version: created.version,
    branch: ctx.ws.git?.branch ?? null,
    files: Object.fromEntries(
      pulled.files
        .filter((f) => local.get(f.path) === f.hash)
        .map((f) => [f.path, { file: f.file, base: f.hash, version: created.version }]),
    ),
  })
  await setActiveIdea(ctx.ws, created.idea)

  // where people read and discuss it: mobile/idea/9 on the server
  const url = `${ctx.server}${ideaPath(created.place, created.number)}`
  ctx.say(
    `Started "${title}" as ${created.place}/idea/${created.number}, v${created.version} with ${paths.length} file${paths.length === 1 ? '' : 's'}:`,
  )
  for (const f of pulled.files) {
    ctx.say(`  ${f.file}  ${f.path}`)
  }
  ctx.say(`Read it, and comment, at ${url}`)
  ctx.result({
    idea: created.idea,
    place: created.place,
    number: created.number,
    url,
    version: created.version,
    files: pulled.files.map((f) => ({ file: f.file, path: f.path })),
  })
  return EXIT.ok
}
