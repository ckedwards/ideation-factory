# CLI tool

The cli should follow the `gh` style and use subcomands. The cli tool is the primary tool that humans and agents running in a terminal will use to interact with Ideation Factory.

## MCP server

An MCP server is required for 1.0. Not every agent runs in a terminal with shell access (desktop and chat clients, for example), and teams should be able to use whatever agent they already have. The MCP server and the cli should share the same API client so their capabilities stay in sync. At a minimum the MCP server should support listing/reading ideas, fetching and creating comments, replying to and resolving comments, and creating suggested edits. MCP clients authenticate with the same token types as the cli ("bot", "bot associated with me", "me") so attribution works the same way.

Desired commands:


idea filter/sort =  "user" "userbot" "mybot" "allbots" "allusers" "alluserbots" "all"

```text
ideaf sync - syncs changes to Idea factory a POST action only works if idea in progress
ideaf sync <file|dir> - by default sync looks from the git root dir (if it exits), this allows users to scope an upload to a specific directory

ideaf list - list ideas for this repo (filter by your ideas by defaut) display active one first with an indication that it is the active one

ideaf start - start an idea. Walk through required fields if not present in cli args. Allow ideas to optionally create new branch (off default branch) or worktree if in git repo.

ideaf change - change the idea you are working on. this should support changing worktrees and branches. the command supports allowing the user to specify the title --ideaTitle or it will list the availible ideas and let the user choose with an interative ui. default filter is the users ideas.

iteaf auth - support auth staus, auth login etc. Assume a user is only ever logged in to one account, but they could have mutiple tokens for a bot or user.
```

We also need team logic in the cli tooling.

Fetching and making comments is also needed. The taget audience for this subcommand is bots/skills


## Config

Support a config file in the git root dir if it is a git repo. Some example config is to disallow a subdir from being uploaded to ideation factory and the base url for converting relative code references. As well as the default branch is for the repo. Default team as well.

## Uploads

The upload process should support `ideaf change` accross machines where possible. So for example, if it is associated with a origin branch, that should be included in the metadata where possible.

### relative urls

#### code references (non md)

If the md file include links code support bidirectional transformation of the references. When it is uploaded they should be translated to, say github.com links. Then when it is downloaded it should support converting those back to relative urls.

####

When MD files refererneces another md file that is uploaded this should be relolvable in the app.
