# Ideation Factory

## Mission

The goal of this is to create a platform where agents and humans can collaborate on the "ideation" phase of software development. As the time do produce software drops dramatically with each new frontier model, it is more importaint that software engineers get the the architechure, design and implementation plan correct up front. In the past the longer implementation time allowed for natrual checkpoints. Your colligues would ask you what your working on, you could get advice from your boss in your one-on-one meetings. This is no longer adiquate. Now you produce 1,000 lines of code before lunch. This platform strives to enable software engineers to be able to share ideas and get feedback. The goal is not to replace git or github, but focus on this one aspect and to it well. Where the approved and inialized ideas are recorded in the end is up to you. It could be a separate git repo, the git repo where the changes are made, Jira, Confluence or any other preferred platform. Every company operates differently, so that decision is yours to make.

## Editing with commands

This is what sets Ideation Factory apart. Agents (through skills, the cli or the MCP server) and people (in the web UI) edit an idea in place with commands: replace this sentence, move this section, rename this heading. Then they pull the result into the repository. Because every edit says exactly what it does, comments stay attached to the right text through restructuring, which is what makes a long review with many rounds of agent edits workable. People and agents use the same framework, and a suggested edit is just a pending command. Uploading an edited copy still works, with comments followed through the diff as well as possible. See Editing with commands in `architecture.md`.

## Accounts

A user account is a **name** (shown on ideas and comments; changeable), a **handle** they create when they sign up (unique, used for @mentions and by the cli), and a **primary email**. The primary email is ultimately what the account is: sign-in codes go to it, and other sign-in providers match on it.

By default people sign in with a one-time **code sent to their email** or a **passkey**. There are no passwords. A company can instead plug in its own identity provider (SAML or OIDC) for a more streamlined process: people sign in with their work account, and accounts that don't exist yet can be created automatically. See Accounts and sign-in in `architecture.md`.

## Bots vs humans creating edits and comments

We welcome agentic editing in addition to human edits. However, we want to distiquist between the two where possible. Not because one is better than the other, but rather for transparancy. That even `user` created documents may have been primarily generated from an agentic process. The goal here is to distiguish between where `user`s provided input vs where the process was fully agentic.

Bot comments or versions in the version history should look like `[bot emoji] on behalf of <user>` rather than `user`. Even better if you have an agent name it would look like `[bot emoji] <typobot> on behalf of <user>`. If there is no user associated with the agent, it could just be `[bot emoji]` or `[bot emoji] <typobot>`. The goal here is to distiguish between fully automated agentic feedback and ones that have been user dirven. The easiest way to make this distintion is to use different auth tokens for the different roles. Our auth token creation UI should include a purpose to match these roles. This could be a "bot", "bot associated with me" or "me".

