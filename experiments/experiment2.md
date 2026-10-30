# Experiment 2: the rest of the site

**Status:** prototype, throwaway. Front end only, with canned data. Nothing persists except the theme choice.

The question this answers: what does the site around the idea page look like? That means home, notifications, idea and team search, team pages, groups, sign-in, and settings for profile, sign-in and tokens. It uses the same visual language as [experiment 1](experiment1.md) (the idea page).

## Run it

```sh
npm --prefix experiments/experiment2 install   # first time only
npm --prefix experiments/experiment2 run dev
```

Open http://localhost:5200. The logged-in user is **Riley Park**. The dev buttons in the bottom-right corner (dev builds only) switch **site admin** on and off, open the **sign-up** preview, and show the in-memory **state**.

Two ideas have a real page, on experiment 1 (http://localhost:5199/prototype/idea), so run that too: "Offline-first sync for the field app", and "Ideation Factory MVP architecture" in the Dogfood team, which shows the real `mvp/` docs. Other idea titles show a short message instead.

To show it to people, `experiments/demo` packages both prototypes as one password-protected Cloudflare site (see its README).

## Designed for scale

The data is a small hand-written story (Riley, Mobile, Payments, the offline-sync idea) layered on generated data at a realistic size. The generated set has **3,000 people** (with repeated names), **240 teams** (a few with 80–220 members), **600 groups**, **6,000 ideas** (mostly closed) and **about 420 notifications** for Riley over a month. It's seeded, so it's the same on every reload. The UI follows the scale rules in `architecture.md`:

- **Everything is paged,** 25 at a time, with `?page=` in the URL. Changing any filter goes back to page 1.
- **People, teams and groups are picked by type-ahead,** never a long dropdown. Results are capped at about 8, and shortcuts like "You" and "Your teams" show before you type.
- **People show a unique `@handle`** (and a team) wherever they're picked, because names repeat. For example, there are two Chen Wus.
- **Summaries instead of full lists:** avatar stacks with "+N". A large team shows 12 members, then a searchable, paged list.
- **Notifications bundle per idea.**
- **Home and the sidebar cap their lists** and link to the full, filtered view.

Measured in the browser, every page renders 25 rows or fewer in under about 100 ms. Before these changes, Ideas → Closed rendered 4,055 rows (about 80,000 DOM nodes) and took 3.5 s.

## Core concepts

### Idea states

| | State | Meaning |
|---|---|---|
| Open | **Draft** | Being written; not asking for review yet |
| Open | **Requesting review** | Out for review |
| Open | **Changes in progress** | The author is revising |
| Open | **Approved** | The team's approval requirements are met |
| Closed | **Closed · accepted** | Done, and the idea goes ahead |
| Closed | **Closed · rejected** | Done, and the idea doesn't go ahead |
| Closed | **Archived** | Its team is archived. Read-only, whatever its own status was |

"Active" means open (not closed or archived) and out of draft.

### Roles and membership (teams and groups alike)

- **Admins:** everything, including the settings page (name, description, who can join), roles, and archiving a team or deleting a group.
- **Maintainers:** approve or deny requests to join, add and remove members, and (on teams) change approval requirements.
- **Members.**
- **Site admins** are admins of every team and group. The prototype has a dev **site admin** switch in the bottom-right corner.
  - **Called out:** anything a site admin can do *only* through site-admin powers is marked with 🛡 and the `--admin` color. That covers the Settings button and requirement **Change** link on teams and groups where they have no role, settings tabs beyond their own role, role menus they couldn't otherwise use, **Pick a new admin**, **Delete permanently**, the **Site admin** nav entry and page, and an admin badge under their name.
  - **When there's no own role:** settings pages say "You're here as a site admin" when they have no role there, or "Some tabs are site admin only" when their role covers only part of the page. They open on the first tab their own role gives them.
  - **Otherwise unchanged:** a site admin sees what their roles give them. **Needs you as a maintainer** on Home only lists teams and groups where *they* are a maintainer or admin; site-wide problems are on the Site admin page.
- **Who can join:** **Anyone** (join straight away) or **Invite only** (you **Request to join**, and a maintainer or admin approves or denies; they can also add people directly).

### Archived teams and deleted groups

- **Teams are archived, not deleted,** by an admin. A **site admin** can permanently delete a team as a last resort (see settings below).
  - An archived team can't start ideas or change the state of its active ones. Its open ideas become **Archived** and move to the Closed tab.
  - The team page turns read-only, with a banner.
  - It leaves the team directory's normal views (there's an **Archived** filter).
  - Admins can unarchive it, and its ideas go back to the state they were in.
