// The directory's operations: people, teams, groups, lists and search, and an
// idea's access (sharing and the move wizard).
import { z } from 'zod'
import { defineOperation } from './operation.ts'

/** A yes or no in a query string ("true" or "false"), or as JSON. */
const Flag = z.union([z.boolean(), z.stringbool()])
import {
  CreatePolicy,
  Cursor,
  Grant,
  GrantSubject,
  Group,
  Handle,
  IdeaId,
  IdeaRow,
  IdeaStatus,
  InboxReason,
  Limit,
  Notification,
  Member,
  Memberships,
  MovePreview,
  Page,
  Permission,
  Ref,
  Role,
  Team,
  TeamDefaults,
  TeamRequirements,
  TokenInfo,
  User,
  WatchLevel,
} from './schemas.ts'

const NewContainer = z.strictObject({
  handle: Handle,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
})
const MoveInput = z.strictObject({
  idea: IdeaId,
  /** The team to move to (ID or handle), or null to take it out of its team. */
  team: Ref.nullable(),
  keep: z.array(GrantSubject).max(50).optional(),
  skip: z.array(GrantSubject).max(50).optional(),
})

/** The same membership operations for teams and for groups. */
function membership<K extends 'team' | 'group'>(kind: K) {
  const path = `/${kind}s/{${kind}}`
  const id = z.object({ [kind]: Ref }) as unknown as z.ZodObject<Record<K, typeof Ref>>
  return {
    members: defineOperation({
      name: `list_${kind}_members`,
      summary: `List a ${kind}'s members`,
      description: `A ${kind}'s members with their roles, 25 at a time.`,
      method: 'GET',
      path: `${path}/members`,
      kind: 'read',
      input: id.extend({ cursor: Cursor, limit: Limit }).strict(),
      output: Page(Member),
    }),
    addMember: defineOperation({
      name: `add_${kind}_member`,
      summary: `Add someone to a ${kind}`,
      description: `Adds a person to a ${kind} (maintainers and admins), or changes their role (admins). ${kind === 'team' ? 'Team members get whatever access the team has to its ideas.' : 'Group members get whatever access the group has been given.'}`,
      method: 'POST',
      path: `${path}/members`,
      kind: 'write',
      input: id.extend({ user: Ref, role: Role.optional() }).strict(),
      output: Member,
    }),
    removeMember: defineOperation({
      name: `remove_${kind}_member`,
      summary: `Remove someone from a ${kind}, or leave it`,
      description: `Removes a person from a ${kind}, or yourself to leave it. Their access through the ${kind} ends at once. A ${kind} always keeps at least one admin.`,
      method: 'POST',
      path: `${path}/members/{user}/remove`,
      kind: 'write',
      input: id.extend({ user: Ref }).strict(),
      output: z.object({ removed: z.boolean() }),
    }),
    requestToJoin: defineOperation({
      name: `request_to_join_${kind}`,
      summary: `Ask to join a ${kind}`,
      description: `${kind === 'team' ? 'Teams' : 'Groups'} are invite only: this asks the ${kind}'s maintainers and admins to let you in.`,
      method: 'POST',
      path: `${path}/join`,
      kind: 'write',
      input: id.strict(),
      output: z.object({ requested: z.boolean() }),
    }),
    joinRequests: defineOperation({
      name: `list_${kind}_join_requests`,
      summary: `List requests to join a ${kind}`,
      description: `People waiting to join a ${kind} (for its maintainers and admins).`,
      method: 'GET',
      path: `${path}/join-requests`,
      kind: 'read',
      input: id.strict(),
      output: z.object({ items: z.array(User) }),
    }),
    decide: defineOperation({
      name: `decide_${kind}_join_request`,
      summary: `Approve or deny a request to join a ${kind}`,
      description: `Lets a person into a ${kind}, or turns them away (maintainers and admins).`,
      method: 'POST',
      path: `${path}/join-requests/{user}`,
      kind: 'write',
      input: id.extend({ user: Ref, approve: z.boolean() }).strict(),
      output: z.object({ approved: z.boolean() }),
    }),
  }
}

const team = membership('team')
const group = membership('group')

