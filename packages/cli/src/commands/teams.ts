// ideaf team … and ideaf group …: the same membership commands for both, as
// the API has them. Teams also have settings: who can create ideas in them,
// and what access new ideas start with.
import type { Output, Operations } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { userLabel } from './subjects.ts'

export type Kind = 'team' | 'group'
type Container = Output<Operations['getTeam']> | Output<Operations['getGroup']>
type Team = Output<Operations['getTeam']>
type Member = Output<Operations['listTeamMembers']>['items'][number]
type Role = Member['role']
type Page<T> = { items: T[]; next: string | null }

/** The API's operations for one kind, under the same names. */
function api(ctx: Context, kind: Kind) {
  const a = ctx.api
  return kind === 'team'
    ? {
        get: (ref: string): Promise<Container> => a.getTeam({ team: ref }),
        list: (q: string | undefined, cursor: string | undefined): Promise<Page<Container>> =>
          a.listTeams({ ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) }),
        create: (input: NewContainer): Promise<Container> => a.createTeam(input),
        members: (ref: string, cursor: string | undefined) =>
          a.listTeamMembers({ team: ref, ...(cursor ? { cursor } : {}) }),
        add: (ref: string, user: string, role?: Role) =>
          a.addTeamMember({ team: ref, user, ...(role ? { role } : {}) }),
        remove: (ref: string, user: string) => a.removeTeamMember({ team: ref, user }),
        join: (ref: string) => a.requestToJoinTeam({ team: ref }),
        requests: (ref: string) => a.listTeamJoinRequests({ team: ref }),
        decide: (ref: string, user: string, approve: boolean) => a.decideTeamJoinRequest({ team: ref, user, approve }),
      }
    : {
        get: (ref: string): Promise<Container> => a.getGroup({ group: ref }),
        list: (q: string | undefined, cursor: string | undefined): Promise<Page<Container>> =>
          a.listGroups({ ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) }),
        create: (input: NewContainer): Promise<Container> => a.createGroup(input),
        members: (ref: string, cursor: string | undefined) =>
          a.listGroupMembers({ group: ref, ...(cursor ? { cursor } : {}) }),
        add: (ref: string, user: string, role?: Role) =>
          a.addGroupMember({ group: ref, user, ...(role ? { role } : {}) }),
        remove: (ref: string, user: string) => a.removeGroupMember({ group: ref, user }),
        join: (ref: string) => a.requestToJoinGroup({ group: ref }),
        requests: (ref: string) => a.listGroupJoinRequests({ group: ref }),
        decide: (ref: string, user: string, approve: boolean) =>
          a.decideGroupJoinRequest({ group: ref, user, approve }),
      }
}

type NewContainer = { handle: string; name: string; description?: string }

/** The positional arguments a subcommand needs, or a usage error naming them. */
export function need(args: string[], names: string[], usage: string): string[] {
  if (args.length < names.length) {
    throw new CliError(`missing ${names.slice(args.length).join(' and ')}: ${usage}`, EXIT.usage, 'usage')
  }
  if (args.length > names.length) {
    throw new CliError(`unexpected "${args[names.length]}": ${usage}`, EXIT.usage, 'usage')
  }
  return args
}

const handleOf = (ref: string) => ref.replace(/^@/, '')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]!.length))) ?? []
  return rows.map((r) => `  ${r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ')}`)
}

function more(ctx: Context, next: string | null, command: string): void {
  if (next) {
    ctx.say(`More: ideaf ${command} --cursor ${next}`)
  }
}

export async function list(ctx: Context, kind: Kind, query: string | undefined, cursor: string | undefined) {
  const page = await api(ctx, kind).list(query, cursor)
  if (page.items.length === 0) {
    ctx.say(query ? `No ${kind}s match "${query}".` : `No ${kind}s yet: create one with \`ideaf ${kind} create\`.`)
  }
  for (const line of table(page.items.map((c) => [`${kind}:${c.handle}`, c.name, plural(c.members, 'member')]))) {
    ctx.say(line)
  }
  more(ctx, page.next, `${kind} list${query ? ` ${query}` : ''}`)
  ctx.result(page)
  return EXIT.ok
}

