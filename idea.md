# Ideation Factory

## Mission

The goal of this is to create a platform where agents and humans can collaborate on the "ideation" phase of software development. As the time do produce software drops dramatically with each new frontier model, it is more importaint that software engineers get the the architechure, design and implementation plan correct up front. In the past the longer implementation time allowed for natrual checkpoints. Your colligues would ask you what your working on, you could get advice from your boss in your one-on-one meetings. This is no longer adiquate. Now you produce 1,000 lines of code before lunch. This platform strives to enable software engineers to be able to share ideas and get feedback. The goal is not to replace git or github, but focus on this one aspect and to it well. Where the approved and inialized ideas are recorded in the end is up to you. It could be a separate git repo, the git repo where the changes are made, Jira, Confluence or any other preferred platform. Every company operates differently, so that decision is yours to make.

## Bots vs humans creating edits and comments

We welcome agentic editing in addition to human edits. However, we want to distiquist between the two where possible. Not because one is better than the other, but rather for transparancy. That even `user` created documents may have been primarily generated from an agentic process. The goal here is to distiguish between where `user`s provided input vs where the process was fully agentic.

Bot comments or versions in the version history should look like `[bot emoji] on behalf of <user>` rather than `user`. Even better if you have an agent name it would look like `[bot emoji] <typobot> on behalf of <user>`. If there is no user associated with the agent, it could just be `[bot emoji]` or `[bot emoji] <typobot>`. The goal here is to distiguish between fully automated agentic feedback and ones that have been user dirven. The easiest way to make this distintion is to use different auth tokens for the different roles. Our auth token creation UI should include a purpose to match these roles. This could be a "bot", "bot associated with me" or "me".

## Tech stack

## Front end

This is a React/Tanstack repo. Tanstack has done an amazing job curating a set of high quality tools. Focus on useing those where possible.

### Theming

Custom theming should be supported with a light, dark and highcontrast theme out of the box. Themes should be easily customizable with a set of css variables so that companies can easily intigrate this product. Hard coded pixel values make cutsom theming diffictult and should be avoided.

## Backed

The tech stack is cloudflare/durable objects. We support on-prem deployments using celld.

## CLI

Since this is not fully integrated into any one system (say github), a cli tool is needed to handle things like syncing documents to and from the Ideation Factory. This tool should be written in go.

## Skills

Skills should be created to help users manage Ideas in Ideation Factory

## Team support

Out of the box this needs to support mutiple teams. Teams can be created by any user, but can only be deleted by an admin. Teams is just a way to group ideas and it is up to organizations to decide how they want to handle this orginizationally.

## Terms

Idea - each working set is an "Idea". The idea can have a name, description (optional) and is associated with a user. There is a status (draft, requesting review, changes in progress). You can assign mutiple people or group of people to review the document.