- **Groups can be deleted,** by their admins only.
  - A deleted group is kept as a record. Approvals from its members no longer count toward any requirement that names it.
  - A group rule **breaks** only if it can no longer be met: "each of" where any group is deleted, or "any of" where every group is deleted (with one group, either breaks when it goes). A broken requirement shows an error, and those ideas can't be approved until a maintainer or admin of the team fixes it.
  - "Any of" with other groups left **keeps working** through them, with a warning.
- **Leaving** a team or group asks "Leave …?" first, and lists what you'd lose: an admin or maintainer role, review requests sent to the group, your approvals counting for it in team requirements, and (if it's invite only) having to ask to come back.

### Inactive people

A site admin can mark someone **inactive**, for example when they leave.

- **What it means:** they become read-only, their tokens stop, and they can't be added to teams or groups or asked to review.
- **How it shows:** wherever they appear (author, members, notifications, bot "on behalf of" labels), with a dimmed avatar and an **inactive** tag.
- **Pickers:** the ones that add people skip them. Search filters (like Author) still find them, labeled.
- **No active admin:** if every admin of a team or group is inactive, its page shows "has no active admin", and the Site admin page lists it under **Needs a new admin**.
- **In the data:** **Tomás Silva** starts inactive, as someone who left, which leaves Dispatch with no active admin.

### Your ideas (a private, one-person team)

Ideas don't have to belong to a team. Everyone has **🔒 Your ideas**: a hidden team with just them in it.

- **Hidden from team UI:** it never shows in the team directory, team pickers or "Your teams". Nobody can join or watch it, and it has no settings, roles or approval requirements.
- **Private:** its ideas are visible only to the owner and the people they ask to review (people only, never groups). They carry a **🔒 Your ideas** chip and a **Private** tag.
- **Where it lives:** the nav has **🔒 Your ideas** (with an open count). The page has the usual Open | Closed lists, and each open idea has **Move to a team…**.
- **Moving:** the move dialog picks one of your teams and spells out what changes: everyone can read it, the team's approval requirements apply, its watchers start hearing about it, and history comes along. Moving counts as going out for review in that team, so groups the team adds automatically join the reviewers straight away (or, for a draft, "when it leaves draft"). Try moving "Keep cli tokens in the OS keychain" into Mobile: Mobile leads is added.
- **In the data:** Riley has three: a draft, one out for review with Maya, and one closed as accepted.

### Locked teams

A team whose ideas only its members can see. Same privacy rule as Your ideas, but it's a real team.

- **Listed and selectable:** locked teams show in the directory, team pickers and "Your teams", with a **🔒 Locked** tag (and a 🔒 on chips). Anyone can see the name, description, members and approval requirements.
- **Access = the member list:** only members see its ideas, in lists, search, quick search, counts, Home and group pages. Being asked to review doesn't grant access on its own.
- **What members see** (a setting under Locked):
  - **Only ideas they're on** (the default for newly locked teams): plain members see ideas they wrote or are asked to review, and nothing else, not even a count of the rest. Taking someone off an idea's reviewers takes their access away.
  - **Every idea in the team.**
  - **Admins and maintainers always see every idea.** A site admin is treated by their own role in the team.
  - The team page says which applies to you ("you see only the ideas you're on", or "as an admin you see all of them"), and the directory counts "active ideas you're on". Changing it warns how many members are affected.
- **Notifications:** only from ideas you can see. Your inbox, subscriptions and "waiting on you" all skip the rest, even for ideas you wrote or review.
- **Revoking:** removing someone from the team takes their access away, straight away. In settings that's confirmed in a dialog that says what they lose (how many ideas, how many they wrote or review), that what they wrote stays credited to them, and that adding them back restores it. Leaving a locked team says the same.
- **Outside:** non-members get a "visible to members only" panel instead of the idea lists, with no counts or activity, and no watch picker (watching would tell you nothing). The directory row says "ideas visible to members only".
- **Always invite only:** an open join would get around the lock.
- **No groups:** private teams (locked teams and Your ideas) only take people as reviewers. A locked team's approval requirements can't have group rules: the editor says so in place of the group section, leaving minimum approvals and resolved discussions. Group membership doesn't line up with who can see the ideas, so groups would complicate access too much.
- **Locking and unlocking:** admins choose under General, "Who can see its ideas". Each direction warns how many ideas become hidden or readable before you save. Locking is blocked while the team's requirements use groups (with **Change requirements →**), since dropping them silently would loosen approval. Locking also removes group review requests from the team's open ideas, and the warning says how many. Try it on Mobile, which uses Mobile leads.
- **Site admins** can open a locked team's settings and manage its members (called out as usual), but can't read its ideas unless they're members. The banner says so.
- **Moving an idea from Your ideas** into a locked team says only its members will see it.
- **In the data:**
  - **Incident Response:** Riley isn't a member; 2 ideas.
  - **Project Kite:** Riley is an admin; 2 ideas, a review request for Riley in the inbox, and Devon waiting to join. Remove Riley from Project Kite to see access go.
  - **Board Prep:** set to "Only ideas they're on", with Riley a plain member. He sees his own draft and the budget idea he's reviewing, but not "Reorg of the support team". Make him a maintainer (as a site admin) and it appears.

