# Architecture

## The document

The Ideation Factory only supports markdown files. Any enancements (say, rendering of mermaide diagrams) should be compatible with markdown generally sepeaking. A generic, bare bones, markdown viewer should be able to produce a resonable rendering of the document even though it may be a worse viewing experience (viewing a mermaide diagram as a code block rather then randered). Ideation Factory draws Mermaid with [Pele](https://github.com/obsidianmd/pele) (MIT, themed through CSS variables), keeps the source one click away, and shows the source with the error when a diagram can't be drawn.

## Media

Markdown can reference images and other files. The rule: **images are uploaded so they can be viewed; everything else resolves to the source.**

- **Images** referenced by synced markdown (`![alt](./img/flow.png)`, or an HTML `<img>`) are uploaded by the cli along with the markdown and become part of that version. Allowed types are PNG, JPEG, GIF, WebP and SVG (sanitized: no scripts or external references). There's a size limit per image, set per deployment (see Deployment settings; 10 MB by default). Only images the markdown references are uploaded, never whole folders. They're stored like other file contents: once per distinct content (by hash), so an unchanged image costs nothing in later versions.
- **Versioning:** an image is part of the version it was uploaded with. If an image's contents change while the markdown line stays the same, the version diff shows it as "Image changed", with before and after side by side.
- **Images that weren't uploaded** (too big, an unsupported type, outside the sync scope, or not found) render as a placeholder with the alt text, the reason, and a link to the file in the repository.
- **Everything else** (PDFs, video, archives, code, markdown that isn't part of the idea) is never uploaded. Relative links to it resolve to the repository on the code host (e.g. GitHub at the idea's branch), the same way code references do, and are marked with the file type ("PDF · GitHub"). If the source isn't a git repo with a known remote, the link says the file isn't available in Ideation Factory.
- **External images** (`https://…`) follow the deployment's setting (see Deployment settings): show after a click (the default, since hotlinking lets outside sites see who reads an idea), always show, or never show (link only). (Open question: add a fourth option that proxies and caches them?)

Open questions: should comments be able to anchor to an image (or a region of it)? Should very large images be resized on upload instead of skipped?

## Deployment settings

Some decisions belong to the organization running Ideation Factory, not to a team or a person. They're configuration on the deployment, changed by site admins on the site admin page (and settable at install time for self-hosted deployments), and they apply to everyone:

- **External images:** show after a click (default), always show, or never show.
- **Maximum image upload size:** default 10 MB, from 1 to 100 MB. The server tells the cli this limit; a repository's own cli config can set a lower limit but never a higher one.
- **Maximum Markdown file size:** default 256 KB, from 16 KB to 1 MB.
- **Maximum idea size** (all of an idea's Markdown together): default 2 MB, from 256 KB to 4 MB.

The two Markdown limits bound the work one change can cause: parsing and re-anchoring an idea at 4 MB takes a few seconds of CPU (see [scale concerns](mvp/scale-concerns.md) concern 4). An upload or batch that would leave a file or the idea over its limit is refused with an error naming the limit, before any parsing. The server tells the cli these limits, so `ideaf sync` checks them before uploading. Lowering a limit doesn't touch existing ideas: a change to an idea that's already over the new limit is accepted as long as it doesn't make it bigger.

More will join this list as decisions come up that need to be made once per organization.

## Versions

The document should be versioned (v1, v2 etc.) and the version history should support diffing between versions. The version system should support batch uptades. Mutiple files could be edited

Edits made with commands (see Editing with commands) land as one version per batch, with each command a step inside it. An uploaded copy is a single step.

### Base versions

Every uploaded file records its **base**: the hash of the content it was edited from, which is the content last uploaded or downloaded on that machine. Uploads are content-addressed, so the server can always find the base's exact content. That's what makes comment tracking exact (see Keeping comments anchored), and it stops one upload quietly undoing another.

- **Per file, not per idea:** a partial sync (`ideaf sync docs/`) can mix files with different parents. Each version also records its parent version, for history.
- **Base is the latest version of that file:** the normal case. Diff from the base and re-anchor comments.
- **Base is older than the latest version** (for example, v4 came from an accepted suggestion while you were editing v3): the upload is refused with "pull first". `ideaf pull` merges the newer version into your files (a 3-way merge with the base as the common parent), and then you sync again. `--force` overrides: the upload replaces the latest version, comments re-anchor from the latest version to the upload, and the newer changes show as undone in the history.
- **Base unknown** (no state on this machine, or the hash isn't in this idea's history): treated like an older base, so pull first or `--force`. A file that's new to the idea has no base and needs neither.

The cli keeps the bases in a per-idea state file (see Uploads in `cli.md`).

## Editing with commands

**This is the core of Ideation Factory and what sets it apart.** Instead of editing files locally and uploading a new copy, people and agents edit the idea in place with **commands**, then pull the result into the repository. Every command says exactly what it does: "move this section there", "rename this heading", "replace this sentence". So comments follow edits exactly, rather than being inferred from a diff afterwards. Uploading a new copy still works (see Keeping comments anchored under Comments), but commands are the main way to edit.

**One framework for everyone.** Editing in the web UI, agents editing through skills, the cli or the MCP server, and accepting a suggested edit all produce the same commands. They pass the same checks, land the same way, and have the same effect on comments. A suggested edit is a pending `replace` command, and accepting it applies the command.

**Reading:** a structured view of the idea lists each file's sections and blocks (paragraphs, list items, code blocks, tables), with a stable ID and the text of each, plus the open comments and what they're attached to (`ideaf show --blocks`, an MCP tool, and what the web UI uses underneath). IDs are kept across versions. Commands keep them by definition, uploads keep them by following positions through the diff, and a block that can't be followed gets a new ID.

**Commands**, and what each does to comments:

| Command | Effect on comments |
|---|---|
| `replace` {scope, old, new}: `old` must match **exactly once** in the scope (a block, section or file) | Comments on the replaced text now cover the new text, marked *changed*. Partly overlapping ones keep the untouched part |
| `insert` {before or after a block or section, markdown} | None |
| `delete` {block or section} | Comments on it become *outdated* |
| `move` {block or section, to a place, possibly in another file} | They move with it, even if a later command in the same batch edits it |
| `rename-heading` {section, title} | Section comments stay with the section |
| `set-section` {section, markdown}: rewrite a section's body | Section comments stay. Text comments follow `replace` rules where their text survives; the rest become *outdated* |
| `rename-file`, `create-file`, `delete-file` | They follow the file, or become *outdated* if it's deleted |

`replace` works like the find-and-replace edit tools agents already use well: if `old` matches zero or several times, the command fails rather than guessing.

**Batches:**

- Commands go in batches. A batch applies completely or not at all, and makes **one new version**, with each command a step inside it; the history can show the steps.
- A **dry run** shows the diff and what happens to each comment (moved, changed, outdated) before anything changes.
- A step can say which comments it addresses ("addresses c12"). Those threads then get an "addressed in v5" note, which closes the review loop for agents.
- The history notes how each version was made ("edited with commands" or "uploaded"), so reviewers know how exactly comments were placed.

**Concurrency, like a pull request.** A batch records the version it was built from. If the idea has moved on since, the batch is replayed onto the latest version: each command finds its target by ID and checks its expected text. If every command still applies, the batch lands, like a pull request that merges cleanly. If any command doesn't (its block is gone, or its expected text changed), the batch is refused with a conflict that names those commands, and the editor re-reads and tries again. Conflicting edits are never merged automatically.

**Who can edit:** the idea's author and bots acting for them (see Authorization). Reviewers propose changes as suggested edits, which the author accepts or rejects.

**Back into the repository:** when the editing is done, `ideaf pull` writes the new version into the files (merging any local edits, see Base versions), and you commit as usual. Ideation Factory is where the idea is worked on, not where it lives in the end.

**Uploading a new copy:** a person or agent can still edit locally and run `ideaf sync`. Comments then follow the re-anchoring rules (see Keeping comments anchored under Comments). An upload counts as a single inferred step, so unlike commands it can't follow a section that was moved and edited in the same upload.

## The source/target may not be a git repo

Git repos are the most likely source and target for developers, but this is not guarenteed to be the case. The design aims to natively support common workflows, but is not limited by them.

## Compairing against main

In addition to compairing against differnt versions, there is an need to compair against what is on the target branch. This could be useful fro a couple of reasons. 1) by default the folder view should just show the "updated documents" not all documents if the user uploads all md files. 2) the option to view what sections have been updated from main in a a single file. 

