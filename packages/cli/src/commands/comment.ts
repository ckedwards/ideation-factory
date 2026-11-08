// ideaf comment …: reading and writing comment threads, mostly for agents and
// skills. A comment goes on a file, a section (by its ID, from show --blocks),
// or a passage of text given as a quote: the cli finds the quote in the file's
// plain text (the form comments are matched in), so no one counts characters.
// A suggested edit is a comment on a quote with a replacement for its text.
import { ApiError, type Input, type Operations, type Output } from '@ideaf/api'
import { parseMarkdown } from '@ideaf/core'
import { CliError, type Context, EXIT } from '../context.ts'
import { scopeFrom } from '../workspace.ts'
import { truncate } from './output.ts'
import { confirmingDraft } from './draft.ts'
import { Names } from './subjects.ts'

type Thread = Output<Operations['listComments']>[number]
type View = Output<Operations['showBlocks']>
type Caller = Thread['author']
type AnchorInput = Input<Operations['addComment']>['anchor']

function versionOf(flag: string | undefined): { version?: number } {
  if (flag === undefined) {
    return {}
  }
  const version = Number(flag)
  if (!Number.isInteger(version) || version < 1) {
    throw new CliError(`--version is a version number, not "${flag}"`, EXIT.usage, 'invalid')
  }
  return { version }
}

/** The body: the argument, or stdin for "-". */
async function bodyOf(body: string, stdin: () => Promise<string>): Promise<string> {
  const text = body === '-' ? await stdin() : body
  if (!text.trim()) {
    throw new CliError('the comment is empty', EXIT.usage, 'invalid')
  }
  return text
}

export async function list(ctx: Context, flags: { idea?: string; all: boolean; version?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const at = versionOf(flags.version)
  const [threads, view] = await Promise.all([
    ctx.api.listComments({ idea, ...at }),
    ctx.api.showBlocks({ idea, ...at }),
  ])
  const shown = flags.all ? threads : threads.filter((t) => !t.resolved)
  ctx.result({ idea, version: view.version, comments: shown })
  if (ctx.json) {
    return EXIT.ok
  }
  const resolved = threads.length - shown.length
  if (shown.length === 0) {
    ctx.say(
      `No ${flags.all ? '' : 'open '}comments on ${idea} v${view.version}.${resolved ? ` ${resolved} resolved: --all shows them.` : ''}`,
    )
    return EXIT.ok
  }
  const names = new Names(ctx)
  ctx.say(
    `${idea} v${view.version}: ${shown.length} ${flags.all ? '' : 'open '}comment${shown.length === 1 ? '' : 's'}`,
  )
  for (const t of shown) {
    ctx.say('')
    for (const line of await threadLines(t, view, names, false)) {
      ctx.say(line)
    }
  }
  if (resolved) {
    ctx.say(`\n${resolved} resolved: --all shows them.`)
  }
  return EXIT.ok
}

export async function show(ctx: Context, flags: { idea?: string; version?: string }, id: string): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const at = versionOf(flags.version)
  const [threads, view] = await Promise.all([
    ctx.api.listComments({ idea, ...at }),
    ctx.api.showBlocks({ idea, ...at }),
  ])
  const thread = threads.find((t) => t.id === id)
  if (!thread) {
    throw new CliError(`no comment ${id} on ${idea}`, EXIT.notFound, 'not_found')
  }
  ctx.result(thread)
  for (const line of await threadLines(thread, view, new Names(ctx), true)) {
    ctx.say(line)
  }
  return EXIT.ok
}

