# CLI tool

The cli should follow the `gh` style and use subcomands. The cli tool is the primary tool that humans and agents running in a terminal will use to interact with Ideation Factory.

## MCP server

An MCP server is required for 1.0. Not every agent runs in a terminal with shell access (desktop and chat clients, for example), and teams should be able to use whatever agent they already have. **The MCP server is hosted by the backend, not shipped in the cli,** because most people who want MCP don't want to install a binary. Every operation is defined once in the backend and exposed both as the HTTP API and as MCP tools, and the cli (TypeScript, like the backend) imports the same definitions and typed client, so their capabilities stay in sync. MCP clients sign in with OAuth 2.1 (the MCP spec's method for remote servers), choosing the token's purpose on the consent screen. Client ID Metadata Documents (CIMD), the current MCP standard for identifying clients, must work in every deployment; on our own servers the metadata fetch can be made safe (see CIMD in `mvp/architecture-backend.md`). The hosted server can review, comment and edit remotely, but can't reach local files; getting results into a repository is `ideaf pull`. At a minimum the MCP server should support listing/reading ideas, fetching and creating comments, replying to and resolving comments, and creating suggested edits. It should also support **editing with commands** (see Editing with commands in `architecture.md`): reading the structured view, a dry run, and applying a batch. For agents, that's the main way to change an idea. MCP tokens have the same purposes as the cli's ("bot", "bot associated with me", "me") so attribution works the same way.

Desired commands:


idea filter/sort =  "user" "userbot" "mybot" "allbots" "allusers" "alluserbots" "all"

```text
ideaf sync - syncs changes to Idea factory a POST action only works if idea in progress. Refuses with "pull first" if Ideation Factory has a newer version of a file than the one you edited from; `--force` uploads anyway, replacing it (see Base versions in `architecture.md`).
ideaf sync <file|dir> - by default sync looks from the git root dir (if it exits), this allows users to scope an upload to a specific directory

ideaf show --blocks - the structured view of the idea: each file's sections and blocks with their ids and text, and the open comments and what they're on. What a skill reads before building a batch of edit commands. `--json` for agents.

ideaf edit <batch.json> [-m message] [--dry-run] - edit the idea in Ideation Factory with commands (replace, insert, delete, move, rename-heading, set-section, rename/create/delete file; see Editing with commands in `architecture.md`). A batch makes one new version. `--dry-run` shows the diff and what happens to each comment. If the idea moved on since the batch was built, it's replayed onto the latest version, and refused with the conflicting commands listed if any no longer apply. Refuses if you have local edits that aren't synced, so they aren't stranded. Afterwards, `ideaf pull` brings the result into your files.

ideaf pull - bring the idea's latest version into your files: accepted suggestions and anything synced from another machine. Merges with your local edits (3-way, using each file's base); conflicts are left for you to resolve, like git.

ideaf list - list ideas for this repo (filter by your ideas by defaut) display active one first with an indication that it is the active one

ideaf start - start an idea. Walk through required fields if not present in cli args. The team is optional: with no team (and no default team in config), the idea has no team and is private to you until it's moved into a team (`ideaf move --team <team>`). Allow ideas to optionally create new branch (off default branch) or worktree if in git repo.

ideaf change - change the idea you are working on. this should support changing worktrees and branches. the command supports allowing the user to specify the title --ideaTitle or it will list the availible ideas and let the user choose with an interative ui. default filter is the users ideas.

iteaf auth - support auth staus, auth login etc. Assume a user is only ever logged in to one account, but they could have mutiple tokens for a bot or user. The cli exchanges its long-lived token for a 15-minute signed access token and refreshes it as needed, so the server only checks the long-lived token every 15 minutes (see Authorization in `architecture.md`).
```

We also need team logic in the cli tooling.

Fetching and making comments is also needed. The taget audience for this subcommand is bots/skills


## Config

Support a config file in the git root dir if it is a git repo. Some example config is to disallow a subdir from being uploaded to ideation factory and the base url for converting relative code references. As well as the default branch is for the repo. Default team as well.

## Uploads

The upload process should support `ideaf change` accross machines where possible. So for example, if it is associated with a origin branch, that should be included in the metadata where possible.

### base versions and the state file

To track comments exactly and avoid overwriting newer versions, every sync sends each file's **base**: the hash of the content last uploaded or downloaded on this machine (see Base versions in `architecture.md`). The cli keeps these in a state file, **one per idea**, because a repository can hold several ideas, usually one per branch or worktree.

- **Where:** in git's shared directory (`$(git rev-parse --git-common-dir)/ideaf/<idea-id>.json`). It's shared by every worktree of the repository and never committed. Outside a git repository, it's `.ideaf/state/<idea-id>.json` in the synced root.
- **What:** the idea id, its branch or worktree, and for each file its path, base hash and version.
- **When it changes:** after every sync and pull. `ideaf change` and `ideaf start` set it up for the idea they switch to. On a new machine, a pull writes it (the files then match the latest version exactly).
- **Lost or missing state:** the base is unknown, so sync asks you to pull first, or `--force`.

This is separate from the repository config file (see Config), which is committed and shared.

### media

`ideaf sync` uploads the images the synced markdown references (`![alt](./img/flow.png)` or `<img src>`), resolved relative to each file, so they render in Ideation Factory. Only referenced images are sent, never whole folders. Images over the deployment's size limit (set by a site admin, 10 MB by default; the cli asks the server for it) or of an unsupported type are skipped, and sync lists what it skipped and why. Other media (PDFs, video, archives, code) is never uploaded; links to it are rewritten to the code host like code references (see below). Repo config can exclude paths and set a lower image size limit than the deployment's, never a higher one.

### relative urls

#### code references (non md)

If the md file include links code support bidirectional transformation of the references. When it is uploaded they should be translated to, say github.com links. Then when it is downloaded it should support converting those back to relative urls.

####

When MD files refererneces another md file that is uploaded this should be relolvable in the app.