export async function show(ctx: Context, kind: Kind, ref: string) {
  const c = await api(ctx, kind).get(ref)
  ctx.say(`${c.name} (${kind}:${c.handle})${'archived' in c && c.archived ? ', archived' : ''}`)
  if (c.description) {
    ctx.say(`  ${c.description}`)
  }
  ctx.say(`  ${plural(c.members, 'member')}`)
  if (c.kind === 'team') {
    for (const line of await teamSettings(ctx, c)) {
      ctx.say(`  ${line}`)
    }
  }
  ctx.result(c)
  return EXIT.ok
}

async function teamSettings(ctx: Context, team: Team): Promise<string[]> {
  const groups = await Promise.all(
    team.defaults.groups.map(async (g) => {
      const handle = await ctx.api
        .getGroup({ group: g.group })
        .then((found) => found.handle)
        .catch(() => g.group)
      return `group:${handle} ${g.edit ? 'edit' : 'view'}`
    }),
  )
  const who = { anyone: 'anyone', members: 'its members', maintainers: 'its maintainers and admins' }
  return [
    `Ideas can be created by ${who[team.createPolicy]}.`,
    'New ideas start with:',
    `  its members: ${team.defaults.members === 'none' ? 'no access' : team.defaults.members}`,
    `  everyone: ${team.defaults.public ? 'view (public)' : 'no access'}`,
    ...(groups.length ? groups.map((g) => `  ${g}`) : []),
  ]
}

export async function create(ctx: Context, kind: Kind, handle: string, flags: { name?: string; description?: string }) {
  let name = flags.name?.trim()
  if (!name && ctx.io.interactive && !ctx.json) {
    name = ctx.io.prompt('Name:')?.trim()
  }
  if (!name) {
    throw new CliError(`a ${kind} needs a name: pass --name "…"`, EXIT.usage, 'no_name')
  }
  const c = await api(ctx, kind).create({
    handle: handleOf(handle),
    name,
    ...(flags.description ? { description: flags.description } : {}),
  })
  ctx.say(
    `Created ${kind}:${c.handle}, with you as its admin. Add people with \`ideaf ${kind} add ${c.handle} <person>\`.`,
  )
  ctx.result(c)
  return EXIT.ok
}

export async function members(ctx: Context, kind: Kind, ref: string, cursor: string | undefined) {
  const page = await api(ctx, kind).members(ref, cursor)
  for (const line of table(page.items.map((m) => [userLabel(m.user), m.role]))) {
    ctx.say(line)
  }
  more(ctx, page.next, `${kind} members ${ref}`)
  ctx.result(page)
  return EXIT.ok
}

export async function add(ctx: Context, kind: Kind, ref: string, person: string, role: string | undefined) {
  if (role !== undefined && !['admin', 'maintainer', 'member'].includes(role)) {
    throw new CliError(`--role is admin, maintainer or member, not "${role}"`, EXIT.usage, 'invalid')
  }
  const member = await api(ctx, kind).add(ref, person, role as Role | undefined)
  ctx.say(
    `${userLabel(member.user)} is ${member.role === 'admin' ? 'an' : 'a'} ${member.role} of ${kind}:${handleOf(ref)}.`,
  )
  ctx.result(member)
  return EXIT.ok
}

export async function remove(ctx: Context, kind: Kind, ref: string, person: string) {
  const result = await api(ctx, kind).remove(ref, person)
  ctx.say(
    result.removed
      ? `Removed @${handleOf(person)} from ${kind}:${handleOf(ref)}.`
      : `@${handleOf(person)} wasn't in ${kind}:${handleOf(ref)}.`,
  )
  ctx.result(result)
  return EXIT.ok
}