export async function add(
  ctx: Context,
  flags: { idea?: string; file?: string; section?: string; quote?: string; occurrence?: string },
  body: string,
  stdin: () => Promise<string>,
): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  if (flags.section !== undefined && (flags.quote !== undefined || flags.file !== undefined)) {
    throw new CliError('--section names the whole section: leave out --file and --quote', EXIT.usage, 'usage')
  }
  if (flags.section === undefined && flags.quote === undefined && flags.file === undefined) {
    throw new CliError(
      'say what the comment is on: --quote "<text>" [--file <file>], --section <id>, or --file <file>',
      EXIT.usage,
      'usage',
    )
  }
  if (flags.occurrence !== undefined && flags.quote === undefined) {
    throw new CliError('--occurrence picks among matches of --quote', EXIT.usage, 'usage')
  }
  const occurrence = flags.occurrence === undefined ? undefined : Number(flags.occurrence)
  if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
    throw new CliError(`--occurrence is a number from 1, not "${flags.occurrence}"`, EXIT.usage, 'invalid')
  }
  const text = await bodyOf(body, stdin)

  // comments go on the latest version; if the idea moves on in between, find the anchor again
  for (let attempt = 0; ; attempt++) {
    const latest = await ctx.api.pull({ idea })
    const { occurrence: _, ...target } = flags
    const anchor = anchorFor(ctx, latest.files, { ...target, ...(occurrence ? { occurrence } : {}) })
    try {
      const { comment } = await ctx.api.addComment({ idea, version: latest.version, anchor, body: text })
      ctx.say(`Added ${comment} on v${latest.version}.`)
      ctx.result({ idea, comment, version: latest.version, anchor })
      return EXIT.ok
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'stale_version') || attempt >= 2) {
        throw error
      }
    }
  }
}

/**
 * Suggests a replacement for a quote. The replacement is Markdown, for the
 * quote's source: if that has formatting the quote doesn't show ("**Offline**
 * sync" for "Offline sync"), it's refused unless --replaces confirms it, so a
 * replacement can't drop formatting by accident.
 */
export async function suggest(
  ctx: Context,
  flags: { idea?: string; file?: string; quote?: string; occurrence?: string; replaces?: string; message?: string },
  replacement: string,
  stdin: () => Promise<string>,
): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  if (flags.quote === undefined) {
    throw new CliError('say what the suggestion replaces: --quote "<text>" [--file <file>]', EXIT.usage, 'usage')
  }
  const occurrence = flags.occurrence === undefined ? undefined : Number(flags.occurrence)
  if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
    throw new CliError(`--occurrence is a number from 1, not "${flags.occurrence}"`, EXIT.usage, 'invalid')
  }
  const text = replacement === '-' ? await stdin() : replacement
  for (let attempt = 0; ; attempt++) {
    const latest = await ctx.api.pull({ idea })
    const anchor = anchorFor(ctx, latest.files, {
      quote: flags.quote,
      ...(flags.file !== undefined ? { file: flags.file } : {}),
      ...(occurrence ? { occurrence } : {}),
    })
    if (anchor.kind !== 'text') {
      throw new CliError('a suggestion is on a quote', EXIT.usage, 'usage')
    }
    const { old } = await ctx.api.suggestionSource({ idea, file: anchor.file, start: anchor.start, end: anchor.end })
    if (old !== flags.quote && old !== flags.replaces) {
      throw new CliError(
        `"${truncate(flags.quote, 60)}" is ${JSON.stringify(old)} in the source: give the replacement for that, as Markdown, and pass --replaces ${JSON.stringify(old)} to confirm`,
        EXIT.usage,
        'invalid',
      )
    }
    try {
      const made = await ctx.api.suggestEdit({
        idea,
        version: latest.version,
        anchor,
        new: text,
        ...(flags.message ? { body: flags.message } : {}),
      })
      ctx.say(
        `Suggested ${made.comment} on v${latest.version}: ${JSON.stringify(truncate(old, 60))} → ${JSON.stringify(truncate(text, 60))}.`,
      )
      ctx.result({ idea, comment: made.comment, version: latest.version, anchor, old, new: text })
      return EXIT.ok
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'stale_version') || attempt >= 2) {
        throw error
      }
    }
  }
}

