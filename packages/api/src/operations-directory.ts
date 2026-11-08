// The directory's operations: people, teams, groups, lists and search, and an
// idea's access (sharing and the move wizard).
import { z } from 'zod'
import { defineOperation } from './operation.ts'
import {
  CreatePolicy,
  Cursor,
  Grant,
  GrantSubject,
  Group,
  Handle,
  IdeaId,
  IdeaRow,
  Limit,
  Member,
  Memberships,
  MovePreview,
  Page,
  Permission,
  Ref,
  Role,
  Team,
  TeamDefaults,
  TokenInfo,
  User,
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

  listIdeas: defineOperation({
    name: 'list_ideas',
    summary: 'List ideas',
    description:
      'Ideas you can see, most recently updated first, 25 at a time, optionally in one team, by one owner, or in one status.',
    method: 'GET',
    path: '/ideas',
    kind: 'read',
    input: z.strictObject({
      team: Ref.optional(),
      owner: Ref.optional(),
      status: z.string().max(40).optional(),
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
