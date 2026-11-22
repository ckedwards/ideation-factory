// The directory's operations: people, teams, groups, lists and search, and an
// idea's access (sharing and the move wizard).
import { z } from 'zod'
import { defineOperation } from './operation.ts'

/** A yes or no in a query string ("true" or "false"), or as JSON. */
const Flag = z.union([z.boolean(), z.stringbool()])

const NOTIFICATION_SETTINGS_HELP =
  '`ownBots`: whether what a bot does on your behalf lands in your inbox (it does unless you turn it off). ' +
  '`email`: what reaches you by email as well: `involved` (the default: everything the inbox has for ideas you wrote, ' +
  'were asked to review or took part in), `review-requests` (only being asked to review) or `off`. ' +
  '`emailWatching`: whether the teams you watch email you too (off by default; they always fill the inbox). ' +
  '`cadence`: `bundled` (the default: one email per idea once it has gone quiet for a few minutes) or `daily` ' +
  '(one digest a day). Reading an idea first, or marking it read or done, stops its email. ' +
  '`emailAvailable`: whether this deployment sends email at all.'
import {
  CreatePolicy,
  Cursor,
  EmailCadence,
  EmailChoice,
  Grant,
  GrantSubject,
  Group,
  GroupRole,
  GroupTeam,
  Handle,
  IdeaId,
  IdeaRow,
  IdeaStatus,
  InboxReason,
  InboxShow,
  Limit,
  Member,
  Memberships,
  MovePreview,
  Notification,
  NotificationSettings,
  Page,
  Permission,
  Ref,
  Role,
  Team,
  TeamDefaults,
  TeamGroup,
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
      description: `A ${kind}'s members with their roles and when they joined, 25 at a time: by name unless sorted by role (admins first) or by when they joined, and optionally only those whose handle starts with, or whose name has, a search.`,
      method: 'GET',
      path: `${path}/members`,
      kind: 'read',
      input: id
        .extend({
          q: z.string().max(100).optional(),
          sort: z.enum(['name', 'role', 'joined']).optional(),
          order: z.enum(['asc', 'desc']).optional(),
          cursor: Cursor,
          limit: Limit,
        })
        .strict(),
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

/** What a search of titles is: a word of at least 3 characters (search_ideas, and list_ideas's `q`). */
const SearchText = z
  .string()
  .trim()
  .max(200)
  .refine((q) => q.split(/\s+/).some((t) => [...t].length >= 3), 'a search needs a word of at least 3 characters')

export const directoryOperations = {
  me: defineOperation({
    name: 'whoami',
    mcp: true,
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
    mcp: true,
    summary: 'List ideas',
    description:
      "Ideas you can see, most recently updated first, 25 at a time, optionally in one team, by one owner, asking one person to review it (by name or through a group they're in), in one status, open or closed (an idea in an archived team counts as closed, whatever its status), or whose titles contain a search (`q`, matched as search_ideas matches it; `incomplete` then says it matched more ideas than one search checks, so add a word to narrow it). The filters combine.",
    method: 'GET',
    path: '/ideas',
    kind: 'read',
    input: z.strictObject({
      q: SearchText.optional(),
      team: Ref.optional(),
      owner: Ref.optional(),
      /** Asking this person to review it, by name or through a group they're in. */
      reviewer: Ref.optional(),
      /** Asking this group to review it. */
      reviewerGroup: Ref.optional(),
      status: IdeaStatus.optional(),
      state: z.enum(['open', 'closed']).optional(),
      cursor: Cursor,
      limit: Limit,
    }),
    output: Page(IdeaRow).extend({ incomplete: z.boolean().optional() }),
  }),
  countIdeas: defineOperation({
    name: 'count_ideas',
    summary: 'Count ideas',
    description:
      "How many ideas list_ideas would list with these filters, open and closed (an idea in an archived team counts as closed): for the counts on a list's tabs.",
    method: 'GET',
    path: '/ideas/count',
    kind: 'read',
    input: z.strictObject({
      q: SearchText.optional(),
      team: Ref.optional(),
      owner: Ref.optional(),
      reviewer: Ref.optional(),
      status: IdeaStatus.optional(),
    }),
    output: z.object({ open: z.number().int(), closed: z.number().int() }),
  }),
  searchIdeas: defineOperation({
    name: 'search_ideas',
    mcp: true,
    summary: 'Search ideas',
    description:
      'Ideas you can see whose titles contain the search, closest first. A search needs at least 3 characters; it matches anywhere in a word, and shorter words in it are ignored. `incomplete` means the search matched more ideas than one search checks (20,000), so only the best-ranked of them were: add a word to narrow it.',
    method: 'GET',
    path: '/search/ideas',
    kind: 'read',
    input: z.strictObject({
      q: SearchText,
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
    mcp: true,
    summary: 'Your inbox',
    description:
      "What's happened to the ideas you hear about: one row per idea (newest first, 25 at a time), with why you hear about it (you wrote it, were asked to review it by name or through a group, took part, or subscribed), how many updates are new, and the latest. Among them, notices about your teams and groups (`kind: 'notice'`: a group joined or left a team, or you were added to or taken out of one), each its own row; `reason: 'teams'` lists only those. `done` lists the ones you've cleared instead. Ideas you can no longer see aren't listed.",
    method: 'GET',
    path: '/notifications',
    kind: 'read',
    input: z.strictObject({
      done: Flag.optional(),
      reason: InboxShow.optional(),
      /** Only ideas in this team, and notices about it. */
      team: Ref.optional(),
      unread: Flag.optional(),
      cursor: Cursor,
      limit: Limit,
    }),
    output: Page(Notification),
  }),
  countNotifications: defineOperation({
    name: 'count_notifications',
    summary: 'Count your inbox',
    description:
      'How many rows your inbox has (not done): in all, with unread updates, by why (`teams` for the notices about teams and groups), and by team.',
    method: 'GET',
    path: '/notifications/counts',
    kind: 'read',
    input: z.strictObject({}),
    output: z.object({
      all: z.number().int(),
      unread: z.number().int(),
      reasons: z.partialRecord(InboxShow, z.number().int()),
      teams: z.array(z.object({ id: z.string(), handle: z.string(), name: z.string(), count: z.number().int() })),
    }),
  }),
  unreadNotifications: defineOperation({
    name: 'count_unread_notifications',
    summary: 'How many ideas have news',
    description:
      'How many rows in your inbox have something you haven’t read: ideas (not events), and notices about teams and groups.',
    method: 'GET',
    path: '/notifications/unread',
    kind: 'read',
    input: z.strictObject({}),
    output: z.object({ count: z.number().int() }),
  }),
  markNotifications: defineOperation({
    name: 'mark_notifications',
    mcp: true,
    summary: 'Mark ideas and notices read or done',
    description:
      "Marks rows of your inbox read (`read: true`), done (`done: true`: cleared until something new happens) or back in the inbox (`done: false`): `ideas` and `notices` by their IDs, or, without them, every row in the list they move out of (or, for `read`, all of them). `team` keeps that to one team's ideas and notices, `owner` to one person's ideas outside any team, and `group` to a group's own notices, as the inbox grouped by team shows them.",
    method: 'POST',
    path: '/notifications/mark',
    kind: 'write',
    input: z.strictObject({
      ideas: z.array(IdeaId).max(100).optional(),
      notices: z.array(z.string().min(1).max(64)).max(100).optional(),
      /** Only this team's ideas, and notices about it. */
      team: Ref.optional(),
      /** Only this person's ideas outside any team. */
      owner: Ref.optional(),
      /** Only this group's own notices (not about a team). */
      group: Ref.optional(),
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
    description: NOTIFICATION_SETTINGS_HELP,
    method: 'GET',
    path: '/me/notifications',
    kind: 'read',
    input: z.strictObject({}),
    output: NotificationSettings,
  }),
  setNotificationSettings: defineOperation({
    name: 'set_notification_settings',
    summary: 'Change what you hear about',
    description: `${NOTIFICATION_SETTINGS_HELP} Give only what changes.`,
    method: 'POST',
    path: '/me/notifications',
    kind: 'write',
    input: z.strictObject({
      ownBots: z.boolean().optional(),
      email: EmailChoice.optional(),
      emailWatching: z.boolean().optional(),
      cadence: EmailCadence.optional(),
    }),
    output: NotificationSettings,
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
  listTeamGroups: defineOperation({
    name: 'list_team_groups',
    summary: "List a team's groups",
    description:
      "The groups in a team: their members are the team's members, each at the lower of the group's role here (member or maintainer) and their own role in the group.",
    method: 'GET',
    path: '/teams/{team}/groups',
    kind: 'read',
    input: z.strictObject({ team: Ref }),
    output: z.object({ items: z.array(TeamGroup) }),
  }),
  addTeamGroup: defineOperation({
    name: 'add_team_group',
    summary: 'Add a group to a team',
    description:
      "Adds a group to a team (the team's admins), or changes its role there: its members become the team's members, as members unless maintainer is chosen, never admins. It follows the group: someone who joins it is in the team, and someone who leaves it is out.",
    method: 'POST',
    path: '/teams/{team}/groups',
    kind: 'write',
    input: z.strictObject({ team: Ref, group: Ref, role: GroupRole.optional() }),
    output: TeamGroup,
  }),
  removeTeamGroup: defineOperation({
    name: 'remove_team_group',
    summary: 'Take a group out of a team',
    description:
      "Takes a group out of a team: the team's admins, or the group's (its leaving the team). The people in the team only through it leave it at once.",
    method: 'POST',
    path: '/teams/{team}/groups/{group}/remove',
    kind: 'write',
    input: z.strictObject({ team: Ref, group: Ref }),
    output: z.object({ removed: z.boolean() }),
  }),
  listGroupTeams: defineOperation({
    name: 'list_group_teams',
    summary: 'List the teams a group is in',
    description: 'The teams a group is in, with its role in each.',
    method: 'GET',
    path: '/groups/{group}/teams',
    kind: 'read',
    input: z.strictObject({ group: Ref }),
    output: z.object({ items: z.array(GroupTeam) }),
  }),
  listGroupRules: defineOperation({
    name: 'list_group_rules',
    summary: "List the teams' approval rules that name a group",
    description:
      "Each team approval rule that names a group: the team, whether it needs an approval from any or each of its groups, whether they're asked to review, and the groups.",
    method: 'GET',
    path: '/groups/{group}/rules',
    kind: 'read',
    input: z.strictObject({ group: Ref }),
    output: z.object({
      items: z.array(
        z.object({
          team: z.object({ id: z.string(), handle: z.string(), name: z.string() }),
          mode: z.enum(['any', 'each']),
          request: z.boolean(),
          groups: z.array(z.object({ id: z.string(), handle: z.string(), name: z.string() })),
        }),
      ),
    }),
  }),
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