### Watch levels (per team)

How much of a team you hear about, member or not:

- **Participating and assigned** (the default): only ideas you wrote, are asked to review (directly or through a group), or follow.
- **Active ideas:** every idea once it's out of draft, through to and including when it's closed.
- **All ideas:** everything, drafts included.

### Approval requirements (per team, built from groups)

An idea in a team is approved once **all** of its team's requirements hold. There are three parts, always in this order:

- **Minimum approvals:** always set, default 0 (no minimum). "At least 2 approvals in total", from anyone.
- **Group rules** (any number):
  - **Any of** (or): "One approval from any of Platform reviewers or API reviewers".
  - **Each of** (and): "An approval from each of Security champions and Platform reviewers".
  - With one group they mean the same thing: "One approval from Security champions". So there's no separate single-group rule.
  - **Add as reviewers automatically** (a checkbox per rule): the rule's groups join an idea's reviewers when it goes out for review, either created ready for review or moved out of draft. Drafts don't pull groups in. Turning it on applies from then on; ideas already in review keep their reviewers. Deleted groups are skipped, and a group that's already reviewing isn't added twice. Wherever requirements are listed, these rules say "added as a reviewer automatically".
- **All discussions resolved** (on or off): every comment thread on the idea is resolved. On an idea it shows progress, e.g. "(4 open)".

Because group rules name groups rather than people, they keep working as people join and leave groups.

## Navigation

A left sidebar on every page:

- **Quick search** (press `/` to focus): ideas, teams and groups as you type. Enter, or "Search all ideas…", opens the full idea search.
- **Home, Notifications** (with the unread count), **Ideas, Teams, Groups**, and **Site admin** (for site admins).
- **Your teams** (the first 6, then "N more…"), and **Watching** for teams you watch but aren't in (the first 5). Each shows an **Active** or **All** badge when you watch it at that level.
- The Notifications badge caps at **99+**.
- **You** (picture and name, links to Settings) and the theme toggle.

Below 60rem the sidebar stacks above the page.

## Search

Ideas, teams, groups and the people pickers all use one simple search. In the real thing it runs on the server (see Scale in `architecture.md`); here it runs in the browser over the same amount of data:

- **Matching:** an item matches if the query appears anywhere in one of its fields, ignoring case.
- **Ranking,** in this order:
  1. **Field:** title, then team, then author, then description.
  2. **Closeness:** exact match, then the field starts with the query, then a word starts with it, then it's inside a word.
  3. **Position:** an earlier match ranks higher.
  4. **Length:** less surrounding text ranks higher.
- **Highlighting:** the matched text is highlighted in the results.

Without a query, lists sort by most recent (ideas) or by name (teams, groups).

## Pages

### Home (`/`)

