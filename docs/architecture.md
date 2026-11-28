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

**One framework for everyone.** Editing in the web UI, agents editing through skills, the cli or the MCP server, and accepting a suggested edit all produce the same commands. They pass the same checks, land the same way, and have the same effect on comments. A suggested edit is a pending `replace` command, and accepting it adds the command to the idea's draft, where committing applies it.

**Reading:** a structured view of the idea lists each file's sections and blocks (paragraphs, list items, code blocks, tables), with a stable ID and the text of each, plus the open comments and what they're attached to (`ideaf show --blocks`, an MCP tool, and what the web UI uses underneath). IDs are kept across versions. Commands keep them by definition, uploads keep them by following positions through the diff, and a block that can't be followed gets a new ID.

**Commands**, and what each does to comments:

| Command | Effect on comments |
|---|---|
| `replace` {scope, old, new}: `old` must match **exactly once** in the scope (a block, section or file) | Comments on the replaced text now cover the new text, marked *changed*. Partly overlapping ones keep the untouched part |
| `insert` {before or after a block or section, markdown} | None |
| `delete` {block or section} | Comments on it become *outdated* |
| `move` {block or section, to a place, possibly in another file} | They move with it, even if a later command in the same batch edits it |
| `move-text` {block, old, to just before or after some text in a block}: some of a block's text, possibly to another file | Comments on the moved text move with it, marked *moved*. Partly overlapping ones keep the part that stayed |
| `rename-heading` {section, title, and optionally a level}: a new level re-nests its section | Section comments stay with the section; a comment on the title's words stays on them |
| `set-section` {section, markdown}: rewrite a section's body | Section comments stay. Text comments follow `replace` rules where their text survives; the rest become *outdated* |
| `rename-file`, `create-file`, `delete-file` | They follow the file, or become *outdated* if it's deleted |

`replace` works like the find-and-replace edit tools agents already use well: if `old` matches zero or several times, the command fails rather than guessing.

**Batches:**

- Commands go in batches. A batch applies completely or not at all, and makes **one new version**, with each command a step inside it; the history can show the steps.
- A **dry run** shows the diff and what happens to each comment (moved, changed, outdated) before anything changes.
- A step can say which comments it addresses ("addresses c12"). Those threads then get an "addressed in v5" note, which closes the review loop for agents.
- The history notes how each version was made ("edited with commands" or "uploaded"), so reviewers know how exactly comments were placed.

**Concurrency, like a pull request.** A batch records the version it was built from. If the idea has moved on since, the batch is replayed onto the latest version: each command finds its target by ID and checks its expected text. If every command still applies, the batch lands, like a pull request that merges cleanly. If any command doesn't (its block is gone, or its expected text changed), the batch is refused with a conflict that names those commands, and the editor re-reads and tries again. Conflicting edits are never merged automatically.

**Who can edit:** the idea's owner and anyone with edit access, and bots acting for them (see Authorization). Reviewers propose changes as suggested edits, which someone with edit access accepts or rejects.

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

**Built:** the web app's Files list is a tree (ui's `FileTree`), on the idea's page and its overview. Folders come above files, each by name; a folder holding only another folder shares its row with it (`packages/server/docs`), as VS Code's Explorer does; each row has an icon (a folder, open or closed, a page, a picture); and a closed folder shows the open comments and changes inside it. While the draft is open, the tree is its files (new, renamed and deleted ones too), and what it does to a file is its name's color; until then, the version's files, unmarked: new green, changed amber (a closed folder too, for something made, changed or deleted inside), deleted struck through; a rename alone isn't marked, as committing lists it, and renamed and changed is changed. The name's tooltip says it in words, and so does hidden text for a screen reader; the focus view's Pages list marks its paths the same way. Folders start open, the one holding the file being read always is, and which are closed is kept in the browser, per idea. A folder exists only while a file is in it, as in git. Rows don't assume Markdown, so an idea's images will show in it too.

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

## Drafts