/** Accepts suggestions as one new version; those that no longer apply stay open, and say why. */
export async function accept(
  ctx: Context,
  flags: { idea?: string; draft?: boolean; outdateDraft?: boolean },
  suggestions: string[],
): Promise<number> {
  if (suggestions.length === 0) {
    throw new CliError('name the suggestions to accept, like c3', EXIT.usage, 'usage')
  }
  const idea = await ctx.ideaId(flags.idea)
  const result = await confirmingDraft(ctx, flags.outdateDraft === true, (outdateDraft) =>
    ctx.api.acceptSuggestions({
      idea,
      suggestions,
      into: flags.draft ? 'draft' : 'version',
      ...(outdateDraft ? { outdateDraft } : {}),
    }),
  )
  if (!result) {
    return EXIT.ok
  }
  ctx.say(
    result.version === null
      ? `Added ${result.accepted.join(', ')} to the draft.`
      : `Accepted ${result.accepted.join(', ')} as v${result.version}.`,
  )
  for (const s of result.skipped) {
    ctx.say(`  ${s.id} stays open: ${s.message}`)
  }
  ctx.result({ idea, ...result })
  return EXIT.ok
}

export async function reject(ctx: Context, flags: { idea?: string }, suggestions: string[]): Promise<number> {
  if (suggestions.length === 0) {
    throw new CliError('name the suggestions to reject, like c3', EXIT.usage, 'usage')
  }
  const idea = await ctx.ideaId(flags.idea)
  for (const comment of suggestions) {
    await ctx.api.rejectSuggestion({ idea, comment })
  }
  ctx.say(`Rejected ${suggestions.join(', ')}.`)
  ctx.result({ idea, rejected: suggestions })
  return EXIT.ok
}

type LatestFile = Output<Operations['pull']>['files'][number]

function anchorFor(
  ctx: Context,
  files: LatestFile[],
  flags: { file?: string; section?: string; quote?: string; occurrence?: number },
): AnchorInput {
  if (flags.section !== undefined) {
    return { kind: 'section', section: flags.section }
  }
  let candidates = files
  if (flags.file !== undefined) {
    const file = findFile(ctx, files, flags.file)
    if (flags.quote === undefined) {
      return { kind: 'file', file: file.file }
    }
    candidates = [file]
  }
  const quote = flags.quote!
  const matches = candidates.flatMap((f) => {
    const plain = parseMarkdown(f.content).plain.text
    const found: number[] = []
    for (let at = plain.indexOf(quote); at >= 0; at = plain.indexOf(quote, at + 1)) {
      found.push(at)
    }
    return found.length ? [{ file: f, found }] : []
  })
  if (matches.length === 0) {
    throw new CliError(
      `"${truncate(quote, 60)}" isn't in ${flags.file ?? 'the idea'}: quote the text as it reads, without Markdown (no **, links or #)`,
      EXIT.usage,
      'no_match',
    )
  }
  if (matches.length > 1) {
    throw new CliError(
      `"${truncate(quote, 60)}" is in ${matches.length} files (${matches.map((m) => m.file.path).join(', ')}): pass --file`,
      EXIT.usage,
      'ambiguous',
    )
  }
  const [{ file, found }] = matches as [{ file: LatestFile; found: number[] }]
  if (found.length > 1 && flags.occurrence === undefined) {
    throw new CliError(
      `"${truncate(quote, 60)}" is in ${file.path} ${found.length} times: quote more of it, or pass --occurrence <1-${found.length}>`,
      EXIT.usage,
      'ambiguous',
    )
  }
  const start = found[(flags.occurrence ?? 1) - 1]
  if (start === undefined) {
    throw new CliError(`"${truncate(quote, 60)}" is in ${file.path} only ${found.length} times`, EXIT.usage, 'no_match')
  }
  return { kind: 'text', file: file.file, start, end: start + quote.length }
}

/** A file by ID (f1), or by path from here or from the root. */
function findFile(ctx: Context, files: LatestFile[], ref: string): LatestFile {
  const byId = files.find((f) => f.file === ref)
  if (byId) {
    return byId
  }
  let fromHere: string | null = null
  try {
    fromHere = scopeFrom(ctx.ws, ctx.io.cwd, ref)
  } catch {
    // outside the working tree: only a path from the root can match
  }
  const found = files.find((f) => f.path === fromHere) ?? files.find((f) => f.path === ref)
  if (!found) {
    throw new CliError(
      `no file ${ref} in the idea (it has ${files.map((f) => `${f.file} ${f.path}`).join(', ')})`,
      EXIT.notFound,
      'not_found',
    )
  }
  return found
}

