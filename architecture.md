# Architecture

## The document

The Ideation Factory only supports markdown files. Any enancements (say, rendering of mermaide diagrams) should be compatible with markdown generally sepeaking. A generic, bare bones, markdown viewer should be able to produce a resonable rendering of the document even though it may be a worse viewing experience (viewing a mermaide diagram as a code block rather then randered)

## Versions

The document should be versioned (v1, v2 etc.) and the version history should support diffing between versions. The version system should support batch uptades. Mutiple files could be edited

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

Comments are extreemly impotaint to get right as this is the primary way for agnents and humans to provide feedback on a doecument. A comment could be for a file, a section or a highlighted selection of words. As best as possible comments need to track document restruturing (say, moving a section to a different location in the file) as well as file renames. Some of this can be tracked by Ideation Factory, but others like file renames, may need the upload CLI tool to indicate that a file has been renamed to support tracking changes. Comments that are lost for a file should be tracked in a lost comments page. you should be able to see the lost comments for a file as well as be able to click on a link where the newest possible revision can be associated with that comment.

Comments can have a status associated with them. Currenly only "resolved" and "unresolved" are planned, but more could be added.

Comments can have replies associated with them to start conversations.

## Suggested edits

Suggested edits are required for 1.0. A reviewer (human or agent) can propose a concrete change to a highlighted selection or section instead of only describing it in a comment. A suggestion is a comment with a proposed replacement attached, so it uses the same anchoring, replies, status and bot/user attribution as any other comment.

Only the idea's creator (or bot credentials associated with the idea) can accept a suggestion. Accepting a suggestion creates a new version of the document in Ideation Factory, and the cli pulls accepted suggestions back down to the source on the next sync. This keeps Ideation Factory from becoming a multi-editor collaboration tool (see File editing below): reviewers propose, the author decides, and the source stays the source of truth.

If a suggestion's anchor is lost after a new version is uploaded, it is treated like a lost comment.

## Future consisterations

### File creation

With the sparse/nested directroy problem in mind, users should also be able to create new md files in this software that can be synced back to the destination. Detions as well. 

### File editing

Ideally files could be edited direcly in Ideation Factory, but the decision has been made to not tackle this problem in a first iteration. Suggested edits (see above) cover the most common need, proposing a concrete change, without full editing. This also potentially introduces more mulit-editor collaboration problems that would distract from the main goal.

## Authorization

Everyone who has an account can view all ideas. Only the creator (or bot credentials assoiciated with an idea) of an idea can edit the files associated with an idea. Having finer, document based acess control is a future consideratiaon.

# Groups

A user should be able to make groups to associate mutiple

# Emails/messageing

All notifications are in app for now.
