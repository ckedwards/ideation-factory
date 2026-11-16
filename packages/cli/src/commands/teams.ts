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

/** A team's or group's handle, as written: @core, team:core, group:design or plain. */
const handleOf = (ref: string) => ref.replace(/^(@|team:|group:)/, '')
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
    ...(await requirementLines(ctx, team.requirements)),
  ]
}

/** A team's approval requirements, in words, a line each. */
export async function requirementLines(ctx: Context, r: Team['requirements']): Promise<string[]> {
  const handle = (id: string) =>
    ctx.api
      .getGroup({ group: id })
      .then((g) => `group:${g.handle}`)
      .catch(() => id)
  const rules = await Promise.all(
    r.groups.map(
      async (rule) =>
        `  an approval from ${rule.mode === 'each' ? 'each of' : 'any of'} ${(await Promise.all(rule.groups.map(handle))).join(', ')}${rule.request ? ' (asked to review when an idea goes out)' : ''}`,
    ),
  )
  const lines = [
    ...(r.approvals > 0 ? [`  ${r.approvals} approval${r.approvals === 1 ? '' : 's'} from people`] : []),
    ...rules,
    ...(r.resolved ? ['  every discussion resolved'] : []),
  ]
  return lines.length ? ['Closing an idea as accepted needs:', ...lines] : ['No approval requirements.']
}

/** ideaf team requirements: show them, or change them (maintainers and admins). */
export async function requirements(
  ctx: Context,
  ref: string,
  flags: { approvals?: string; rule: string[]; noRules: boolean; resolved: boolean; anyThreads: boolean },
) {
  if (flags.resolved && flags.anyThreads) {
    throw new CliError('--resolved and --any-threads contradict each other', EXIT.usage, 'usage')
  }
  const team = await ctx.api.getTeam({ team: ref })
  const changing =
    flags.approvals !== undefined || flags.rule.length > 0 || flags.noRules || flags.resolved || flags.anyThreads
  if (!changing) {
    ctx.result(team.requirements)
    for (const line of await requirementLines(ctx, team.requirements)) {
      ctx.say(line)
    }
    return EXIT.ok
  }
  const approvals = flags.approvals === undefined ? team.requirements.approvals : Number(flags.approvals)
  if (!Number.isInteger(approvals) || approvals < 0) {
    throw new CliError(`--approvals takes a whole number, not "${flags.approvals}"`, EXIT.usage, 'invalid')
  }
  const groups =
    flags.rule.length > 0
      ? flags.rule.map((spec) => {
          const match = /^(any|each):([^:]+)(:request)?$/.exec(spec)
          if (!match) {
            throw new CliError(
              `--rule takes any:<group>,<group>[:request] or each:<group>,<group>[:request], not "${spec}"`,
              EXIT.usage,
              'invalid',
            )
          }
          return {
            mode: match[1] as 'any' | 'each',
            groups: match[2]!.split(',').map((g) => g.trim().replace(/^group:/, '')),
            request: Boolean(match[3]),
          }
        })
      : flags.noRules
        ? []
        : team.requirements.groups
  const updated = await ctx.api.setTeamRequirements({
    team: team.id,
    requirements: {
      approvals,
      groups,
      resolved: flags.resolved ? true : flags.anyThreads ? false : team.requirements.resolved,
    },
  })
  ctx.say(`Updated team:${updated.handle}'s approval requirements; they apply to its ideas at once.`)
  for (const line of await requirementLines(ctx, updated.requirements)) {
    ctx.say(line)
  }
  ctx.result(updated.requirements)
  return EXIT.ok
}

