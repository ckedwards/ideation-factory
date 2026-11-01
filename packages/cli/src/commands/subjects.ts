// Naming who has access, the same way in and out: a person (maya or @maya),
// group:<handle>, team:<handle> (the team's members) or everyone. Grants name
// people, groups and teams by ID, so they're looked up to show their handles.
import type { Input, Operations, Output } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'

export type Subject = Input<Operations['setAccess']>['subject']
export type Grant = Output<Operations['getAccess']>['grants'][number]
type User = Output<Operations['getUser']>

export const WHO = 'a person (maya or @maya), group:<handle>, team:<handle> (its members) or everyone'

export function userLabel(user: User): string {
  return user.name && user.name !== user.handle ? `@${user.handle} (${user.name})` : `@${user.handle}`
}

export type Labelled = Grant & { who: string }

/**
 * Names subjects both ways: from the command line to a subject by ID, and from
 * a subject to its label (as it would be typed), looking each up once.
 */
export class Names {
  readonly #ctx: Context
  readonly #labels = new Map<string, Promise<string>>()

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  /** The subject a name stands for, by ID. */
  async resolve(name: string): Promise<Subject> {
    const api = this.#ctx.api
    const text = name.trim()
    if (text === 'everyone') {
      return { kind: 'everyone' }
    }
    const prefixed = /^([a-z]+):(.*)$/.exec(text)
    let found: { subject: Exclude<Subject, { kind: 'everyone' }>; label: string }
    if (!prefixed) {
      const user = await api.getUser({ user: text })
      found = { subject: { kind: 'user', id: user.id }, label: userLabel(user) }
    } else if (prefixed[1] === 'group') {
      const group = await api.getGroup({ group: prefixed[2]! })
      found = { subject: { kind: 'group', id: group.id }, label: `group:${group.handle}` }
    } else if (prefixed[1] === 'team') {
      const team = await api.getTeam({ team: prefixed[2]! })
      found = { subject: { kind: 'team', id: team.id }, label: `team:${team.handle}` }
    } else {
      throw new CliError(`"${text}" isn't someone to share with: name ${WHO}`, EXIT.usage, 'invalid')
    }
    this.#labels.set(key(found.subject), Promise.resolve(found.label))
    return found.subject
  }

  label(subject: Subject): Promise<string> {
    if (subject.kind === 'everyone') {
      return Promise.resolve('everyone')
    }
    let label = this.#labels.get(key(subject))
    if (!label) {
      label = this.#lookup(subject)
      this.#labels.set(key(subject), label)
    }
    return label
  }

  /** Each grant with a `who` label, for printing and for --json. */
  grants(grants: Grant[]): Promise<Labelled[]> {
    return Promise.all(grants.map(async (g) => ({ who: await this.label(g.subject), ...g })))
  }

  async #lookup(subject: Exclude<Subject, { kind: 'everyone' }>): Promise<string> {
    const api = this.#ctx.api
    try {
      if (subject.kind === 'user') {
        return userLabel(await api.getUser({ user: subject.id }))
      }
      if (subject.kind === 'group') {
        return `group:${(await api.getGroup({ group: subject.id })).handle}`
      }
      return `team:${(await api.getTeam({ team: subject.id })).handle}`
    } catch {
      // gone, or not ours to see: the ID still tells them apart
      return subject.kind === 'user' ? subject.id : `${subject.kind}:${subject.id}`
    }
  }
}

const key = (subject: Exclude<Subject, { kind: 'everyone' }>) => `${subject.kind}:${subject.id}`

/** "view", "view, edit" or "view, edit, share". */
export function accessWords(access: { edit: boolean; share: boolean }): string {
  return ['view', ...(access.edit ? ['edit'] : []), ...(access.share ? ['share'] : [])].join(', ')
}

/** "view", "view and edit" or "view, edit and share", for sentences. */
export function accessPhrase(access: { edit: boolean; share: boolean }): string {
  return accessWords(access).replace(/, (\w+)$/, ' and $1')
}

export function sameSubject(a: Subject, b: Subject): boolean {
  return a.kind === b.kind && (a.kind === 'everyone' || a.id === (b as { id: string }).id)
}

export function grantLines(grants: Labelled[], indent = '  '): string[] {
  const width = Math.max(0, ...grants.map((g) => g.who.length))
  return grants.map((g) => `${indent}${g.who.padEnd(width)}  ${accessWords(g)}`)
}