Since this app does not have access to the git repo, the "target branch" will need to be updated with the cli tool rather than relying on git integration.

So basically there are two ways to diff something 1) against previous versions and 2) what is at the target.

TODO: architect in a way that does not rely on a users git repo, but doesn't have any files storage problems. The source may not even be a git repo.

## Mutiple files

An idea could be one md file or a group of md files. It could start as one file and grow to be more. If its just one file, a directory view is not needed. but as soon as more than one file gets added, a folder view is needed. github does a good job of handling this at scale in PRs. The cli tool will allow for users to upload all of their md files, which could be sparse and deeply nested. The md files could live next to code, which is not visible here.

## Comments

Comments are extreemly impotaint to get right as this is the primary way for agnents and humans to provide feedback on a doecument. A comment could be for a file, a section or a highlighted selection of words. As best as possible comments need to track document restruturing (say, moving a section to a different location in the file) as well as file renames. Some of this can be tracked by Ideation Factory, but others like file renames, may need the upload CLI tool to indicate that a file has been renamed to support tracking changes. A comment whose text (or section) can't be found in the latest version is **outdated**. It stays with its file, listed separately, and links to the last version where its text existed, so readers can see what it was about. In the comments feed it appears with that context and a "View in v3" link. There's no re-attaching a comment to new text; reply, or resolve it.