export async function leave(ctx: Context, kind: Kind, ref: string) {
  const me = await ctx.api.me({})
  const result = await api(ctx, kind).remove(ref, me.id)
  ctx.say(result.removed ? `You left ${kind}:${handleOf(ref)}.` : `You weren't in ${kind}:${handleOf(ref)}.`)
  ctx.result(result)
  return EXIT.ok
}

export async function join(ctx: Context, kind: Kind, ref: string) {
  const result = await api(ctx, kind).join(ref)
  ctx.say(
    result.requested
      ? `Asked to join ${kind}:${handleOf(ref)}: its maintainers and admins can let you in.`
      : `You're already in ${kind}:${handleOf(ref)}, or have asked to join.`,
  )
  ctx.result(result)
  return EXIT.ok
}

export async function requests(ctx: Context, kind: Kind, ref: string) {
  const { items } = await api(ctx, kind).requests(ref)
  if (items.length === 0) {
    ctx.say(`No one is waiting to join ${kind}:${handleOf(ref)}.`)
  } else {
    for (const user of items) {
      ctx.say(`  ${userLabel(user)}`)
    }
    ctx.say(`Let them in with \`ideaf ${kind} approve ${handleOf(ref)} <person>\`, or \`deny\`.`)
  }
  ctx.result({ items })
  return EXIT.ok
}

export async function decide(ctx: Context, kind: Kind, ref: string, person: string, approve: boolean) {
  const result = await api(ctx, kind).decide(ref, person, approve)
  ctx.say(
    result.approved
      ? `Let @${handleOf(person)} into ${kind}:${handleOf(ref)}.`
      : `Turned down @${handleOf(person)}'s request to join ${kind}:${handleOf(ref)}.`,
  )
  ctx.result(result)
  return EXIT.ok
}

export async function settings(
  ctx: Context,
  ref: string,
  flags: {
    create?: string
    members?: string
    public: boolean
    private: boolean
    group: string[]
    removeGroup: string[]
  },
) {
  if (flags.public && flags.private) {
    throw new CliError('--public and --private contradict each other', EXIT.usage, 'usage')
  }
  const changing =
    flags.create !== undefined ||
    flags.members !== undefined ||
    flags.public ||
    flags.private ||
    flags.group.length > 0 ||
    flags.removeGroup.length > 0
  if (!changing) {
    return show(ctx, 'team', ref)
  }
  const team = await ctx.api.getTeam({ team: ref })
  const groups = new Map(team.defaults.groups.map((g) => [g.group, g.edit]))
  for (const spec of flags.group) {
    const [name, access = 'view'] = spec.split('=') as [string, string | undefined]
    if (access !== 'view' && access !== 'edit') {
      throw new CliError(`--group takes <group>[=view|edit], not "${spec}"`, EXIT.usage, 'invalid')
    }
    groups.set((await ctx.api.getGroup({ group: name.replace(/^group:/, '') })).id, access === 'edit')
  }
  for (const name of flags.removeGroup) {
    groups.delete((await ctx.api.getGroup({ group: name.replace(/^group:/, '') })).id)
  }
  const updated = await ctx.api.updateTeam({
    team: team.id,
    ...(flags.create !== undefined ? { createPolicy: flags.create as Team['createPolicy'] } : {}),
    defaults: {
      members: (flags.members ?? team.defaults.members) as Team['defaults']['members'],
      public: flags.public ? true : flags.private ? false : team.defaults.public,
      groups: [...groups].map(([group, edit]) => ({ group, edit })),
    },
  })
  ctx.say(`Updated team:${updated.handle}. Existing ideas keep their access.`)
  for (const line of await teamSettings(ctx, updated)) {
    ctx.say(`  ${line}`)
  }
  ctx.result(updated)
  return EXIT.ok
}