export async function create(ctx: Context, kind: Kind, handle: string, flags: { name?: string; description?: string }) {
  let name = flags.name?.trim()
  if (!name && ctx.io.interactive && !ctx.json) {
    name = (await ctx.io.ask('Name'))?.trim()
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
  // where each comes from, when anyone is in it through a group
  const sources = page.items.some((m) => m.through.length > 0)
  const source = (m: (typeof page.items)[number]) =>
    [...(m.direct ? ['direct'] : []), ...m.through.map((t) => `through group:${t.group.handle}`)].join(', ')
  for (const line of table(page.items.map((m) => [userLabel(m.user), m.role, ...(sources ? [source(m)] : [])]))) {
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

const WATCH = {
  participating: 'only the ideas you’re involved in',
  active: 'every idea once it’s out of draft, up to and including its close',
  all: 'every idea, drafts included',
} as const

/** ideaf team watch: how much of a team you hear about, or changing it. */
export async function watch(ctx: Context, ref: string, level: string | undefined) {
  if (level !== undefined && !(level in WATCH)) {
    throw new CliError(`a watch level is ${Object.keys(WATCH).join(', ')}`, EXIT.usage, 'invalid')
  }
  const now =
    level === undefined
      ? await ctx.api.getTeamWatch({ team: ref })
      : await ctx.api.setTeamWatch({ team: ref, level: level as keyof typeof WATCH })
  ctx.result({ team: ref, ...now })
  ctx.say(`You hear about ${WATCH[now.level]} in team:${handleOf(ref)} (${now.level}).`)
  return EXIT.ok
}

const groupRole = (role: string) => (role === 'maintainer' ? 'maintainers' : 'members')
const leaves = (n: number) => (n === 1 ? '1 person' : `${n} people`)

/** The groups in a team. */
export async function teamGroups(ctx: Context, team: string) {
  const { items } = await ctx.api.listTeamGroups({ team: handleOf(team) })
  if (items.length === 0) {
    ctx.say(`No groups are part of team:${handleOf(team)}.`)
  }
  for (const line of table(
    items.map((g) => [
      `group:${g.group.handle}`,
      g.group.name,
      `its members are ${groupRole(g.role)}`,
      `${g.group.members} in it`,
    ]),
  )) {
    ctx.say(line)
  }
  ctx.result({ items })
  return EXIT.ok
}

/** Adds a group to a team, or changes its role there. */
export async function addGroup(ctx: Context, team: string, group: string, role: string | undefined) {
  if (role !== undefined && !['member', 'maintainer'].includes(role)) {
    throw new CliError(`--role is member or maintainer (never admin), not "${role}"`, EXIT.usage, 'invalid')
  }
  const added = await ctx.api.addTeamGroup({
    team: handleOf(team),
    group: handleOf(group),
    ...(role ? { role: role as 'member' | 'maintainer' } : {}),
  })
  ctx.say(
    `group:${added.group.handle} is part of team:${handleOf(team)}: its ${added.group.members} members are the team's ${groupRole(added.role)}.`,
  )
  ctx.result(added)
  return EXIT.ok
}

/** Takes a group out of a team: the team's admins, or the group's (its leaving). */
export async function removeGroup(ctx: Context, team: string, group: string) {
  const before = (await ctx.api.listTeamGroups({ team: handleOf(team) })).items.find(
    (g) => g.group.handle === handleOf(group) || g.group.id === group,
  )
  const result = await ctx.api.removeTeamGroup({ team: handleOf(team), group: handleOf(group) })
  ctx.say(
    before
      ? `group:${handleOf(group)} is no longer part of team:${handleOf(team)}${before.leaving ? `: ${leaves(before.leaving)} left it with it` : ''}.`
      : `group:${handleOf(group)} wasn't part of team:${handleOf(team)}.`,
  )
  ctx.result(result)
  return EXIT.ok
}

/** The teams a group is part of. */
export async function groupTeams(ctx: Context, group: string) {
  const { items } = await ctx.api.listGroupTeams({ group: handleOf(group) })
  if (items.length === 0) {
    ctx.say(`group:${handleOf(group)} isn't part of any team.`)
  }
  for (const line of table(
    items.map((t) => [`team:${t.team.handle}`, t.team.name, `its members are ${groupRole(t.role)}`]),
  )) {
    ctx.say(line)
  }
  ctx.result({ items })
  return EXIT.ok
}