### Keeping comments anchored

The goal is that comments survive edits: text moving around (within a file or to another file of the idea), headings being renamed, and text that appears in more than one place. Edits made with commands move comments by rule (see Editing with commands); this section is about uploaded copies, where comments have to be followed through a diff. Some edits can't be tracked, and the rule is to **never move a comment to a place we're not sure of**. Uncertain comments become outdated rather than landing on the wrong text.

**Anchors are on the Markdown source, compared as plain text.** Matching uses a plain-text form of the source: Markdown syntax stripped, whitespace and line breaks collapsed, with a map back to source positions. That way re-wrapping a paragraph or adding bold doesn't disturb comments. The idea page maps source positions to the rendered text.

**What an anchor stores**, for the version it's on:

| | Used for |
|---|---|
| File (by id, not path) | File renames |
| Position: start and end in that version's plain text | Following the text through diffs |
| Quote, plus some text before and after | Showing what was commented on, and checking matches |
| Section: id, and the heading path at the time (`Proposal › Conflicts`) | Section comments, and showing where the comment was |
| Block hash (the normalized paragraph, list item or code block) | Recognizing a block that moved unchanged |

**Re-anchoring** happens once, when a version is created (in the idea's actor), not every time someone reads the page. It goes from each file's base to the new content, one version at a time, never from v1 straight to v5. Each version keeps its own anchors, so viewing an older version shows comments where they were then. In order:

1. **Follow positions through the diff.** Text that didn't change maps exactly, so duplicated text is no problem: the comment follows its own copy, not the first match. If part of the commented text was edited, the comment keeps the part that survived and is marked *changed*.
2. **Blocks that moved unchanged.** A deleted block whose hash matches exactly one inserted block, in this file or another file of the idea, carries its comments along, marked *moved*. If it matches several (the block was duplicated), nothing is guessed: the comment becomes *outdated*.
3. **Headings renamed in place.** If a heading line changed but kept its place and level, and the section's body is unchanged in the diff, it's the same section, and section comments stay with it.
4. **Anything else becomes outdated.** That includes a section moved and edited in the same upload; editing with commands keeps those trackable.

There is **no fuzzy matching**, so no searching for similar text to place a comment. TODO (future): a fuzzy fallback (searching the old section, then the file, then the idea for the quote and its context), only after we can measure it on real edit histories. It should prefer *outdated* over a confident wrong guess.

**Anchor states**, each shown on the comment:

| State | Meaning | Shown as |
|---|---|---|
| Exact | Followed through the diff, text unchanged | Normal |
| Moved | Its block moved unchanged | A "moved" note |
| Changed | Some of the commented text was edited | The original quote next to the current text |
| Outdated | Its text or section isn't in the latest version, or can't be placed with certainty | Listed under Outdated for its file, with the original quote and **View in v3**: the last version where it was. The same in the comments feed |

Known limits: text rewritten in place makes its comment outdated (as GitHub marks review comments "outdated"); a sentence split into two places keeps the larger part; a heading renamed and its body edited in the same upload makes its section comments outdated (with commands, they'd follow).

Comments can have a status associated with them. Currenly only "resolved" and "unresolved" are planned, but more could be added.

Comments can have replies associated with them to start conversations.

## Suggested edits

Suggested edits are required for 1.0. A reviewer (human or agent) can propose a concrete change to a highlighted selection or section instead of only describing it in a comment. A suggestion is a comment with a proposed replacement attached, so it uses the same anchoring, replies, status and bot/user attribution as any other comment.

Only the idea's creator (or bot credentials associated with the idea) can accept a suggestion. Accepting a suggestion applies its `replace` command (see Editing with commands), which creates a new version in Ideation Factory; `ideaf pull` brings it into the source. Reviewers propose, the author decides, and the repository (or wherever the idea ends up) stays the final home.

If a suggestion's text isn't in a newer version, it's outdated like any comment, and can no longer be accepted.

TODO: apply changes batching. The author should be able to accept several suggestions (across files) at once. That's one batch (see Editing with commands): one new version, with each suggestion its own step, so every suggestion's comment follows its new wording. Two suggestions on overlapping text conflict: the second one's expected text is gone, so it stays open. Open question: should rejecting be batched the same way, or stay immediate?

## Reviews

Ideas move through the states defined in `idea.md`: draft, requesting review, changes in progress and approved while open, then closed accepted or closed rejected.

TODO: review verdicts. A reviewer can finish a review with **Approve**, **Request changes** or **Reject**, from any account: a user, a bot associated with a user, or a bot. Verdicts carry the same attribution as comments (`[bot emoji] <bot> on behalf of <user>`), so an automated approval is never mistaken for a person's. A verdict applies to a specific version, and the idea shows each reviewer's latest verdict and which version it was for. Open questions: does a new version reset earlier approvals? Does "Request changes" move the idea to "changes in progress"? Does a reviewer's "Reject" close the idea as rejected, or is closing always the author's call? Can a bot's approval count toward a team's approval requirements, or only a person's?

TODO: approval requirements. Each team sets requirements (see Team support in `idea.md`): a minimum number of approvals (0 = none), group rules that are either "any of" (or) or "each of" (and) a list of groups, and optionally "all discussions resolved". A group rule can auto-add its groups as reviewers when an idea goes out for review (created out of draft, moved out of draft, or moved into the team while in review); this happens in the idea's actor on that state change, skips deleted groups and groups already reviewing, and doesn't touch ideas already in review when the setting is turned on. An idea is approved once all of its team's requirements are met, with approvals on the current version and no open comment threads when that check is on. Requirements name groups rather than people, so they keep working as people join and leave groups. Open questions: does meeting the requirements move an idea to approved automatically, or does the author do it? Does approved still need an explicit close as accepted? For an "each of" rule, can one person who is in two of the groups count for both? Does "all discussions resolved" count resolved-but-reopened threads, and should it ignore bot-only threads? Locked teams can't use group rules (see Groups). Only a team's maintainers and admins can change its requirements. Open question: should changes apply to ideas already in review (they do in the prototype)?

TODO: review comment batching. A reviewer can start a review and leave comments, replies and suggested edits as pending: visible only to them, and editable or deletable until submitted. Submitting publishes them all at once, optionally with a verdict and a summary comment, so the author gets one review instead of a stream of notifications. This matters for agents too: a bot reviewing a whole idea should submit one review, not dozens of separate comments. Open questions: are pending comments saved server side (so a review can continue on another machine or be finished by the cli) or kept locally? What happens to pending comments if a new version is uploaded before the review is submitted?

## Future consisterations

### File creation

With the sparse/nested directroy problem in mind, users should also be able to create new md files in this software that can be synced back to the destination. Detions as well. 

### OIDC for all admin actions (future requirement)

Every site admin action (permanently deleting a team, marking people inactive, changing a team or group you have no role in, creating site admin tokens) should require an OIDC-authenticated identity: a recent single sign-on login for people (step-up authentication if the session is older than a few minutes), and OIDC-federated credentials for automation. Once that's in place, long-lived site admin tokens should be replaced by short-lived credentials issued through OIDC. Until then, site admin tokens are separate, need a reason, last at most 30 days and are logged on every use.

### File editing

Editing in Ideation Factory is done with commands (see Editing with commands). The web UI offers the same operations agents use (replace text, move a section, rename a heading, and so on), as one framework. What stays out of scope is free-form, live, multi-person editing (Google Docs style): only the author and their bots edit, a batch at a time, and concurrent batches merge like pull requests or conflict.
## Accounts and sign-in

An account has three parts:

- **Name:** a display name, shown on ideas, comments and reviews, and on bots acting for the person. Not unique, and the person can change it any time.
- **Handle:** chosen at sign-up. It's unique, 2–39 characters (lowercase letters, numbers, and `.` `-` `_` in the middle), and some words are reserved (`admin`, `settings`, `api`, …). It's how people @mention each other and how the cli shows people. For now it can't be changed afterwards (see open questions).
- **Primary email:** what the account ultimately is. Sign-in codes go to it, identity providers match on it, and no two accounts share one. **It can't be changed in the built-in flow.** With no passwords, whoever controls the primary email controls the account. If a signed-in session could change it, someone with a stolen session (a leaked cookie, an unlocked laptop) could move the account to their own address and lock the owner out for good.
  - TODO: design changing the primary email. It needs more security thinking than "confirm the new address with a code". Options include:
    - proving control of the current email and a passkey (not just the session);
    - notifying the old address with a way to cancel;
    - a delay before it takes effect;
    - a site admin path for people who've lost access to their old address.
  - Under single sign-on the provider owns the email, so it changes there.

**Built-in sign-in (the default):**

- **Email code:** enter your email and get a 6-digit, single-use code that expires after 10 minutes. Requests are rate-limited per address and per IP. If no account has that email, entering the code continues into sign-up: pick a name and a handle. Either way, the person is then offered a passkey (see below).
- **Passkeys (WebAuthn):** people can have several (laptop, phone, security key) and see and remove them in Settings. **A passkey can only be added at sign-in,** right after an email code: "Add a passkey for this device?", which can be skipped. Settings has no "add passkey", so a stolen session can't give itself a passkey that outlives it. Signing in with a passkey doesn't prompt. Sign-in offers a passkey straight away (the email field uses `autocomplete="email webauthn"`), and an email code always works as the fallback, so losing every passkey doesn't lock anyone out.
- There are no passwords.

**Organization single sign-on (an alternative provider):** a site admin can switch the deployment to the organization's identity provider, using SAML 2.0 or OIDC (Site admin → Sign-in).

- People sign in with "Continue with <provider>". The provider vouches for a name and a verified email, and **the account is matched on primary email**, so switching an existing deployment keeps everyone's ideas, comments and tokens.
- **Allowed email domains:** only these domains can sign in. Before saving, the switch warns how many existing people have an email outside them.
- **Create accounts automatically** (just-in-time provisioning, optional): someone the provider signs in who has no account gets one. Their name and email come from the provider, and a handle is suggested from the email for them to confirm on first visit. With it off, a site admin has to invite people first.
- While single sign-on is on, email codes and passkeys are turned off, and the primary email is managed by the provider. Passkeys are kept, and work again if the deployment switches back.
- TODO: deprovisioning. Removing someone in the identity provider stops them signing in, but their account isn't marked inactive (see Inactive users in `idea.md`) until a site admin does it. SCIM could do this automatically, and could keep names and emails in sync.
- This is the natural place for the "OIDC for all admin actions" future requirement: with an identity provider in place, site admin actions can require a recent sign-in (step-up).

Tokens for the cli and agents are separate from sign-in, and work the same way under either provider (see Bots vs humans in `idea.md`).

Open questions: should handles be changeable (GitHub allows it, and redirects old @mentions and links), and how often? With single sign-on, should site admins keep an email-code break-glass sign-in in case the provider is down or misconfigured? Should a deployment be able to allow both (single sign-on for employees, email codes for outside collaborators)?

## Authorization

Everyone who has an account can view all ideas, with two exceptions: ideas in someone else's **Your ideas** (only the owner and the people they ask to review can see them), and ideas in a **locked team** (only its current members can see them, and if the team limits members to the ideas they're on, plain members only see ideas they wrote or are asked to review while admins and maintainers see all; see Team support in `idea.md`). This applies to inactive users too (who are read only; see Inactive users in `idea.md`). A token belonging to an inactive user, or a bot token acting on their behalf, is rejected on every write. Personal tokens are checked against the user's own team and group roles only; site admin powers are never available through them. Site admin actions need a site admin session or a site admin token (separate, short-lived, reason required), and every site admin action is logged as one.

**Checking who's calling.** Sessions and personal tokens are long-lived and live in the directory (see Storage). Requests carry a **15-minute signed access token** instead, checked by its signature alone. It holds who the caller is and the token's purpose, never roles or memberships, so authorization always uses current data. Long-lived credentials are only checked when a short-lived token is issued or refreshed (the browser through its session, the cli by exchanging its personal token). So **revocation takes effect within 15 minutes:** revoking a token, signing out a session, or marking someone inactive stops new short-lived tokens at once, and existing ones expire within 15 minutes. That includes site admin tokens. **Writes don't wait:** a write (comment, edit, review, upload, settings) checks the caller's current status, so an inactive user's writes are refused at once. Writes are far rarer than reads, so that check is affordable. In an emergency, rotating the signing key ends every outstanding token. MCP clients get the same signed tokens through OAuth (Better Auth is the candidate; see Auth and access in `mvp/architecture-backend.md`).

Visibility is checked on every read, not just in lists: idea pages, search results, counts, the API, MCP and the cli. Notification fan-out and the inbox filter on it too, so removing someone from a locked team hides their existing notifications and stops new ones, with no cleanup job. Because access comes from team membership (and, for teams that limit members to their own ideas, from an idea's author and reviewers), membership, role and reviewer changes must invalidate any cached visibility (the directory's search index stores each idea's team, and queries join against the caller's memberships). Content-addressed media in the bucket is served only through a visibility check on an idea that references it, never by hash alone.

TODO: explore OIDC for agentic use cases. Agents and CI jobs currently authenticate with tokens a person creates and stores as a secret. With OIDC (workload identity federation), an agent's platform (for example a CI provider or a cloud runtime) would present a short-lived, signed identity token, and Ideation Factory would exchange it for a short-lived ideaf credential, so there are no long-lived secrets to leak or rotate. Open questions: which issuers to trust, and how an issuer's claims (repository, workflow, environment) map to the three token purposes ("me", "bot associated with me", "bot") so attribution still reads "[bot emoji] <bot> on behalf of <user>"; whether a person can delegate to an agent this way (token exchange) rather than only automated bots; and how this works for self-hosted deployments with their own identity provider. Only the creator (or bot credentials assoiciated with an idea) of an idea can edit the files associated with an idea. Having finer, document based acess control is a future consideratiaon.

# Groups

A user should be able to make groups to associate mutiple

Groups are also the building blocks of team approval requirements (see Reviews). Changing a group's members therefore changes what every team using that group requires.

Private teams (locked teams and Your ideas) don't support groups at all: no group reviewers and no group rules in approval requirements, only people, a minimum number of approvals and (optionally) resolved discussions. A group's members don't line up with who can see a private team's ideas, so allowing them would mean either leaking ideas to the group or sending review requests people can't open. A team can't be locked while its requirements use groups (they have to be changed first, since dropping them silently would loosen approval), and locking removes any group review requests on its open ideas.

Groups have admins and maintainers, like teams (see Team support in `idea.md`). Each group has its own page (name, description, members with roles, and where it's used: team requirements and ideas it reviews) and a separate settings page for its admins and maintainers.

Only a group's admins (or a site admin) can delete it. Before deleting, the settings page shows what would break: teams whose approval requirements name the group (and how many active ideas that blocks), open ideas where it's a reviewer, and its members. A deleted group is kept as a record rather than removed, so anything still pointing at it can say so:

- Approvals from a deleted group's members no longer count toward any requirement that names the group.
- A requirement only breaks if the deletion makes it impossible to meet: an "each of" rule where any of its groups is deleted, or an "any of" rule where all of them are deleted (with one group, either breaks when it's deleted). A broken requirement shows an error on the team page, on every active idea in the team ("Requirements need fixing"), and on the home page of the team's maintainers and admins. Ideas in that team can't be approved until a maintainer or admin of the team replaces or removes the group.
- "One person from any of several groups" with other groups left keeps working through them. It shows a warning (not an error) so a maintainer can tidy it up.
- The delete report separates the two cases: requirements that will break (and how many active ideas that blocks) and requirements that keep working through other groups.
- An idea that had the group as a reviewer shows it as a deleted reviewer.

# Emails/messageing

All notifications are in app for now. What a user is notified about follows the watch levels under Team support in `idea.md`: ideas they participate in or are assigned to by default, plus a team's active ideas (including when they close) or all of its ideas if they choose. Each notification should say why the user received it.

The inbox works like GitHub's: one entry per idea (its latest update, how many are new, and why you're subscribed), not one per event. It can be grouped by date or by team, filtered by reason (review requested, participating, watching a team) and by team, and each idea can be marked read, marked **Done** (cleared from the inbox until something new happens) or **unsubscribed**. Every idea page has a Subscribe / Unsubscribe button that says why you're subscribed. Unsubscribing stops notifications for that idea, except when someone asks you to review it.

# Scale

The open performance risks, with severity, mitigations and a load-test plan, are tracked in `mvp/scale-concerns.md`.

The site has to work for thousands of people. Design for roughly 10,000 people, 1,000 teams, 2,000 groups and 100,000 ideas accumulated over a few years, with a busy reviewer getting a few hundred notifications a month. Bots can produce far more activity than people, so they set the peak load. Experiment 2 generates data at about a third of this size to keep the UI honest.

## Interface rules

- **Nothing loads everything.** Every list (ideas, teams, groups, members, notifications, followed ideas) is filtered, sorted and paginated on the server, 25 at a time, using cursor-based pagination. The web app, the cli and the MCP server all use the same cursors.
- **Pick from large sets by type-ahead, never a full dropdown.** People, teams and groups are chosen by searching, and results are capped (about 8). Common choices like "You" or "Your teams" are offered before typing.
- **Display names are not unique.** Every person has a unique `@handle`. Anywhere people are chosen or could be confused, show the handle (and a team for context).
- **Summaries, not full membership.** Lists show a few avatars and a count. Full member lists are searchable and paged.
- **Notifications are bundled per idea.** One row per idea with its latest update and "+N more from …", so a busy idea doesn't bury everything else. The unread badge caps at 99+. Inboxes can be filtered by why you got them (involved vs. watching a team).
- **Default views are scoped to you.** Home shows a capped list of what's waiting on you and your open ideas, each linking to the full, filtered list.

## Storage (self-hosted: Rivet actors and a bucket)

Everything runs on ordinary infrastructure: app nodes (Bun) hosting [Rivet](https://github.com/rivet-dev/rivet) actors, the Rivet Engine (which schedules, routes and persists actors), and one S3-compatible bucket. There's no database server. See Self-hosting in `mvp/architecture-backend.md`.

- **One actor per idea** holds its versions, comments, suggestions and reviews, in its own SQLite. All writes to an idea go through the actor's queue, so concurrent comments, accepted suggestions and approvals are applied one at a time without locking (reads run in parallel). It also pushes live updates to people viewing the idea.
- **File contents live in the bucket, keyed by a hash of their content.** Most files don't change between versions, so each distinct file is stored once and a version is a small manifest of paths → hashes. This answers the storage TODO under "Compairing against main": no git repo is needed, and storage grows with changes, not with versions × files. The target-branch snapshot the cli uploads is stored the same way.
- **Directory and index data live in the directory actor** (one actor, its own SQLite): users, teams, groups, memberships, watch levels, sessions and tokens, and an index row per idea (title, team, author, status, reviewers, updated time). The idea's actor updates its index row after changes (coalesced). Lists and filters query this index, never the idea actors.
- **Search** uses SQLite FTS5 with the trigram tokenizer in the directory actor. That keeps the "includes" behavior (a match anywhere in a word) but backed by an index. The closest-match ranking (field, then closeness, then position) is applied to the top candidates the index returns.
- **Durability:** the Rivet Engine acknowledges a write once a majority of engine instances have it on disk, then moves it to the bucket. With one instance (a single-VM deployment), the newest writes live only on that VM's disk until they reach the bucket, about a minute with default settings. Bucket-only storage needs Rivet 3.0, in preview as of October 2026 (see `mvp/spike-rivet.md`).

## The directory actor is the one shared owner

Idea actors are many and spread across nodes. The directory actor is one, so everything shared goes through it, with its writes applied one at a time, on whichever node hosts it.

- **Calls hop to it:** most requests land on a node that isn't hosting it, so the call crosses the private network.
- **It's a concentration point:** every list, search, inbox and directory query, plus every index update and notification written by idea actors. Indexed reads are cheap, so throughput isn't the expected limit at the scale above. The risk is availability: if its node fails, everything shared waits until the engine moves it (up to about a minute).
- **Mitigations:**
  1. 15-minute signed access tokens, so checking who's calling never calls the directory;
  2. keeping anything about one idea in its actor, never in the directory;
  3. coalescing index updates and batching inbox writes;
  4. measuring it in the Rivet spike, then the load test;
  5. only if needed: splitting it into an actor per person (inbox, watch settings) and per team (members, the team's idea list), leaving search and type-ahead in the directory actor.
- **Postgres as an escape hatch:** everything stays in Rivet by default, but the directory sits behind one interface so a customer can swap it for Postgres. The MVP keeps that cheap: SQL that works in both, search behind its own interface, and writes that stay correct when they run concurrently (constraints and transactions, not queue order).

The full list of open performance risks is in `mvp/scale-concerns.md`.

## Notification fan-out

- **Direct participants get notifications written to their inbox when the event happens.** These are the author, reviewers, members of reviewer groups and people following the idea, usually a few dozen at most.
- **Team watchers are not fanned out per event.** A team with hundreds of watchers would turn every comment into hundreds of writes. Events go to the team's activity log, and a watcher's inbox merges in the teams they watch (at their level) when it's read. Unread counts for watched teams are kept per team, not per event.
- **Bundling happens at read time** (per idea), so the stored events stay simple.

## Permanent deletion

Permanently deleting a team (site admins only) erases its index rows in the directory, the actor of every idea in it, the notifications that point at those ideas, and watch settings for the team. File contents in the bucket are shared between versions, and possibly between ideas, because they're stored once per distinct content. So deletion removes the manifests first and only deletes a file once nothing else refers to it (reference counting, or a periodic sweep). The delete is logged (who, when, what) without keeping the content.

## Limits

- Every token is rate-limited, bot tokens more tightly than people's, and each idea has a cap on comments per minute. Review comment batching (see Reviews) is the normal way for a bot to post many comments: one submission, one notification.
- Approval requirements are evaluated by the idea's actor when an approval arrives. Changing a group's membership doesn't re-evaluate every idea at once; affected open ideas are re-checked in the background.

## Open questions

- What should happen when a large group (say 50+ people) is asked to review? Notify everyone, notify a rotating subset, or send a digest?
- How long do closed ideas stay in the default search results? They could stay searchable but drop out of default lists after a while.
- Can very large counts be approximate (e.g. "about 4,000 closed ideas") to keep list queries cheap?