Each idea has **one draft**, shared by everyone with edit access: changes on the latest version, collected until someone commits them as one new version. People type in it in the web app, together, as in Google Docs; agents and the cli add changes to it (a block's new source, new text, a deletion); and accepting a suggestion adds it, which is the only way to accept one. Everyone editing sees the same draft, as it's typed, with who made each change.

- **Typed live:** what's typed goes to the idea's actor as the page editor's own steps (ProseMirror's collab module), over the draft's socket (`/api/ideas/{idea}/draft/live`, for people with edit access only). The actor takes steps made on the latest count of the file's steps, stores them, then sends them to everyone editing the file: "Saved" means stored. An editor that's behind takes what it missed and replays its own on top, so typing merges letter by letter; two people at the very same spot keep their words whole. The actor keeps the last 2,000 steps or 10 minutes of each file, whichever is more, for an editor coming back to catch up; one away longer is compared with the draft paragraph by paragraph: what only it changed goes in (each change sent with the block as it read, so the server refuses one someone else changed meanwhile), the file opens again, and the changes someone else also made wait on the page, "Some of what you typed needs a look" with "Review 2 changes", which shows yours and the draft's side by side to keep one. There's no full offline mode. Both are settings (`limits.draft.keep_steps`, `keep_minutes`), as is how often a file is stored whole (`snapshot_every`).
- **Who's in it:** each browser window editing the draft is one entity, the same person's second window too: its face in the bar, ringed in a color it keeps while it stays (the eight avatar colors, given out as windows arrive), and its caret and selection in that color in everyone else's page, with its name on a flag always shown in the space between the lines. Choosing a face goes to where that person is, in whichever file. Windows send their caret, on the actor's count of steps, at most every 80 ms (`limits.draft.caret_ms`), and the others map it to their own document. It's kept in the actor's memory only, never stored: if the actor moves to another node, each window comes back and joins again, and a window not heard from in 30 seconds is gone. Offline, the others' faces and carets go until you're back.
- **A limit of windows:** past `limits.draft.editors` (20 by default) a window opens the draft read-only, still live, and can type once someone leaves. Every keystroke and caret goes to everyone in the draft through the idea's one actor, so the work grows with the square of the windows; the draft crowd load test (`packages/load`) measures what a machine takes. Twenty windows all typing at once hold on a laptop and on 4-vCPU cloud nodes; forty hold on the cloud nodes only with a Rivet fix not yet released, and start to fail on the laptop. [The draft editor limit](draft-editor-limit.md) has the numbers, what limits one draft, and what would raise it.
- **Changes are checked as they're added:** an agent's or the cli's edit or deletion, and the editor's Markdown side, carry the block as it read when the change was made. If it reads differently now (someone else changed it, in the draft or in a newer version), the change is refused as outdated. Nothing is merged by guessing. A change that lands moves the documents by steps that leave every other block as it is, so someone typing elsewhere carries on.
- **Files made, renamed and deleted** are draft changes too (`create-file`, `rename-file`, `delete-file`), landing with the text as one version. A new file takes its ID from the idea's actor as it's made, and keeps it when committed: the idea's `draft_next_id` makes every version's IDs start after it, so nothing else is given the number. Its text is in its document, which starts empty, like any file's. Files made go first in the draft, so typing can be in them; renames and deletes go last, so a file deleted keeps what was typed in it, and is restored with it by undoing its delete (it can't be typed in meanwhile). Renaming a file again is one rename from its path in the latest version, renaming it back leaves none, and undoing a rename is renaming it back. **Every rename fixes links**, whoever sends it (the web app, the cli, an agent through MCP, a batch's `rename-file` too): the actor works out, from the links as they are, the relative links to the file in the other files, and the file's own if its folder changes (images and link definitions too, the address only), and adds them as edits after the caller's own; a block the caller changed, or a file it deletes, is left as the caller has it (core's `linkFixes`). A folder renamed or deleted is a rename or delete of each of its files, made together. A version made elsewhere that takes a new file's path, renames a file the draft renames, or changes a file the draft deletes is refused as `draft_outdated`; one that only changes a file the draft renames goes in, as nothing of either is lost. A file's address is its path, so `find_file` finds a path no file has now in earlier versions, and the web app goes where that file is. In the web app, the Files list is a tree (see Mutiple files) with + and each row's ⋯ (a delete asks first, saying which comments it outdates, which links it leaves pointing at nothing and who's typing in it), a file deleted shows read-only with who deleted it and Restore, the address follows the file shown when it's renamed, and an older version's file the latest doesn't have can be brought back into the draft (Restore this file); `ideaf sync` sends files added, moved and removed into the draft, and `ideaf pull` writes the draft's.
- **Restore points:** the draft as it was, kept so a bad edit or a discard can be taken back before any version exists. One is taken at a break, never two of the same draft: once nobody has changed it for 5 minutes (`limits.draft.restore_quiet_minutes`); a minute after someone who typed in it leaves it (their last window closed or gone quiet, so a reload isn't leaving); before an agent changes it, unless it was the last to; and before a discard, a version forced over it, or a restore. The quiet one is an actor alarm, at most one at a time, set by the first change after it went: typing never waits on a restore point. One taken before something takes over the reason of a quiet one of the same draft. Each is the draft's changes, with who changed each block, so restoring puts them back on the latest version, whichever it is: a change a version made since has outdated comes back held, to undo or redo. Each is labelled when it's taken, against the one before: who made the changes new since, the first of them and how many more, and how many it no longer has; the web app and the cli list them by that (only one taken before something gives a reason). They're kept, across versions, until together they pass `limits.draft.restore_keep_mb` (50 MB): then the oldest are dropped, leaving their labels marked no longer kept (500 at most). The idea's owner, or someone who made one of its changes, can delete one, label and all, for something pasted by mistake. In the web app they're **earlier drafts**, never "restore points": listed in the Versions tab under the draft while it's open, the latest three and Show more; opening one shows it in the page, read-only, marked against the draft now (underlined comes back, struck through goes), built by the same code as restoring; restoring ("Restore for everyone") and deleting ask first (`list_restore_points`, `get_restore_point`, `restore_draft`, `delete_restore_point`, live as `restorePoints`; `ideaf draft restore`, `ideaf draft forget`).
- **An agent's edit is marked:** the steps a change makes go to editors with who made them, and where an agent made them, the words it put in are underlined in violet dots with its name on a flag above them, for 3 seconds and then a second's fade, so the page changing doesn't read as a jump. Pointing at them starts the 3 seconds again; the clock stops while the window is in the background. What the agent took out isn't shown: the draft's changes have it.
- **IDs come from the actor:** a new block (or the second half of one split in two) takes the ID committing would give it, from the actor, as an attribute nobody's typing touches; the browser never makes one.
- **Words moved stay moved:** the editor notes words it sees cut from one paragraph and pasted into another, and sends the note with its typing; while the documents still read that way, the draft counts them as a move, so the comments on them go with them.
- **Always on the latest version:** a version made elsewhere (an agent's batch, an upload) is what the draft is then built on, and blocks the draft hasn't changed take its words at once, in everyone's editor.
- **Overwriting the draft is a force push:** a version that changes blocks the draft has also changed is refused (`draft_outdated`, naming the draft's changes). The normal way through is to resolve the difference against the draft on your own machine and send it as changes to the draft, on top of everyone's: while the draft has changes, `ideaf pull` brings the draft into your files and `ideaf sync` sends what you changed into it (`change_draft`, each block saying how it read when you pulled, so text someone changed since is refused until you pull again); agents use `get_draft` and `change_draft`. Confirming it (`overwriteDraft`; `--overwrite-draft` for `ideaf sync` and `ideaf edit`, which ask at a terminal) is the escape hatch: those changes leave the draft, their blocks take the version's words in everyone's editor, and everyone in the draft is told ("Agent for Tomás overwrote 2 changes in the draft with version 3.", the version event's `overwrote`).
- **Committing** makes one version, a step for each command, and accepts the suggestions in it; the editor stays open, and what's typed after it is the next version's. It takes the whole draft as it is, and a dialog says what first, every time: how many changes in how many files, and by whom; a warning while anyone else with changes is still typing, and in which section (`get_draft`'s `typing`: who sent typing in the last 5 seconds, and the heading above their caret); and the files it takes, shaped like the Files tree, only those it touches with the folders above them, each with what happens to it (New, Edited, Deleted, Renamed, Moved). A rename is the old name struck through beside the new one, the only place a rename shows; a folder renamed is one row ("Renamed · 3 files"), with its files under it only when they're also changed. A file opens its comparison with the latest version, as Preview shows it. **Discarding** empties it for everyone, after naming whose changes go and keeping a restore point, and opens its suggestions again. Everyone else in the draft is told: "Priya committed version 2. What you type now goes into the next one." with See it, or "Priya discarded the draft." with Restore, which brings it back from that point for everyone (the draft socket's `version`, with `committed`, `discarded`, with its point, and `restored` events).
- **The list of changes** is for when someone wants it, not beside the page: a count in the bar ("5 changes in 3 files", saying how many are outdated) opens it as a dialog, with each change, the faces of who typed in it and Undo this change, and what committing does to the comments. A folder renamed or deleted is one row there ("Renamed research to findings (4 files)") with one Undo. The focus view puts the draft's actions in its top line, and nothing beside the sheets.
- **Credit:** each of the draft's changes is everyone who typed in its blocks (`authors`, the last first). Committing gives each step of the version the authors of the change it came from, and the version everyone in its steps; the committer is the version's `by`. Steps of a version made any other way are its maker's. The version list shows the faces of who typed in a version beside who committed it; each step's authors are in the API (`StepResult.authors`) and the cli.
- **Kept as documents:** the idea's actor holds the draft as the page editor's own document for each file it changes or someone has open (ui's `editor/model.ts`, run with no DOM), in its SQLite as a snapshot every 200 steps and the steps after it. The list of changes isn't stored: it's the difference between the documents and the latest version, worked out by block ID as the editor saves (core's `draftChanges`). Live editing is built in steps (`docs/handoff-live-editing.md`): typing, then who's in the draft and their carets, then committing together, then agents' edits marked.

Agents editing with batches, and uploads, make versions directly. A full editor in the web app, later, writes to the same draft.

## Suggested edits

Suggested edits are required for 1.0. A reviewer (human or agent) can propose a concrete change to a highlighted selection or section instead of only describing it in a comment. A suggestion is a comment with a proposed replacement attached, so it uses the same anchoring, replies, status and bot/user attribution as any other comment.

Only someone with edit access to the idea (or a bot acting for them) can accept a suggestion. Accepting a suggestion adds its `replace` command (see Editing with commands) to the idea's draft (see Drafts), in the web app, the cli and the API alike; committing the draft makes the new version in Ideation Factory, and `ideaf pull` brings it into the source. Changes gather in the draft and become one version, rather than a version for each suggestion. Reviewers propose, the people with edit access decide, and the repository (or wherever the idea ends up) stays the final home.

If a suggestion's text isn't in a newer version, it's outdated like any comment, and can no longer be accepted.

**Into the draft:** a suggestion is checked against the draft as it is: if the draft has already changed or removed its text, it isn't added, and stays open saying why. Committing the draft accepts it, in that version, with each suggestion its own step, so every suggestion's comment follows its new wording; discarding the draft opens it again. Rejecting one that's in the draft takes it out.

**Accepting several at once:** someone with edit access can accept several suggestions (across files) together: each is added to the draft. Two suggestions on overlapping text conflict: the second one's text is gone from the draft, so it stays open, and says why. Rejecting stays immediate, one at a time.

**What a suggestion replaces:** the source of the selected text, widened to whole formatting where the selection crosses it (selecting "line sync" in `**Offline** sync` takes `**Offline** sync`), which the suggester edits. Accepting finds that source where the comment is now, so a suggestion survives its paragraph moving or changing elsewhere; if the source itself has changed, it can't be accepted.

## Reviews

Ideas move through the states defined in `idea.md`: draft, requesting review and changes in progress while open, then closed accepted or closed rejected. People move an idea between its open states, and close and reopen it; anyone with edit access can. Nothing moves it by itself: meeting the requirements doesn't, and neither does a verdict.

**Verdicts.** A reviewer finishes a review with **Approve**, **Request changes** or **Reject**, from any account: a user, a bot associated with a user, or a bot. Verdicts carry the same attribution as comments (`[bot emoji] <bot> on behalf of <user>`), so an automated approval is never mistaken for a person's. A verdict is on a specific version, and the idea shows each reviewer's latest verdict and which version it was for.

- **Approvals are for a version.** An approval on an earlier version still shows ("approved v2"), but only approvals on the latest version count toward the requirements.
- **Objections stand until they're withdrawn.** A Request changes or a Reject carries on through newer versions, like a pull request's requested changes. It blocks closing the idea as accepted until the reviewer gives another verdict, or someone with edit access dismisses it (recorded, with who and why). Neither changes the idea's status or closes it.
- **Only people approve.** A bot's verdict shows, attributed, but its approval never counts toward the requirements, not even a bot acting on behalf of a person. A bot's Request changes or Reject does block, until it's dismissed.

**Approval requirements.** Each team sets requirements (see Team support in `idea.md`): a minimum number of approvals (0 = none), group rules that are either "any of" (or) or "each of" (and) a list of groups, and optionally "all discussions resolved". An idea can be closed as accepted only when they're all met, with approvals from people on the latest version and, when that check is on, no open comment threads (whoever started them, bots too). Nothing else needs them: an idea that meets them stays open until someone closes it.

- **Worked out live.** Whether the requirements are met is worked out from the team's current requirements and groups whenever it's shown or someone closes an idea as accepted, never stored. So a change to the requirements applies at once to ideas already in review, and so does a change to a group's members.
- **One person can meet several groups.** In an "each of" rule, an approval from someone in two of its groups counts for both.
- **Groups as reviewers.** A group rule can auto-add its groups as reviewers (which gives them view access, see Authorization) when an idea goes out for review (created out of draft, moved out of draft, or moved into the team while in review); this happens in the idea's actor on that state change, skips deleted groups and groups already reviewing, and doesn't touch ideas already in review when the setting is turned on.

Requirements name groups rather than people, so they keep working as people join and leave groups. Only a team's maintainers and admins can change its requirements.

**Pending reviews.** A reviewer can start a review and leave comments, replies and suggested edits as pending: visible only to them, and editable or deletable until submitted. Submitting publishes them all at once, optionally with a verdict and a summary comment, so the author gets one review instead of a stream of notifications. This matters for agents too: a bot reviewing a whole idea should submit one review, not dozens of separate comments. Pending comments are kept by the idea's actor, so a review can be continued on another machine or finished from the cli, and they follow new versions like any other comment. Submitting a verdict publishes them; so does submitting without one. Nobody else can reply to, resolve or accept a pending comment, and it doesn't count as an open thread for the "all discussions resolved" requirement until it's out.

## Future consisterations

### File creation

With the sparse/nested directroy problem in mind, users should also be able to create new md files in this software that can be synced back to the destination. Detions as well. **Built:** files are made, renamed, moved and deleted in the draft, from the web app's Files tree as from the cli (see Drafts), and `ideaf pull` brings them into the repository.

### OIDC for all admin actions (future requirement)

Every site admin action (permanently deleting a team, marking people inactive, changing a team or group you have no role in, creating site admin tokens) should require an OIDC-authenticated identity: a recent single sign-on login for people (step-up authentication if the session is older than a few minutes), and OIDC-federated credentials for automation. Once that's in place, long-lived site admin tokens should be replaced by short-lived credentials issued through OIDC. Until then, site admin tokens are separate, need a reason, last at most 30 days and are logged on every use.

### File editing

Agents and the cli edit with commands (see Editing with commands), a batch at a time, and concurrent batches merge like pull requests or conflict. People edit the draft in the web app live, together (see Drafts): only people with edit access, typing merged as it's typed, and committed as one version made of the same commands.
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
- **Deprovisioning with SCIM:** the provider's SCIM client can add people ahead of their first sign-in, keep names and emails in step, and deactivate people removed there: inactive here (see Inactive users in `idea.md`), signed out, their writes refused at once. Without SCIM, removing someone in the provider stops them signing in, but their account isn't marked inactive until a site admin does it. SCIM groups aren't taken; groups and teams stay ideaf's own.
- **Site admins keep an email code** while single sign-on is on, as the way in when the provider is down or misconfigured. Nobody else does: there's one way in, the provider's. (Email codes for people outside the provider's domains, such as outside collaborators, may come later.)
- In the MVP the provider is set in the deployment's configuration (environment variables), not on a Site admin page yet.
- This is the natural place for the "OIDC for all admin actions" future requirement: with an identity provider in place, site admin actions can require a recent sign-in (step-up).

Tokens for the cli and agents are separate from sign-in, and work the same way under either provider (see Bots vs humans in `idea.md`).

Open questions: should handles be changeable (GitHub allows it, and redirects old @mentions and links), and how often? Should a deployment be able to allow both single sign-on (for employees) and email codes (for outside collaborators)? For now it doesn't: under single sign-on, only site admins keep an email code.

## Authorization

Access is per idea, like a shared document: each idea says who can view it, edit it and share it.

**Permissions on an idea:**

| Permission | Allows | Includes |
|---|---|---|
| **View** | Reading it, commenting, replying, suggesting edits, and reviewing when asked | |
| **Edit** | Editing it (commands or uploads), accepting or rejecting suggested edits, changing its status, closing and reopening it, and dismissing a reviewer's Request changes or Reject | View |
| **Share** | Changing who has access: adding and removing people, groups and the team's members, making it public, and asking for reviews (which gives view access, see below) | View |
| **Owner** | Everything, including transferring ownership. Every idea has exactly one owner, who starts as its creator | Edit and share |

**Who access can be given to:** a person, a group (its current members), the members of the idea's team, or everyone (**public**: everyone with an account on this deployment, never anonymous visitors). Access through a group or a team **follows membership**: joining gives access to what's shared with it, and leaving takes that access away at once. When several grants apply, the highest wins. The sharing page shows where each person's access comes from ("through Security"), so removing a person who also has access through a group says so.

**Reviewers are viewers.** Asking a person or group to review an idea gives them view access to it. That includes groups that a team's approval rule adds automatically (see Reviews). Taking someone off the reviewers leaves them a plain viewer; removing their access is a separate step, and also takes them off the reviewers. Reviewers approve, request changes and suggest edits; only people with edit access change the idea.

**New ideas:**

- **Outside a team:** private. Only the owner has access until they share it.
- **In a team:** the team's defaults for new ideas, set by its admins: what the team's members get (nothing, view or edit), whether the idea starts public, and any groups that get view or edit. Defaults are applied when the idea is created; after that, anyone who can share it can change its access.
- **Moving an idea** into a team, out of one, or to another one needs share access on the idea and permission to create ideas in the new team. It goes through a **move wizard**, because moving can change who has access:
  1. It shows the idea's access now, and what the move changes: the old team's members lose the access the old team gave them, and the new team's defaults are added.
  2. It lists, by name, the people who would lose access, and those who would gain it (counting the new team's members, groups and whether it becomes public).
  3. The person moving can adjust any of it before confirming: keep a grant the move would remove, drop one it would add, or change a permission.
  4. Nothing changes until they confirm. People who lose access stop seeing the idea and its notifications at once.

  The cli and MCP do the same: `ideaf move` prints the same summary and asks to confirm (agents pass the adjustments as flags, and `--yes`), and the MCP tool returns the summary for a dry run before the move.

**Teams** decide who can create ideas in them (anyone with an account, the team's members (the default), or only its maintainers and admins). A team's **admins can always share every idea in the team**, so access can be fixed when an owner is away or has left. Team names, members and approval requirements are visible to everyone.

**Teams and groups are always invite only:** joining one needs a maintainer or admin to approve (or to add you directly), because membership gives access to everything shared with it. There's no open joining; revisit if people ask for it. Teams and groups, and their members, are visible to everyone. Anyone can create a team or a group.

**Site admins** manage every team and group, but can't read an idea unless it's been shared with them (directly, through a group or team, or by being public).

**Bots:** a token acts with its user's access ("me" and "a bot for me"). A standalone bot account is given access like a person.

Inactive users keep read access to what they could see, but can't write (see Inactive users in `idea.md`). A token belonging to an inactive user, or a bot token acting on their behalf, is rejected on every write. Personal tokens are checked against the user's own access only; site admin powers are never available through them. Site admin actions need a site admin session or a site admin token (separate, short-lived, reason required), and every site admin action is logged as one.

**Why not OpenFGA:** the model is Zanzibar-shaped (grants to people, groups and team members, followed through membership), but running OpenFGA means a separate service with Postgres or MySQL in production (its SQLite store is beta), which conflicts with keeping everything in Rivet and a bucket. Its weakest query is also our most common one: listing the ideas someone can see, filtered and paged. The grants are rows in the directory actor instead (see Auth and access in `mvp/architecture-backend.md`).

**Checking who's calling.** Sessions and personal tokens are long-lived and live in the directory (see Storage). Requests carry a **15-minute signed access token** instead, checked by its signature alone. It holds who the caller is and the token's purpose, never roles or memberships, so authorization always uses current data. Long-lived credentials are only checked when a short-lived token is issued or refreshed (the browser through its session, the cli by exchanging its personal token). So **revocation takes effect within 15 minutes:** revoking a token, signing out a session, or marking someone inactive stops new short-lived tokens at once, and existing ones expire within 15 minutes. That includes site admin tokens. **Writes don't wait:** a write (comment, edit, review, upload, settings) checks the caller's current status, so an inactive user's writes are refused at once. Writes are far rarer than reads, so that check is affordable. In an emergency, rotating the signing key ends every outstanding token. MCP clients get the same signed tokens through OAuth (Better Auth is the candidate; see Auth and access in `mvp/architecture-backend.md`).

Access is checked on every read, not just in lists: idea pages, search results, counts, the API, MCP and the cli. Notification fan-out and the inbox filter on it too, so removing someone's access (or removing them from a group or team that had it) hides their existing notifications and stops new ones, with no cleanup job. Because access comes from grants and from group and team membership, grant and membership changes must invalidate any cached access (the directory's search index stores each idea's grants, and queries join against the caller's memberships). Content-addressed media in the bucket is served only through a visibility check on an idea that references it, never by hash alone.

TODO: explore OIDC for agentic use cases. Agents and CI jobs currently authenticate with tokens a person creates and stores as a secret. With OIDC (workload identity federation), an agent's platform (for example a CI provider or a cloud runtime) would present a short-lived, signed identity token, and Ideation Factory would exchange it for a short-lived ideaf credential, so there are no long-lived secrets to leak or rotate. Open questions: which issuers to trust, and how an issuer's claims (repository, workflow, environment) map to the three token purposes ("me", "bot associated with me", "bot") so attribution still reads "[bot emoji] <bot> on behalf of <user>"; whether a person can delegate to an agent this way (token exchange) rather than only automated bots; and how this works for self-hosted deployments with their own identity provider.

# Groups

A user should be able to make groups to associate mutiple

Groups are also the building blocks of team approval requirements (see Reviews). Changing a group's members therefore changes what every team using that group requires.

Groups are visible to everyone, including their members, and anyone can create one. Like teams, groups are always invite only: joining needs a group maintainer or admin to approve, or to add you directly, because membership gives access to everything shared with the group (see Authorization).

Groups have admins and maintainers, like teams (see Team support in `idea.md`). Each group has its own page (name, description, members with roles, and where it's used: team requirements and ideas it reviews) and a separate settings page for its admins and maintainers.

Only a group's admins (or a site admin) can delete it. Before deleting, the settings page shows what would break: teams whose approval requirements name the group (and how many active ideas that blocks), open ideas where it's a reviewer, and its members. A deleted group is kept as a record rather than removed, so anything still pointing at it can say so:

- Approvals from a deleted group's members no longer count toward any requirement that names the group.
- A requirement only breaks if the deletion makes it impossible to meet: an "each of" rule where any of its groups is deleted, or an "any of" rule where all of them are deleted (with one group, either breaks when it's deleted). A broken requirement shows an error on the team page, on every active idea in the team ("Requirements need fixing"), and on the home page of the team's maintainers and admins. Ideas in that team can't be closed as accepted until a maintainer or admin of the team replaces or removes the group.
- "One person from any of several groups" with other groups left keeps working through them. It shows a warning (not an error) so a maintainer can tidy it up.
- The delete report separates the two cases: requirements that will break (and how many active ideas that blocks) and requirements that keep working through other groups.
- An idea that had the group as a reviewer shows it as a deleted reviewer.
- Access given to the group ends, and the delete report lists the ideas it was shared with, so their owners can give access another way.

## Groups in teams

**Status:** built, with its notices in the inbox and by email (below, under Notifications). The team's Groups tab and the group's page show who added each group, and when.

A team's admins can **add a group to the team**, the way GitLab shares a project with a group: the group's members become the team's members, with a role the team chooses, for as long as they're in the group. Organizations manage people in groups. Adding the same people to each team by hand, and keeping every team in step when someone joins or leaves, is what this saves.

**How it differs from groups elsewhere in a team:**

- **A team's defaults for new ideas** can give a group view or edit on each new idea. That's a grant on each idea, made when the idea is created and changeable per idea, and it gives nothing else.
- **A team's approval requirements** can name a group, whose members' approvals count. That's about who must approve, not about membership.
- **A group in a team** makes its members the team's members. They get everything membership gives (below), and it follows the group: someone who joins the group is in the team, and someone who leaves is out, at once.

**The role.**

- **The team chooses the group's role:** member (the default) or maintainer, **never admin**. A team's admins can share every idea in the team and change all its settings, so control stays with people named directly.
- **Each person's role through the group is the lower of the group's role and their own role in the group.** That's GitLab's rule ("the lower of the maximum role you select and their existing role in the invited group"). Added as maintainer, a group's admins and maintainers are the team's maintainers, and its plain members are the team's members. Adding a group never makes anyone more than they are in it.
- **Their role in the team is the highest of every way they're in it:** directly, and through each group.

Keeping admin direct also means everything only an admin may do is checked as it is today:
- seeing every idea in the team;
- the rule that a team keeps at least one admin;
- sharing any idea.

**One level only.** A group's own members come in; nothing else does. Groups don't contain groups, and teams can't be added to teams. So working out a team's members is always two steps: the team, then its groups' members. That's also GitLab's rule: "only direct members of the invited group get access".

**What membership through a group gives.** The same as direct membership, at the role it works out to:

- **Ideas:** whatever the team's grants give its members. That means the "members" level of its defaults for new ideas, and any idea shared with the team.
- **Creating ideas,** when the team lets its members (or, as maintainers, its maintainers) create them.
- **Watching the team,** at any level.
- **As maintainers:** managing the team's direct members and join requests, and its approval requirements, as a direct maintainer does.

**Leaving, and changes taking effect.**

- **Someone in a team only through a group can't leave the team on its own.** They leave the group, or ask a team admin to remove the group, and the team's page says so. Anyone may still ask to join, or be added, directly. That's how someone in through a group as a member gets maintainer.
- **Changes take effect on the next request:** removing someone from the group, removing the group from the team, or deleting the group. Access is worked out when it's read (below), so there's no copy to update. As with direct removal, the ideas it gave stop showing, and their notifications from it stop.

**Who decides.**

- **A team's admins can add any group,** without asking it. Groups are visible to everyone, and team admins can already add anyone directly. The group's admins get an inbox notice: "Design reviewers was added to Mobile, as members".
- **A group's admins can take their group out of a team:** the group leaves it, as a person can. That's the group's say, after the fact. Nothing waits on approval, and a group added somewhere it doesn't belong can be removed by the people who run it, without needing the team's admins. The team's admins get an inbox notice.
- **Requiring more,** as GitLab does (only a member of a group may invite it) or an approval like a join request, was weighed and left out for now. If unwanted additions turn out to happen, requiring the team admin to be in the group is the next step.

**What people see:**

- **The Members tab:**
  - **A Source column:** "Direct", "Through Design reviewers", or each way someone's in.
  - **One row per person,** with their role as it works out. GitLab lists each way separately; we don't.
  - **The role menu** changes only a direct role. Someone in only through a group shows their role without a menu, and adding them directly gives them one.
- **A Groups tab:**
  - **Each group in the team,** with its member count, its role, and who added it and when.
  - **Adding a group:** a group picker and its role.
  - **Removing a group** first says how many would leave the team: the people in it only through that group (each group's `leaving`).
- **The group's own page** lists, under "where it's used", the teams it's in, with its role in each. For the group's admins, each has a **Leave team**, which first says how many would leave the team with it.
- **The team's member count** is people, counted once however they're in it.
- **Deleting a group:** its report also lists the teams it's in, and the people who'd leave each.
- **Moving an idea:** the move wizard counts the people in a team through its groups, when it lists who gains or loses access.
- **The API, MCP and the cli:**
  - `list_team_groups`, `add_team_group` (team, group, role), `remove_team_group` (by the team's admins, or the group's);
  - `list_team_members` gives each member's sources;
  - `ideaf team groups|add-group|remove-group`, and `ideaf group teams` and `ideaf group leave-team <group> <team>` for a group's admins (the cli's commands are flat, and `ideaf group leave` is a person leaving the group).

**Working out access.** Today "the teams someone is in" is one indexed lookup: their memberships of kind team. It's used where a grant to a team is matched (`grantAppliesTo`, behind lists, search and every permission check), in "your teams", in who may watch a team, and in the create and maintainer checks. With groups in teams it becomes those memberships, together with the teams their groups are in:

- **A new table:** `team_groups (team, group, role, added_by, created_at)`, indexed by group and by team.
- **The lookup gains one join:** the person's group memberships, then `team_groups` by group. Everywhere that uses it gets the same widened set, in the same single query. Lists and search stay one indexed query each.
- **Admin checks don't change,** as no one is an admin through a group.
- **The members list** becomes direct members together with the members of the team's groups, merged per person (the highest role, and every source), and still paged on its sort key and then the handle.
- **Watches don't change.** Watching a team isn't a member's right here: what a watch shows is filtered by what the watcher can see, so leaving the group ends what it showed them through the group, with no cleanup.
- **No copy of who's in each team.** A table of everyone's team memberships, kept in step on every change, would make reads slightly cheaper. It would cost a write per person whenever a group joins a team (2,000 writes for a 2,000-person group), and it's another copy that could disagree with the groups. If the widened lookup turns out to be slow, that's a decision to make then, from measurements.

**At the design scale** (10,000 people, 1,000 teams, 2,000 groups, 100,000 ideas):
- **The new table stays small.** Each team would have a handful of groups, so a few thousand rows at most.
- **Each person's set of teams grows by a few dozen at most:** say five groups, each in three teams. That set is worked out once per query.
- **The expected cost is small, but it needs measuring:** on the Frankfurt deployment's seed, add groups to a few hundred teams, then compare list, search and permission-check latency at the steady load (100 page views a second) before and after.

**Not doing:**
- groups in groups, or teams in teams;
- admin through a group;
- expiry dates, as nothing records them;
- different roles for different people within one group's membership of a team: anyone needing more is added directly.
- teams following an identity provider's groups: SCIM brings people, not groups (Deprovisioning with SCIM, above), and that stays. An identity provider's groups bring a lot of baggage (nesting, naming, every group in the organization) for little here, so groups and teams stay ideaf's own.

**Kept separate: a group in the team, and a group in the team's defaults.** Both let a group's people see a team's ideas, but they answer different questions, so both stay:

- **A group in the team** answers "who's on this team?": *Mobile developers* in the Mobile team. Its people are members, with everything that brings, on every idea at once, and it's all or nothing.
- **The groups in the team's defaults for new ideas** answer "who else should see our ideas, without joining us?": *Security review* getting view on each new idea. Each idea is shared with the group as it's created, and can then be changed on its own (taken off a confidential idea, or given edit), and the group's people never become members, create ideas there or watch the team.

Folding the defaults' groups into this would make *Security review* team members and end per-idea control, so they stay. The app keeps them apart:
- **The Groups tab** holds the groups that are part of the team.
- **Settings → Access** says "Also shared with" for the defaults' groups.
- Each says in one line what the other is for.

# Emails and messaging

Notifications are in the app (the inbox) and, where the deployment has email set up, by email too.

**Email notifications** (step 9, part 4c) go out the same way as sign-in codes: over SMTP (any provider: Amazon SES, Postmark, Mailgun, Resend, a server of your own), or through the host's `sendmail` command (`email.mode: sendmail`), for a machine whose own mail setup already relays its mail, so a deployment that can send sign-in codes can send them. A deployment without email shows no email options (`email.notifications: off` turns them off while keeping sign-in codes; in development without SMTP they go to the server log).

- **The same events as the inbox,** from the same queue: who hears about an idea, and why, is decided once, and email follows it. Unsubscribing from an idea stops its emails too, and access is checked when an email is sent, so nobody is emailed about an idea they can no longer see.
- **On by default, for the ideas you're involved in** (author, review requested, via a group, participating, subscribed). Each person picks `involved`, `review-requests` (only being asked to review) or `off`.
- **Not one email per event:** an idea's updates are bundled into one email once it has been quiet for 5 minutes, and no later than 30 minutes after the first, so a busy idea or a bot posting a review doesn't flood anyone. Or, per person, one digest a day of every idea with something new.
- **Reading first stops it:** opening the idea, or marking it read or done, before its email goes drops what was waiting.
- **Watched teams email only if you ask** (off by default; they always fill the inbox). Since watched events aren't written per watcher (part 4b), turning it on queues a row per event for you, as being involved does.
- **A sender per kind, for filtering:** notifications come from their own address (`email.notify_from`, say `Ideation Factory <notifications@example.com>`), apart from sign-in codes (`email.from`), so people and mail rules can sort them, the way GitHub's notifications@ is apart from its noreply@. Without `email.notify_from`, notifications use `email.from`. Each notification also says what it's about in headers a filter can match: `X-Ideaf-Reason` (as GitHub's `X-GitHub-Reason`), `X-Ideaf-Idea` (its address, `mobile/idea/9`), `X-Ideaf-Team`, and a `List-Id` per team (`<mobile.teams.example.com>`) or per person's own ideas, which Gmail's `list:` filters match. An idea's emails thread together.
- **Each email says why** it was sent, links to the idea, and has a one-click unsubscribe (`List-Unsubscribe`, RFC 8058) for that idea; a digest's stops email altogether. The links are signed with the deployment's secret, so they work without signing in; opening one asks first, so a link checker changes nothing.
- **How it runs:** the directory keeps a row per person per event waiting to be emailed (`email_pending`), only for those who want email, and an actor alarm sends what's due, then sets the next. A send that fails waits for the next alarm.

 What a user is notified about follows the watch levels under Team support in `idea.md`: ideas they participate in or are assigned to by default, plus a team's active ideas (including when they close) or all of its ideas if they choose. Each notification should say why the user received it.

The inbox works like GitHub's: one entry per idea (its latest update, how many are new, and why you're subscribed), not one per event. It can be grouped by date or by team, filtered by reason (review requested, participating, watching a team) and by team, and each idea can be marked read, marked **Done** (cleared from the inbox until something new happens) or **unsubscribed**. Every idea page has a Subscribe / Unsubscribe button that says why you're subscribed. Unsubscribing stops notifications for that idea, except when someone asks you to review it.

**Notices about teams and groups** sit among the ideas, each its own row (they're rare, so nothing is bundled), with the reason "teams": a group joined or left a team (to the admins of both, but not whoever did it), or someone else added you to a team or a group, or took you out. Each is written by the directory in the same transaction as the change, keeps the names as they were, and is read, done and counted like an idea's row. Email follows the same settings as being involved: each notice is its own email once it has been quiet a while (or goes in the daily digest), unless it's read first. Grouped by team, a notice about a team is in its section, and one about a group alone in the group's.

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

- **Direct participants get notifications written to their inbox when the event happens.** These are the owner, reviewers, members of reviewer groups and people following the idea, usually a few dozen at most. The idea's actor sends its events through the directory's queue without waiting, and the directory writes each event to all of them in one statement.
- **A group's size doesn't change what its members hear.** Every member of a group asked to review hears about the idea exactly as someone asked by name would, however big the group. Queuing keeps that off the request path; if big groups make it slow, the work moves, never the experience.
- **You don't hear about what you did yourself.** What a bot does on your behalf does reach you (you'll want to see what your agent did), unless you turn that off in your settings.
- **Taking part subscribes you,** commenting, replying or reviewing, and unsubscribing silences an idea except for review requests.
- **Team watchers are not fanned out per event.** A team with hundreds of watchers would turn every comment into hundreds of writes. Events go to the team's activity log, and a watcher's inbox merges in the teams they watch (at their level) when it's read. Unread counts for watched teams are kept per team, not per event.
- **Bundling happens at read time** (per idea), so the stored events stay simple.
- **No notification is lost.** A write's notifications go into its idea's outbox in the write's own transaction, so they exist exactly when the write does. The idea's actor sends them to the directory's queue and waits until the directory says it has applied them; only then are they deleted. One the directory couldn't take (busy, restarting, moving to another node) is sent again later, waiting longer each time, up to 5 minutes. An actor that stopped first sends what's left when it wakes, and a safety alarm wakes it. Each notification has an ID, so one sent twice is written once, and a late one doesn't become an inbox row's latest update, since that's the newest by time. The directory completes a queue message only once it has applied it, in one transaction with the rest of its batch.

## Permanent deletion

Permanently deleting a team (site admins only) erases its index rows in the directory, the actor of every idea in it, the notifications that point at those ideas, and watch settings for the team. File contents in the bucket are shared between versions, and possibly between ideas, because they're stored once per distinct content. So deletion removes the manifests first and only deletes a file once nothing else refers to it (reference counting, or a periodic sweep). The delete is logged (who, when, what) without keeping the content.

## Limits

- Every token is rate-limited, bot tokens more tightly than people's, and each idea has a cap on comments per minute. Review comment batching (see Reviews) is the normal way for a bot to post many comments: one submission, one notification.
- Approval requirements are worked out when they're shown or an idea is closed as accepted, never stored, so changing a group's members or a team's requirements re-evaluates nothing up front.

## Open questions

- How long do closed ideas stay in the default search results? They could stay searchable but drop out of default lists after a while.
- Can very large counts be approximate (e.g. "about 4,000 closed ideas") to keep list queries cheap?