export async function reply(
  ctx: Context,
  flags: { idea?: string },
  comment: string,
  body: string,
  stdin: () => Promise<string>,
): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const replied = await ctx.api.reply({ idea, comment, body: await bodyOf(body, stdin) })
  ctx.say(`Replied to ${comment}.`)
  ctx.result({ idea, comment, reply: replied.comment })
  return EXIT.ok
}

export async function resolve(
  ctx: Context,
  flags: { idea?: string },
  comments: string[],
  resolved: boolean,
): Promise<number> {
  if (comments.length === 0) {
    throw new CliError(`name the comments to ${resolved ? 'resolve' : 'reopen'}, like c3`, EXIT.usage, 'usage')
  }
  const idea = await ctx.ideaId(flags.idea)
  const done: Array<{ comment: string; resolved: boolean }> = []
  for (const comment of comments) {
    done.push(await ctx.api.resolveComment({ idea, comment, resolved }))
  }
  ctx.say(`${resolved ? 'Resolved' : 'Reopened'} ${comments.join(', ')}.`)
  ctx.result({ idea, comments: done })
  return EXIT.ok
}

// --- printing threads ----------------------------------------------------------------

async function authorLabel(author: Caller, names: Names): Promise<string> {
  const user = await names.label({ kind: 'user', id: author.user })
  if (author.purpose === 'bot') {
    return `${author.bot ?? 'a bot'} (bot)`
  }
  if (author.purpose === 'bot-for-me') {
    return `${author.bot ?? 'a bot'} for ${user}`
  }
  return user
}

function where(thread: Thread, view: View): string {
  const anchor = thread.anchor
  if (!anchor) {
    return `outdated: its text is gone${thread.lastVersion ? ` (last attached in v${thread.lastVersion})` : ''}`
  }
  const file = view.files.find((f) => f.id === anchor.file)
  const path = file?.path ?? anchor.file
  if (anchor.kind === 'file') {
    return `on ${path}`
  }
  if (anchor.kind === 'section') {
    const heading = file?.entries.find((e) => e.id === anchor.section)?.source.replace(/^#+\s*/, '')
    return `on section ${anchor.section}${heading ? ` "${truncate(heading, 50)}"` : ''} in ${path}`
  }
  return `on "${truncate(anchor.quote, 60)}" in ${path}`
}

async function threadLines(thread: Thread, view: View, names: Names, full: boolean): Promise<string[]> {
  const text = (body: string, indent = '    ') => (full ? body.replace(/\n/g, `\n${indent}`) : truncate(body, 200))
  const decision = thread.suggestion?.decision
  const status = [
    ...(thread.suggestion ? ['suggestion'] : []),
    ...(decision ? [decision.kind === 'accepted' ? `accepted in v${decision.version}` : 'rejected'] : []),
    ...(thread.suggestion?.inDraft ? ['in the draft'] : []),
    ...(decision ? [] : [thread.resolved ? 'resolved' : 'open']),
    ...(thread.state === 'exact' ? [] : [thread.state]),
    ...(thread.addressedIn.length ? [`addressed in ${thread.addressedIn.map((v) => `v${v}`).join(', ')}`] : []),
  ]
  const lines = [
    `${thread.id}  ${await authorLabel(thread.author, names)}, v${thread.version} · ${status.join(' · ')}`,
    `    ${where(thread, view)}`,
    ...(thread.suggestion
      ? [
          `    suggests ${JSON.stringify(truncate(thread.suggestion.old, 80))} → ${JSON.stringify(text(thread.suggestion.new))}`,
        ]
      : []),
    ...(thread.body ? [`    ${text(thread.body)}`] : []),
  ]
  for (const r of thread.replies) {
    lines.push(`    ↳ ${r.id} ${await authorLabel(r.author, names)}: ${text(r.body, '      ')}`)
  }
  return lines
}