export const directoryOperations = {
  me: defineOperation({
    name: 'whoami',
    summary: 'Who am I',
    description: 'The signed-in person.',
    method: 'GET',
    path: '/me',
    kind: 'read',
    input: z.strictObject({}),
    output: User,
  }),
  myMemberships: defineOperation({
    name: 'list_my_memberships',
    summary: 'Your teams and groups',
    description:
      "The teams and groups you're in, with your role in each (admin, maintainer or member), and the ones you've asked to join.",
    method: 'GET',
    path: '/me/memberships',
    kind: 'read',
    input: z.strictObject({}),
    output: Memberships,
  }),
  currentToken: defineOperation({
    name: 'current_token',
    summary: 'What this token may do',
    description:
      'Who the token is for, its purpose (and bot name), whether it is read only, and the teams and ideas it is limited to (null: everything you can see). A token without a grant, such as a browser session’s, has no limits and `grant: null`.',
    method: 'GET',
    path: '/token',
    kind: 'read',
    input: z.strictObject({}),
    output: TokenInfo,
  }),
  revokeToken: defineOperation({
    name: 'revoke_token',
    summary: 'Revoke this token',
    description:
      'Ends the token grant this token was made with: it, and every token refreshed from the same sign-in, stop working at once. For signing out. Refused for a token without a grant.',
    method: 'POST',
    path: '/token/revoke',
    kind: 'write',
    input: z.strictObject({}),
    output: z.object({ revoked: z.boolean() }),
  }),
  findUsers: defineOperation({
    name: 'find_people',
    summary: 'Find people',
    description: 'Type-ahead for people by handle or name; at most 8 by default.',
    method: 'GET',
    path: '/people',
    kind: 'read',
    input: z.strictObject({ q: z.string().trim().min(1).max(100), limit: Limit }),
    output: z.object({ items: z.array(User) }),
  }),
  getUser: defineOperation({
    name: 'get_person',
    summary: 'Read a person',
    description: "A person's handle and name, by ID or handle: for showing who an idea's grants are for.",
    method: 'GET',
    path: '/people/{user}',
    kind: 'read',
    input: z.strictObject({ user: Ref }),
    output: User,
  }),

  getPeople: defineOperation({
    name: 'get_people',
    summary: 'Read several people',
    description:
      "People's handles and names, by ID, up to 100 at once: for naming the authors of an idea's comments and versions in one go. Anyone not found is left out.",
    // a read, sent as POST so a long list of IDs fits
    method: 'POST',
    path: '/people/lookup',
    kind: 'read',
    input: z.strictObject({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) }),
    output: z.object({ items: z.array(User) }),
  }),

  listIdeas: defineOperation({
    name: 'list_ideas',
    summary: 'List ideas',
    description:
      'Ideas you can see, most recently updated first, 25 at a time, optionally in one team, by one owner, in one status, or open or closed (an idea in an archived team counts as closed, whatever its status).',
    method: 'GET',
    path: '/ideas',
    kind: 'read',
    input: z.strictObject({
      team: Ref.optional(),
      owner: Ref.optional(),
      status: IdeaStatus.optional(),
      state: z.enum(['open', 'closed']).optional(),
      cursor: Cursor,
      limit: Limit,
    }),
    output: Page(IdeaRow),
  }),
  searchIdeas: defineOperation({
    name: 'search_ideas',
    summary: 'Search ideas',
    description:
      'Ideas you can see whose titles contain the search, closest first. A search needs at least 3 characters; it matches anywhere in a word, and shorter words in it are ignored. `incomplete` means the search matched more ideas than one search checks (20,000), so only the best-ranked of them were: add a word to narrow it.',
    method: 'GET',
    path: '/search/ideas',
    kind: 'read',
    input: z.strictObject({
      q: z
        .string()
        .trim()
        .max(200)
        .refine(
          (q) => q.split(/\s+/).some((t) => [...t].length >= 3),
          'a search needs a word of at least 3 characters',
        ),
      limit: Limit,
    }),
    output: z.object({ items: z.array(IdeaRow), incomplete: z.boolean() }),
  }),

  getAccess: defineOperation({
    name: 'get_access',
    summary: 'Who can see an idea',
    description:
      "An idea's grants (people, groups, team members, everyone, each with view, edit or share), and what you can do with it.",
    method: 'GET',
    path: '/ideas/{idea}/access',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId }),
    output: z.object({ you: Permission, grants: z.array(Grant) }),
  }),
  setAccess: defineOperation({
    name: 'set_access',
    summary: 'Share an idea, or change or remove access',
    description:
      "Gives a person, a group, a team's members or everyone access to an idea (view always; edit and share optional; everyone gets view only), or removes it with `access: null`. Needs share access. Asking someone to review gives them view access too.",
    method: 'POST',
    path: '/ideas/{idea}/access',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      subject: GrantSubject,
      access: z.strictObject({ edit: z.boolean(), share: z.boolean() }).nullable(),
    }),
    output: z.object({ grants: z.array(Grant) }),
  }),
  listNotifications: defineOperation({
    name: 'list_notifications',
    summary: 'Your inbox',
    description:
      "What's happened to the ideas you hear about: one row per idea (newest first, 25 at a time), with why you hear about it (you wrote it, were asked to review it by name or through a group, took part, or subscribed), how many updates are new, and the latest. `done` lists the ones you've cleared instead. Ideas you can no longer see aren't listed.",
    method: 'GET',
    path: '/notifications',
    kind: 'read',
    input: z.strictObject({
      done: Flag.optional(),
      reason: InboxReason.optional(),
      unread: Flag.optional(),
      cursor: Cursor,
      limit: Limit,
    }),
    output: Page(Notification),
  }),
  unreadNotifications: defineOperation({
    name: 'count_unread_notifications',
    summary: 'How many ideas have news',
    description: 'How many ideas in your inbox have updates you haven’t read: ideas, not events.',
    method: 'GET',
    path: '/notifications/unread',
    kind: 'read',
    input: z.strictObject({}),
    output: z.object({ count: z.number().int() }),
  }),
  markNotifications: defineOperation({
    name: 'mark_notifications',
    summary: 'Mark ideas read or done',
    description:
      'Marks ideas in your inbox read (`read: true`), done (`done: true`: cleared until something new happens) or back in the inbox (`done: false`). Without `ideas`, it applies to every idea in the list it moves them out of (or, for `read`, all of them).',
    method: 'POST',
    path: '/notifications/mark',
    kind: 'write',
    input: z.strictObject({
      ideas: z.array(IdeaId).max(100).optional(),
      read: z.literal(true).optional(),
      done: z.boolean().optional(),
    }),
    output: z.object({ changed: z.number().int() }),
  }),
  getSubscription: defineOperation({
    name: 'get_subscription',
    summary: 'Whether you hear about an idea',
    description: 'Whether you hear about an idea, and why (null when you don’t).',
    method: 'GET',
    path: '/ideas/{idea}/subscription',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId }),
    output: z.object({ subscribed: z.boolean(), reason: InboxReason.nullable() }),
  }),
  setSubscription: defineOperation({
    name: 'set_subscription',
    summary: 'Subscribe to an idea, or unsubscribe',
    description:
      "Subscribes you to an idea's updates, or unsubscribes you: then you hear nothing more about it, even as its author or reviewer, except when someone asks you to review it.",
    method: 'POST',
    path: '/ideas/{idea}/subscription',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, subscribed: z.boolean() }),
    output: z.object({ subscribed: z.boolean(), reason: InboxReason.nullable() }),
  }),
  getNotificationSettings: defineOperation({
    name: 'get_notification_settings',
    summary: 'What you want to hear about',
    description:
      '`ownBots`: whether what a bot does on your behalf lands in your inbox (it does unless you turn it off).',
    method: 'GET',
    path: '/me/notifications',
    kind: 'read',
    input: z.strictObject({}),
    output: z.object({ ownBots: z.boolean() }),
  }),
  setNotificationSettings: defineOperation({
    name: 'set_notification_settings',
    summary: 'Change what you hear about',
    description: '`ownBots`: whether what a bot does on your behalf lands in your inbox.',
    method: 'POST',
    path: '/me/notifications',
    kind: 'write',
    input: z.strictObject({ ownBots: z.boolean() }),
    output: z.object({ ownBots: z.boolean() }),
  }),
  setReviewer: defineOperation({
    name: 'set_reviewer',
    summary: 'Ask someone to review an idea, or take them off its reviewers',
    description:
      "Asks a person or a group to review an idea (`reviewer: true`), which gives them view access if they don't have it, or takes them off its reviewers (`false`), which leaves their access as it is. Removing their access (set_access) takes them off too. The owner can't be a reviewer. Needs share access.",
    method: 'POST',
    path: '/ideas/{idea}/reviewers',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      subject: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('user'), id: z.string().min(1).max(64) }),
        z.strictObject({ kind: z.literal('group'), id: z.string().min(1).max(64) }),
      ]),
      reviewer: z.boolean(),
    }),
    output: z.object({ grants: z.array(Grant) }),
  }),
  previewMove: defineOperation({
    name: 'preview_move',
    summary: 'Preview moving an idea (the move wizard)',
    description:
      "What moving an idea into, out of, or to another team would change: the grants now and after, and who would lose or gain access, by name. The old team's members lose the access it gave them; the new team's defaults are added. `keep` and `skip` adjust that. Nothing changes.",
    method: 'POST',
    path: '/ideas/{idea}/move/preview',
    kind: 'read',
    input: MoveInput,
    output: MovePreview,
  }),
  moveIdea: defineOperation({
    name: 'move_idea',
    summary: 'Move an idea',
    description:
      'Moves an idea into, out of, or to another team, with the same adjustments as preview_move. Needs share access, and permission to create ideas in the new team. People who lose access stop seeing it at once.',
    method: 'POST',
    path: '/ideas/{idea}/move',
    kind: 'write',
    input: MoveInput,
    output: MovePreview,
  }),

  createTeam: defineOperation({
    name: 'create_team',
    summary: 'Create a team',
    description: 'Creates a team, with you as its first admin. Teams are invite only.',
    method: 'POST',
    path: '/teams',
    kind: 'write',
    input: NewContainer,
    output: Team,
  }),
  getTeam: defineOperation({
    name: 'get_team',
    summary: 'Read a team',
    description: "A team's name, member count, who can create ideas in it, and its defaults for new ideas.",
    method: 'GET',
    path: '/teams/{team}',
    kind: 'read',
    input: z.strictObject({ team: Ref }),
    output: Team,
  }),
  listTeams: defineOperation({
    name: 'list_teams',
    summary: 'List teams',
    description: 'Teams by handle, 25 at a time, optionally matching a search.',
    method: 'GET',
    path: '/teams',
    kind: 'read',
    input: z.strictObject({ q: z.string().max(100).optional(), cursor: Cursor, limit: Limit }),
    output: Page(Team),
  }),
  getTeamWatch: defineOperation({
    name: 'get_team_watch',
    summary: 'How much of a team you hear about',
    description:
      "Your watch level for a team: participating (only ideas you're involved in, the default), active (every idea once it's out of draft, up to and including its close) or all (drafts too).",
    method: 'GET',
    path: '/teams/{team}/watch',
    kind: 'read',
    input: z.strictObject({ team: Ref }),
    output: z.object({ level: WatchLevel }),
  }),
  setTeamWatch: defineOperation({
    name: 'set_team_watch',
    summary: 'Change how much of a team you hear about',
    description:
      'Sets your watch level for a team. Above participating, its ideas\' updates join your inbox (as "watching"), for ideas you can see; anyone can watch a team, member or not.',
    method: 'POST',
    path: '/teams/{team}/watch',
    kind: 'write',
    input: z.strictObject({ team: Ref, level: WatchLevel }),
    output: z.object({ level: WatchLevel }),
  }),
  updateTeam: defineOperation({
    name: 'update_team_settings',
    summary: "Change a team's settings",
    description:
      "Who can create ideas in the team, what new ideas in it start with (the team members' access, public or not, and groups), and its handle, name and description. Admins only. Existing ideas keep their access. A new handle keeps the old one leading to the team (its page and its ideas' addresses); for 90 days no other team can take it.",
    method: 'POST',
    path: '/teams/{team}/settings',
    kind: 'write',
    input: z.strictObject({
      team: Ref,
      createPolicy: CreatePolicy.optional(),
      defaults: TeamDefaults.optional(),
      /** A new handle: its old one keeps leading to it, and is kept for it for 90 days. */
      handle: z.string().trim().min(1).max(39).optional(),
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(2000).optional(),
    }),
    output: Team,
  }),
  setTeamRequirements: defineOperation({
    name: 'set_team_requirements',
    summary: "Change a team's approval requirements",
    description:
      "What an idea in the team needs before it can be closed as accepted: a number of approvals from people on the latest version (0 for none), group rules (one approval from any of the groups, or one from each; with `request`, the groups are asked to review when an idea goes out for review), and every thread resolved. Groups by ID or handle. It applies at once to every idea in the team, those in review too. The team's maintainers and admins only.",
    method: 'POST',
    path: '/teams/{team}/requirements',
    kind: 'write',
    input: z.strictObject({ team: Ref, requirements: TeamRequirements }),
    output: Team,
  }),
  listTeamMembers: team.members,
  addTeamMember: team.addMember,
  removeTeamMember: team.removeMember,
  requestToJoinTeam: team.requestToJoin,
  listTeamJoinRequests: team.joinRequests,
  decideTeamJoinRequest: team.decide,

  createGroup: defineOperation({
    name: 'create_group',
    summary: 'Create a group',
    description:
      'Creates a group, with you as its first admin. Groups are invite only and visible to everyone, with their members.',
    method: 'POST',
    path: '/groups',
    kind: 'write',
    input: NewContainer,
    output: Group,
  }),
  getGroup: defineOperation({
    name: 'get_group',
    summary: 'Read a group',
    description: "A group's name and member count.",
    method: 'GET',
    path: '/groups/{group}',
    kind: 'read',
    input: z.strictObject({ group: Ref }),
    output: Group,
  }),
  listGroups: defineOperation({
    name: 'list_groups',
    summary: 'List groups',
    description: 'Groups by handle, 25 at a time, optionally matching a search.',
    method: 'GET',
    path: '/groups',
    kind: 'read',
    input: z.strictObject({ q: z.string().max(100).optional(), cursor: Cursor, limit: Limit }),
    output: Page(Group),
  }),
  listGroupMembers: group.members,
  addGroupMember: group.addMember,
  removeGroupMember: group.removeMember,
  requestToJoinGroup: group.requestToJoin,
  listGroupJoinRequests: group.joinRequests,
  decideGroupJoinRequest: group.decide,
} as const