- **Needs you as a maintainer** (when there's something): a team whose requirements name a deleted group ("Fix them →"), and teams or groups with people waiting to join. Each links straight to the right settings tab.
- **Waiting on your review:** the first 5 ideas requesting review where you're a reviewer, directly or through a group. Each says which. A link opens the Ideas page filtered to everything you're reviewing.
- **Your open ideas:** the first 5, linking to the Ideas page filtered to you as author.
- **Unread:** the 5 latest ideas with unread updates, in the same compact rows as the inbox.
- **Your teams:** the first 6, each with its count of active ideas and your watch level when it's above Participating.

### Notifications (`/notifications`)

Modeled on GitHub's notifications: quiet, one entry per idea.

- **Inbox:** one compact row per idea you're subscribed to, 25 per page.
  - **Each row:** a checkbox; an icon for the latest update; the team and idea title (bold when unread); the latest update ("Sam Achebe commented on § Conflicts · 2 new", with bot attribution as on the idea page); the idea's **state**; the reason (**Review requested**, Author, Reviewer, Via a group, Subscribed, Watching a team); and the time. Nothing else: rows have no actions.
  - **State:** where the idea is now (not what the update was), as an icon and a short label in its own aligned column:
    - **Draft:** a dashed ring, gray.
    - **In review:** requirements not met yet. A half-filled ring, amber.
    - **Reqs met:** in review with every approval requirement met (or the team has none). A ring with a check, green.
    - **Closed:** solid icons: a check for accepted (green), an ✕ for rejected (red), and an archive box for ideas in an archived team (gray).

    "In review" covers Requesting review, Changes in progress and Approved. **Hover** the state for a tooltip with the details: each requirement with ✓ / ○ / ⚠ (and "1 so far" for approval counts), the exact status, who has approved, the reviewers, and when it was last updated or closed, plus the version and team. It behaves like a real tooltip:
    - **Opens after a delay** (0.6 s). Once one is open, moving to another row's state opens it at once, until the pointer rests elsewhere for a moment.
    - **Closes** as soon as the pointer leaves, and on click, scroll or Esc.
    - **Looks** compact and inverted, above the state with an arrow (below if there's no room). It never catches the pointer.
    - **Keyboard:** tabbing to a state opens it straight away. On Home's compact rows, and on phones, only the icon shows.
  - **Unread:** an accent bar down the row's left edge, a light tint, and a bold title. No dot.
  - **Icons:** simple line icons, gray unless the outcome matters: review requested (eye, amber), comment (speech bubble), suggested edit (pencil), new version (upload arrow), status change (dot in a ring), new idea (page with a plus), approved (check, green), **closed as accepted** (check in a circle, green) and **closed as rejected** (✕ in a circle, red). Hovering names it.
  - **Reading and clearing:** opening an idea marks it read. Unsubscribing is on the idea's Details tab or under Subscriptions.
  - **Selecting:** tick rows' checkboxes, or the checkbox at the start of the toolbar for the whole page (it shows a dash when some are picked). The target is the row's whole left gutter (full height, tinted on hover), not just the box. **Shift-click** selects everything between the last row you clicked and this one, or clears it if that row was already selected, following on-screen order (including when grouped by team). Space on a focused checkbox works too, with Shift. With nothing selected, the toolbar offers **Mark all as read** and **Mark all as done** for everything filtered. With a selection, they become **Mark 3 as read** and **Mark 3 as done**, and **Clear selection** appears. In **Done**, a selection gets **Move 3 back to the inbox**. Acting clears the selection, and only selected rows still in the filtered list count.
  - **Group by** Date (Today / Yesterday / This week / Older) or **Team**, with "Mark these done" per team. There's also an **Unread only** box.
  - **Left column:** **Inbox / Done**; **Reason** (Everything, Review requested, Participating, Watching a team) with counts; and your **Teams** with counts (the top 12).
- **Subscriptions:** teams you watch (with their watch level) and every idea you're subscribed to, with search, a "Why" filter and pages. Each has a **Subscribe / Unsubscribe** button.
- **Counts:** the nav badge and the Inbox tab count **ideas with unread updates**, not individual events.

### Ideas (`/ideas`)

Search across all teams. Everyone can read every idea, except ideas in someone else's Your ideas and in locked teams they aren't in.

- **Open | Closed** tabs, each with a count.
- **Filters:**
  - **Drafts** (Open only): included, drafts only, or hidden.
  - **Closed as** (Closed only): any reason, accepted, rejected, or archived (team archived).
  - **Reviewer:** anyone, or you (directly or through your groups).
  - **Author:** type-ahead by name or @handle, or "You".
  - **Team:** type-ahead, or "Your teams".
  - **Clear filters** resets them.
- **25 per page,** with a range ("26–50 of 1,967") and Previous / Next.
- **Rows:**
  - Title, description, team, author and version.
  - Status.
  - For active ideas: progress against the team's requirements (e.g. "1 of 2 requirements met", or "✓ Requirements met"; hover for the list).
  - Open threads and reviewers (people and groups).
  - Closed ideas show when they closed.

### Teams (`/teams`)

- **Directory:** search teams, filtered to All / Your teams / Watching / Archived (archived teams only show there), and sorted by **Most active** (the default), Most members or Name. 25 per page.
- **Rows:** each team's member avatars and count, active-idea count ("ideas visible to members only" for a locked team you're not in), tags (Member, 🔒 Locked, Invite only, Archived), a **Notify** watch-level picker (not on locked teams you're outside), and **Join** / **Request to join** / **Leave**.
- **Membership:** you can be in several teams. Watching is separate from membership.
- **New team** is a guided setup through the settings page, like New group (below), with one more step:
  1. **`/teams/new`, Name and access:** name (unique among teams), description, **who can see its ideas** (Everyone / 🔒 Locked) and who can join (locked forces invite only). **Create and add members →** creates it with you as its first member and admin, and no requirements.
  2. **Members:** its real settings, titled "Set up Technician Tools Lab", with the guide above the tabs. **Next: Approval requirements →** moves on, and Finish is there if you want to stop.
  3. **Approval requirements:** the usual editor. A locked team gets no group rules. The guide says "Finish below", and the editor's button becomes **Save and finish** (or **Finish without requirements** if nothing changed), so leaving can't drop unsaved changes. It opens the team's page.
  - While setting up, only these three tabs show. Afterwards the settings have no guide and all their tabs (Archive too).

### Team page (`/teams/:id`)

- **Header:** name, tags (🔒 Locked, Invite only, Archived), description and who created it.
  - **Settings** (for maintainers and admins).
  - **Join**, **Request to join** (shows "Request sent · Cancel request"), or **Leave**. The only admin can't leave.
- **Banners:**
  - **Archived:** read-only.
  - **Locked:** members are told only members can see its ideas and that removing someone takes their access away. Non-members get the ideas replaced by a "visible to members only" panel (see Locked teams).
  - **Deleted group:** the team's requirements name a deleted group. Maintainers and admins get "Fix the requirements →"; everyone else sees who can fix it.
- **Watch level:** a "Notify me about" picker, with a plain sentence explaining the current level. Hidden when archived.
- **Ideas:** **Open | Closed** lists with the same filters as the Ideas page, minus Team.
- **Approval requirements,** read-only. A broken rule is red. An "any of" rule that lost one of its groups is amber, with "still works through the other groups". Maintainers and admins get **Change**, which opens settings.
- **Members:** admins and maintainers first, with role tags. Then the first 12, then "Show all N members" (searchable, 30 at a time).

### Group page (`/groups/:id`)

- **Header:** name, tags (Invite only, Deleted) and description.
  - **Settings** (for maintainers and admins).
  - **Join**, **Request to join**, or **Leave**.
- **Used in approval requirements:** every team rule that names the group.
- **Reviewing:** the first 5 active ideas it's a reviewer on, and how many more.
- **Members,** with roles, like the team page.
- **Deleted groups:** the page stays, with a banner saying who deleted it and which team requirements still need fixing.

### Team and group settings (`/teams/:id/settings`, `/groups/:id/settings`)

Pages, not popups. Tabs depend on your role. Plain members get "Only maintainers and admins … can open its settings."

| Tab | Who | What |
|---|---|---|
| **General** | Admins | Name, description, who can see its ideas (Everyone / 🔒 Locked, teams only), who can join (Anyone / Invite only; locked teams are always invite only) |
| **Members** | Maintainers, admins | Requests to join (with notes) → **Approve** / **Deny**. **Add people** by type-ahead. The member table (search, pages): admins change roles (the only admin can't be demoted) and remove anyone except the only admin. Maintainers can only remove plain members |
| **Approval requirements** (teams) | Maintainers, admins | Three fixed blocks: **Minimum approvals** (a number, 0 by default), **Group approvals** (rules with group chips joined by OR / AND; the any/each picker appears once a rule has two groups; an "Add as a reviewer automatically" checkbox per rule; and "Add group rule"), and **Discussions** ("All discussions must be resolved", noting how many active ideas have open threads). A summary lists what will be required, then Save / Discard. A broken rule shows "⚠ Names a deleted group … can't be met until you replace it", and Save stays disabled until it's fixed, as it does for a rule with no groups. An "any of" rule that lost a group shows an amber note and can still be saved |
| **Archive** (teams) | Admins | What archiving does (no new ideas; N open ideas frozen as archived; everything kept), then type the team's name to confirm. On an archived team: **Unarchive team** |
| **Delete permanently** (teams) | Site admins only | A warning and **Delete … permanently…**, which opens a dialog. It says "This can't be undone", lists everything it erases (all N ideas by state, with every version, file, comment, suggestion, review and approval; every notification about them; the team's memberships, roles, requests and requirements; every link to those ideas), and notes that people and groups aren't affected. Then **Archive instead**, Cancel, or type the team's name to **Delete permanently** |
| **Delete** (groups) | Admins | **What deleting would affect**: requirements that **can't be met** without it (with the rule and how many active ideas it blocks), requirements that **keep working** through other groups (where its members' approvals stop counting), open ideas where it's a reviewer, and its members. Or "✓ Nothing depends on this group." Then type the group's name to confirm |

### Groups (`/groups`)

- **Search groups** (deleted groups never show), filtered to All / Your groups and **Includes** a person (type-ahead, or "You"). 25 per page.
- **Rows:** each group's name (links to its page), tags (You're in it, Invite only), description, member avatars and count, who created it, and how many active ideas it's reviewing.
- **New group** goes through the settings page rather than a popup (New team works the same way, with an extra requirements step):
  1. **`/groups/new`, step 1, Name and access:** name (must be unique), description, and who can join (Anyone / Invite only). **Create and add members →** creates the group, with you as its first member and admin. Cancel goes back to Groups.
  2. **Its real settings, step 2, Members** (`?tab=members&setup=yes`): titled "Set up Sync reviewers", with a step guide above the tabs ("✓ Name and access → 2 Members", **Finish**). Only General and Members show while setting up, and the empty "Requests to join" section is skipped, so it opens on **Add people**. You can step back to Name and access, which is the General form.
  3. **Finish** opens the group's page. Afterwards the same settings page has no guide and shows all its tabs.
  - The group's id comes from its name and never collides with another group or with `/groups/new` (a group called "New" gets `new-2`).

### Site admin (`/admin`, site admins only)

Three tabs: **People**, **Deployment** and **Sign-in**.

- **Sign-in:** how everyone signs in.
  - **Email code or passkey** (the default), or **Your organization's single sign-on** with: protocol (SAML 2.0 or OIDC; the provider setup itself isn't prototyped), the button label ("Continue with Acme SSO"), allowed email domains, and **Create accounts automatically**.
  - Switching to single sign-on warns that every account is matched by primary email, that codes and passkeys stop working, and how many people have an email outside the allowed domains. Switching back says accounts stay as they are.
  - **Preview sign-up →** opens the sign-up page.

- **Deployment:** settings for the whole organization.
  - **External images in ideas:** Show after a click (default), Always show, or Never show, each with its privacy trade-off.
  - **Maximum image upload size:** 1–100 MB per image, default 10. A repo's cli config can go lower, never higher.
  - **🛡 Save for everyone** stays disabled until something changes and the size is valid.

- **People: Needs a new admin:** teams and groups whose admins are all inactive, each linking to its Members settings.
- **People:** everyone, searchable by name or @handle and filtered to Active / Inactive / Everyone, 25 per page. Each row shows their team and group counts, or when they became inactive and who did it.
- **Mark inactive** opens a confirmation listing what happens: read only, tokens and bots stop, marked everywhere, no notifications, history kept. It also shows the open ideas they wrote, the active ideas they're reviewing, and any team or group where they're the only active admin.
- **Reactivate** reverses it. You can't mark yourself inactive.

### Sign in / sign up (`/signup`, a preview)

A standalone page with no site navigation, under a bar that says it's a preview and changes nothing. It follows the Sign-in setting:

- **Built-in:** "Sign in or sign up": enter your email → **Email me a code** → enter the 6-digit code ("Send it again", "Use a different email").
  - An email with an account is offered **Add a passkey for this device?** (or **Skip for now**), then "Welcome back, Maya". **Sign in with a passkey** signs straight in, with no offer.
  - A new email goes to **Create your account**: name, and a handle suggested from the email with live checks (format, length, reserved words, taken: "@maya.ortiz is taken", "✓ @jamie.r is free"). Then **Add a passkey?** (or Skip for now), then "You're in".
  - This is the only place passkeys are added.
- **Single sign-on:** **Continue with Acme SSO**. The pretend provider signs you in as Jamie Rivera, who has no account:
  - With auto-create on: **Set up your account**, with name and email from the provider (read-only) and just the handle to confirm.
  - With it off: **No account yet**, ask a site admin to invite you.

### Settings (`/settings`)

- **Profile**
  - **Picture:** upload PNG, JPG, WebP or GIF up to 2 MB; change it or remove it. Without one, your initials are used.
  - **Display name.**
  - **Handle** (`@riley.park`): chosen at sign-up, shown read-only with what it's for (@mentions, the cli).
  - **Primary email:** what the account is tied to, read-only. It can't be changed from a signed-in session: whoever controls it controls the account, so a stolen session mustn't be able to move it (see Accounts and sign-in in `architecture.md`). Under single sign-on it's tagged "Managed by Acme SSO".
  - **How you'll appear:** a live preview, including "🤖 planbot on behalf of *your name*".
  - **Save or Discard.** Saving updates your name and picture everywhere in the prototype.
- **Sign-in** (`?tab=signin`)
  - **Built-in:** "Email code" says you can always sign in with a code to your primary email. **Passkeys** lists yours (name, when added, last used) with **Remove**. There's no "add" here: passkeys are only added at sign-in, right after an email code, so a stolen session can't give itself one.
  - **Single sign-on:** "You sign in with Acme SSO (SAML)", with email codes and passkeys off; your passkeys are kept for if it switches back.
- **Tokens** (`?tab=tokens`). Personal tokens never have site admin access, even for a site admin, and the page says so.
  - **List:** each token's name, purpose, visible prefix, how its activity shows, when it was last used, its expiry, and **Revoke** (with a confirmation).
  - **New token:**
    - **Fields:** name, purpose, a bot name for bot purposes (lowercase, numbers, dashes), and expiry: 30 days, 90 days or 1 year. Every token expires, and a year is the most allowed.
    - **Purposes,** matching `idea.md`: **Me**, **A bot working for me** and **A bot on its own**.
    - **Preview** of exactly how the token's activity will be labeled.
    - **After creating:** the token is shown **once**, with Copy and an example `ideaf` command.
  - **Site admin tokens** (site admins only) are a separate, called-out section. It starts by explaining what they can do (anything a site admin can, acting as you) and lists each token with its reason, last use and expiry.
    - **New site admin token:** needs a name and a reason (logged with every use), expires in 1, 7 or 30 days at most, and **Create** stays disabled until you tick "I understand anyone holding this token can act as a site admin, as me."
    - **After creating:** it's shown once, under "Treat this like a master key".
    - The example data has one: **Offboarding sync**.

## The data

**The story** (hand-written, on top):

- **People:** 12. Riley Park is you. Everyone's primary email is their handle at acme.dev (riley.park@acme.dev). Riley has two passkeys (MacBook Pro, iPhone).
- **Bots:** planbot (for Riley, and for Sam), typobot (for Devon), and archbot and secbot (automated).
- **Dogfood:** Ideation Factory's own plans. Riley is its admin (Maya is a maintainer; Sam and Devon are members). Its one idea, **"Ideation Factory MVP architecture"**, opens the real `mvp/` docs on the idea page (experiment 1 with `?idea=mvp`). There's an unread comment from Sam on it in the inbox.
- **Teams and their requirements:**

  | Team | Requirements |
  |---|---|
  | Dogfood | 1 approval in total |
  | Mobile | 1 approval in total, and one from Mobile leads (added as a reviewer automatically) |
  | Platform | 2 in total, and one from any of Platform reviewers or API reviewers |
  | Payments | 2 in total, one from Security champions, and all discussions resolved |
  | Data | 1 in total, and one from Data stewards (a deleted group) |
  | Design Systems | One from Design crit |
  | Security | One from each of Security champions and Platform reviewers (both added automatically), and all discussions resolved |
  | Dispatch | 2 in total |
  | Incident Response (locked) | 2 in total, and all discussions resolved |
  | Project Kite (locked) | 2 in total |
  | Board Prep (locked) | 1 in total |

- **Riley's roles:**
  - **Mobile:** maintainer (Maya is admin). Mobile is invite only, with 2 people waiting.
  - **Mobile leads:** admin, with 1 person waiting. Mobile's requirements use this group, so deleting it shows a real conflict.
  - **Platform:** member.
  - **Payments, Security, and the Platform reviewers and Security champions groups:** all invite only, and Riley isn't in them.
- **Riley:** a member of Mobile and Platform. Watches **Platform: All ideas** and **Payments: Active ideas** (watching without being a member).
- **Groups:** Platform reviewers, API reviewers (includes Riley), Mobile leads (Riley is an admin), Security champions and Design crit. Plus **Data stewards**, already deleted. Data's requirements still name it, so Data's ideas show "⚠ Requirements need fixing" from the start.
- **Locked teams:** Incident Response (Riley isn't in it), Project Kite (Riley is an admin with Sam) and Board Prep (members see only ideas they're on; Riley is a member). See Locked teams.
- **Ideas:** 29 in every state, including 2 approved, 4 closed accepted and 2 closed rejected.
- **Notifications:** 16, including an approval and two closings that reach Riley only through watch levels.
- **Tokens:** 3, one per purpose.

**Generated** (`src/scale.ts`, seeded):

- **People:** 3,000, with repeated names and unique handles.
- **Teams:** 240. Sizes range from 4 to 220, and about half have requirements built from their groups. Each has an admin (sometimes two) and a few maintainers. A quarter are invite only, some with pending requests.
- **Groups:** 600, mostly "<team> reviewers", guilds and champions.
- **Ideas:** 6,000. About two-thirds are closed, and open ideas skew recent.
- **Riley:** also joins 4 generated teams and 6 groups, and watches 2 more teams (one Active, one All).
- **Notifications:** about 420 for Riley over 30 days, from ideas Riley listens to. They include bots and bots acting for people.

## Design

The same tokens and themes as experiment 1:

- **Type:** Source Serif 4 headings, Inter for the interface, Literata for quoted text.
- **Color:** warm paper background, spruce-green accent, violet only for bots.
  - Approved and accepted use the "ok" green, and rejected the red.
  - Closed states use an outlined pill, so they read as finished.
- **Themes:** light, dark and high contrast.
- **Sizing:** `src/theme.css` holds the tokens and `src/site.css` the page styles. Both use `rem` and token spacing, with no pixel values.
- **No redundant labels:** a row leaves out what the page already says.
  - On a team's page, ideas have no team chip. On Your ideas, there's no chip, Private tag, author or author filter.
  - On Home's "Your open ideas", there's no author. On a group's page, the group isn't repeated among an idea's reviewers.
  - Your own name is never tagged "You". "You" only appears as a picker shortcut, and in phrases that carry meaning ("You're a reviewer", "You're in it").

## Code map (`experiments/experiment2/src`)

| File | What's in it |
|---|---|
| `main.tsx` | Routes (TanStack Router) |
| `Layout.tsx` | Sidebar navigation and quick search |
| `pages/` | Home, Notifications (Inbox, Following), Ideas, Teams, Team (with the requirements editor), Groups, Settings (Profile, Sign-in, Tokens), SignUp |
| `pages/Group.tsx` | The group page |
| `pages/Admin.tsx` | Site admin page: people, marking inactive, teams and groups that need a new admin; deployment settings; sign-in method |
| `pages/SignUp.tsx` | The sign-in / sign-up preview (email code, passkey, single sign-on, handle checks) |
| `pages/Team.tsx` | Team page, plus the Your ideas page and its move dialog |
| `pages/EntitySettings.tsx` | Team and group settings pages: General, Members, Approval requirements, Archive, Delete (with the conflict report), Delete permanently (site admins); the guided New group setup |
| `pages/members.tsx` | Membership button, role tags, member list |
| `pages/IdeaBrowser.tsx` | Open \| Closed lists and their filters, shared by Ideas and Team |
| `model.ts` | Rules: idea states (including archived), roles and permissions, watch levels, why you're listening, what's waiting on you, requirement evaluation (including deleted groups); account rules (handle checks and suggestions, email lookup) |
| `search.ts` | Includes search with closest-match ranking |
| `ui.tsx` | Avatars and avatar stacks, author labels, status pills, approval progress, watch-level picker, idea rows, idea state icons with tooltips, dialogs, pagination, type-ahead pickers (people, teams, groups), URL-param state |
| `store.tsx` | In-memory state (including ideas, so a team can be deleted) and actions |
| `data.ts` | Types, the hand-written story, and the merge with generated data |
| `scale.ts` | Seeded generator for data at a realistic scale |
| `theme.css`, `site.css` | Tokens and themes; site styles |
| `DevState.tsx` | Dev-only buttons: site admin switch, sign-up preview, state inspector |

## Known prototype shortcuts

- Search, filtering and pagination run in the browser over generated data. In the real thing they run on the server (D1 index and FTS5; see Scale in `architecture.md`).
- Only two ideas have a real page (in experiment 1): the offline-sync idea and the MVP architecture. The two prototypes don't share state.
- Sign-in is a preview: you're always Riley, codes aren't sent (any 6 digits work), passkeys are simulated, and the SAML / OIDC provider setup isn't prototyped.
- Notifications are static. Joining, watching, changing requirements or creating things doesn't generate new ones, and an old notification keeps the reason it had when it arrived.
- Approvals are canned. There's no way to approve, request changes or close an idea here (that belongs on the idea page), and states don't move automatically when requirements change.
- Ideas can't be created or moved out of draft here, so auto-added reviewers only happen when moving an idea out of Your ideas.
- Muting hides an idea's existing notifications. In the real thing it would also stop new ones.
- Uploaded pictures live in memory (object URLs) and are gone on reload.
- Per-token scopes aren't prototyped.

## Open questions

1. Should an idea move to **Approved** automatically when its requirements are met, or does the author move it? Should Approved then need an explicit close as accepted?
2. For an "each of" rule, can one person who is in two of the groups count for both? Right now they do.
3. Should "all discussions resolved" ignore threads that only bots took part in, or suggestions (which resolve when accepted or rejected)? Right now every open thread counts.
4. Should requirement changes apply to ideas already in review? Right now they do, straight away.
5. Does a new version reset earlier approvals (see the Reviews TODO in `architecture.md`)?
6. Should a locked team's reviewers who aren't members get access to just the ideas they're asked to review (as in Your ideas)? Right now they don't: the member list is the only access list, which keeps revoking simple.
7. Should site admins be able to read locked teams' ideas (break-glass, logged), for example for legal holds? Right now they can't.
8. Should "a bot on its own" tokens be owned by a team instead of a person, so they keep working when someone leaves?
9. Do tokens need scopes (read-only vs. comment vs. upload), or is purpose enough?
10. When a large group (50+ people) is asked to review, does everyone get notified, a rotating subset, or a digest? (Also in Scale in `architecture.md`.)
11. Should handles be changeable after sign-up (with old @mentions and links redirecting, as GitHub does)? Right now they can't be.
12. Under single sign-on, should site admins keep an email-code sign-in as a break-glass, and can a deployment mix single sign-on (employees) with email codes (outside collaborators)?