Every token expires: these personal tokens after at most a year (there's no "never expires" option). They never carry site admin access, even when a site admin creates them. **Site admin tokens** are a separate, more dangerous kind: only site admins can create them, they need a reason (logged with every use), they last at most 30 days, creating one requires an explicit acknowledgement, and they're shown once. Their activity is labeled "via site admin token". Revoking a token takes effect within 15 minutes, because requests carry short-lived signed tokens rather than reading the token store each time (see Authorization in `architecture.md`).

## Tech stack

## Front end

This is a React/Tanstack repo. Tanstack has done an amazing job curating a set of high quality tools. Focus on useing those where possible.

### Theming

Custom theming should be supported with a light, dark and highcontrast theme out of the box. Themes should be easily customizable with a set of css variables so that companies can easily intigrate this product. Hard coded pixel values make cutsom theming diffictult and should be avoided.

## Backed

The backend is TypeScript on Bun, with [Rivet](https://github.com/rivet-dev/rivet) actors: one actor per idea, plus a directory actor for shared data, each with its own SQLite. It runs on infrastructure companies already have (containers on VMs or Kubernetes, plus any S3-compatible bucket), with no particular cloud and no database server to run. Not depending on Cloudflare (or any one cloud) is a primary goal, because the people this is for mostly don't use it. See `mvp/architecture-backend.md`.

## CLI

Since this is not fully integrated into any one system (say github), a cli tool is needed to handle things like syncing documents to and from the Ideation Factory. This tool is written in TypeScript and compiled with Bun into a single executable. That's the same language as the rest of the stack, so it shares the core packages (schemas, edit commands, Markdown handling) with the backend and the web app.

## Skills

Skills should be created to help users manage Ideas in Ideation Factory

## Team support

Out of the box this needs to support mutiple teams. Teams can be created by any user. Teams are normally archived (and unarchived), never deleted, by an admin of the team or a site admin. Only a site admin can permanently delete a team, which erases it and every idea in it (all versions, comments, reviews and notifications) with no way back. That's for exceptional cases like a team made by mistake or content that legally must be removed, and the confirmation says so and offers archiving instead. An archived team can't start new ideas or change the state of its active ideas. Its open ideas count as **archived**, a pseudo-closed state, even if their own status is still open. Everything stays readable and searchable. Teams is just a way to group ideas and it is up to organizations to decide how they want to handle this orginizationally.

**Access is per idea, like a shared document** (see Authorization in `architecture.md`). An idea can be given view, edit or share access, to people, groups, the members of its team, or everyone. **Reviewers are viewers:** asking someone to review gives them view access.

Not every idea belongs to a team. An idea created outside a team (rough notes, side projects, things not ready to share) is **private**: only its owner has access until they share it or move it into a team (moving goes through a move wizard that shows how access will change; see Authorization in `architecture.md`). An idea created in a team starts with the **team's defaults for new ideas**: what the team's members get (nothing, view or edit), whether it starts public, and any groups that get access. A team that wants its ideas kept to its members (for incidents, unannounced projects and similar) sets its default to members-only and not public; because access through a team follows membership, removing someone from the team removes their access straight away. Each team also decides **who can create ideas in it**: anyone, its members (the default), or only its maintainers and admins.

A user can be part of mutiple teams. Separately from membership, any user can choose how much they hear about each team (its watch level):

- **Participating and assigned** (the default): only ideas they wrote, were asked to review (directly or through a group), or follow.
- **Active**: every idea once it's out of draft, through to and including when it's closed.
- **All**: every idea, drafts included.

Teams and groups have the same roles:

- **Admins**: everything, including the settings page (name, description), roles, and archiving a team or deleting a group. On teams, admins also set the defaults for new ideas and who can create ideas, and can change access on every idea in the team.
- **Maintainers**: approve or deny requests to join, add and remove members, and (on teams) change approval requirements.
- **Members**.

A **site admin** is an admin of every team and group. Anything a person can do only because they're a site admin (not through their own role) is called out in the UI with a shield and a distinct color: a Settings button on a team they don't run, settings tabs beyond their role, role changes, permanent deletion, the site admin page. Otherwise a site admin sees the same things anyone in their roles would; their home page only shows their own teams and groups. **Teams and groups are always invite only:** people ask to join and a maintainer or admin approves or denies, or a maintainer or admin adds them directly. Membership gives access to everything shared with the team or group, so joining can't be self-service. (No open teams or groups for now; revisit if people ask for them.) Teams, groups and their members are visible to everyone. Settings are pages, not popups. Maintainers see only the parts they can change. Leaving a team or group asks for confirmation first and says what you'd lose (a role, access to ideas shared with it, review requests sent to a group, your approvals counting for a group, and whether you'd need approval to come back).

Each team can set approval requirements. Only the team's maintainers and admins can change them. An idea in the team is approved once all of them hold. There are three parts: a **minimum number of approvals** in total (always set; 0 means no minimum), any number of **group rules**, and optionally **all discussions resolved** (every comment thread on the idea is resolved). A group rule is either *one approval from any of* its groups (or) or *an approval from each of* them (and); with a single group the two mean the same, so there's no separate single-group rule. Each group rule can also **add its groups as reviewers automatically** when an idea goes out for review (created ready for review, or moved out of draft), so nobody has to remember to ask them.

## Inactive users

A site admin can mark a user inactive, for example when they leave the company. An inactive user is read only: they can sign in and read, but can't comment, review, approve, upload or change settings. Their tokens (including bots acting on their behalf) can't write from that moment, and stop working entirely within 15 minutes (see Authorization in `architecture.md`), they stop getting notifications, and they can't be added to teams or groups or asked to review. Everything they did stays, labeled with their name and an "inactive" marker wherever they appear, and approvals they already gave still count. If they were the only active admin of a team or group, the site admin is told so it can be given a new admin. Inactive users can be reactivated.

## Terms

Idea - each working set is an "Idea". The idea can have a name, description (optional) and has an owner. You can assign mutiple people or group of people to review the document, which gives them view access. An idea is either open or closed:

- Open: **draft** (being written, not asking for review yet), **requesting review**, **changes in progress** (it's being revised), or **approved** (the team's approval requirements are met).
- Closed, with a reason: **closed accepted** (the idea goes ahead) or **closed rejected** (it doesn't).

An idea in an archived team counts as **archived**: closed for every purpose (lists, watching, approvals), whatever its own status. An idea is "active" once it's out of draft and until it's closed or archived.
