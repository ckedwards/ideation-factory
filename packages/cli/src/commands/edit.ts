// ideaf edit: edit the idea in place with a batch of commands. --dry-run shows
// the diff and what happens to each comment. Refuses while you have local edits
// that aren't synced, so they can't be stranded; `ideaf pull` brings the result
// into your files afterwards.
import { Batch, contentHash } from '@ideaf/core'
import { createTwoFilesPatch } from 'diff'
import { describeIssues } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { type IdeaState, readText } from '../workspace.ts'
import { describeOutcomes } from './output.ts'

export function edit(ctx: Context, flags: { idea?: string; 'dry-run'?: boolean }, file: string | undefined, readStdin: () => Promise<string>): Promise<number> {
  if (!file) throw new CliError('usage: ideaf edit <batch.json | -> [--dry-run]', EXIT.usage, 'usage')
  // locked, so a sync or pull can't change the files between the unsynced-edits check and the edit
  return ctx.locked(flags.idea, ({ id, state }) => run(ctx, id, state, flags, file, readStdin))
}

async function run(ctx: Context, id: string, state: IdeaState, flags: { 'dry-run'?: boolean }, file: string, readStdin: () => Promise<string>): Promise<number> {
  const text = file === '-' ? await readStdin() : await Bun.file(file.startsWith('/') ? file : `${ctx.io.cwd}/${file}`).text().catch(() => null)
  if (text === null) throw new CliError(`can't read ${file}`, EXIT.usage, 'usage')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new CliError(`${file} isn't valid JSON`, EXIT.usage, 'invalid')
  }
  // the base defaults to the version this working tree is on
  const withBase = raw && typeof raw === 'object' && !Array.isArray(raw) && !('base' in raw) ? { ...raw, base: state.version } : raw
  const parsed = Batch.safeParse(withBase)
  if (!parsed.success) throw new CliError(`the batch is malformed: ${describeIssues(parsed.error)}`, EXIT.usage, 'invalid', parsed.error.issues)
  const batch = parsed.data

  if (flags['dry-run']) {
    const preview = await ctx.api.previewEdit({ idea: id, batch })
    ctx.result(preview)
    for (const f of preview.files) ctx.say(createTwoFilesPatch(f.path, f.path, f.before ?? '', f.content, `v${preview.base}`, 'after'))
    for (const removed of preview.deleted) ctx.say(`deleted ${removed}`)
    for (const line of describeOutcomes(preview.comments)) ctx.say(line)
    ctx.say('Dry run: nothing changed.')
    return EXIT.ok
  }

  const unsynced: string[] = []
  for (const [path, tracked] of Object.entries(state.files)) {
    const local = await readText(ctx.ws, path)
    if (local === null || (await contentHash(local)) !== tracked.base) unsynced.push(path)
  }
  if (unsynced.length) {
    throw new CliError(`you have local edits that aren't synced (${unsynced.join(', ')}): run \`ideaf sync\` first, so they aren't stranded`, EXIT.localChanges, 'local_changes', { files: unsynced })
  }

  const result = await ctx.api.edit({ idea: id, batch })
  ctx.result({ idea: id, ...result })
  ctx.say(`Edited ${id}: v${result.version}, ${result.steps.length} step${result.steps.length === 1 ? '' : 's'}.`)
  for (const line of describeOutcomes(result.comments)) ctx.say(line)
  ctx.say('Run `ideaf pull` to bring it into your files.')
  return EXIT.ok
}
