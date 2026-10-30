# Market Analysis

As of 2026-10-24. Product details come from each product's own site and docs, not from hands-on use.

## Purpose

Ideation Factory is intended to be a free, open source project that organizations host internally, on infrastructure they already have (containers, plus an S3-compatible bucket, using [Rivet](https://github.com/rivet-dev/rivet) actors; no particular cloud). Earlier versions of this analysis assumed Cloudflare plus [celld](https://celld.dev); that changed on 2026-10-28, because the target users mostly don't use Cloudflare. It is not a paid product. The goal of this analysis is to answer one question: **is it worth building?** Does an equivalent already exist, and if not, where does Ideation Factory fit?

## Summary

Parts of the idea exist, and the "humans and agents review markdown together" space filled up quickly in 2026. Inline comments on rendered markdown and sending feedback to an agent are now common features.

However, no product found combines:

- open source
- self-hostable as a **team server** (not just a localhost tool)
- multi-user review workflow (assigned reviewers, status, teams/groups)
- agent-native (CLI, MCP, attribution of agent edits/comments)

The open source tools are single-player (one developer reviewing their own agent's plan on localhost). The team-oriented tools are closed source or paid. That gap is what Ideation Factory fills.

**Verdict:** worth building, with the scope risks below kept in check.

## Competitors

### Open source

| Product | What it is | Overlap |
|---|---|---|
| [Plannotator](https://github.com/backnotprop/plannotator) | Local browser UI for annotating agent plans, markdown and PRs. Hooks into Claude Code, Codex, Gemini CLI, Kiro and others. | High. The open source sharing flow is deprecated in favor of paid hosted **Workspaces** ($10/active seat/month; self-hosting by quote). |
| [Crit](https://crit.md/) | Single Go binary. Review plans, diffs and running apps in "rounds". Comments stay attached across rounds; round-to-round diffs. Local, with optional self-hosted sharing. | High. Closest to the versioning and comment tracking in this project. |
| [md-redline](https://github.com/dejuknow/md-redline) | MIT. Local-only inline threaded comments, multi-file, Mermaid, MCP server. Stores comments as hidden HTML markers inside the .md file. | Medium |
| [Proof](https://www.proofeditor.ai/) (Every) | Collaborative editor for humans and agents. Character-level provenance (human vs AI). Open source SDK snapshot; the hosted version has more features. | Medium. Provenance goes further than our bot attribution. |
| [Human Review](https://github.com/petergyang/human-review) | Google Docs-style comments on HTML/markdown, sent to the agent in one batch. | Low to medium |
| HedgeDoc, Outline, Docmost | Self-hosted collaborative markdown editors and wikis. | Low. Self-hostable, but no review workflow and not agent-native. |
| Spec Kit, OpenSpec, BMAD, Superpowers | Spec-driven development frameworks. | Not competitors. They produce the documents Ideation Factory would review. |

### Free hosted / closed source

| Product | Notes |
|---|---|
| [Commentary](https://commentary.dev/) | "Human decision layer for AI agents". Multi-file review, revisions, agent identity, CLI/SDK/MCP/API, GitHub and Azure DevOps integration. Free core tier; paid plans not finalized. Closest overall match, but closed and hosted. |
| [Notebind](https://notebind.com/) | "Documents for AI agents". CLI push/pull, comments API, suggested edits, share links. Free during public beta. |
| GitHub PRs on .md files | The default for most teams. Free and already where developers work. Comments go "outdated" when text moves. |

### Paid

| Product | Notes |
|---|---|
| [HackMD](https://hackmd.io/blog/2026/03/22/agentic-workflow-2026) | Free up to 3 teammates, $5/person/month after. Markdown-native, GitHub sync, agent CLI/API, version history. |
| [GitBook](https://gitbook.com/docs/collaborate/change-requests) | Change requests (PRs for docs), git sync, an AI agent that can be added as a reviewer. Aimed at docs teams, not design review. |
| Notion, Confluence, Google Docs | Where many companies already keep design docs. All are adding agents. |
| [Linear](https://linear.app/developers/agents) | Not a doc review tool, but its agent model (agents as "app users" acting as delegates for a human) is close to our "on behalf of" attribution. |

## Open source comparison

| | Open source | Self-hostable team server | Multi-user review | Agent-native |
|---|---|---|---|---|
| Plannotator | Yes (local tool) | No (team tier is paid/hosted) | Paid tier only | Yes |
| Crit | Yes | Partial (optional sharing) | No | Yes |
| md-redline / Human Review | Yes | No (localhost) | No | Yes |
| Proof | Partial (SDK snapshot) | No | Partial | Yes |
| HedgeDoc / Outline / Docmost | Yes | Yes | No | No |
| **Ideation Factory** | Yes | Yes (containers and a bucket) | Yes | Yes |

## Table stakes (not differentiators)

These are expected by users and offered by most competitors:

- Inline comments on rendered markdown, with replies and resolve/unresolve
- Getting reviewer feedback back to the agent
- CLI sync (Notebind, HackMD)
- An MCP server (Commentary, md-redline). **Required for 1.0.**
- Suggested edits (Notebind, Proof). **Required for 1.0.**
- Distinguishing bot vs human authors (Proof, Linear, GitHub Copilot)

## Differentiators

1. **Open source, self-hostable team review.** Ideas with status, assigned reviewers, teams and groups, a list across repos, and destinations that aren't git (Jira, Confluence, etc.).
2. **Sparse, deeply nested multi-file ideas diffed against a target-branch baseline.** No competitor found offers an "only show what changed vs main" view.
3. **Comments that survive restructuring and renames.** GitHub marks such comments outdated; only Crit explicitly keeps comments attached across rounds. The key is **remote editing with commands** (see Editing with commands in `architecture.md`): agents and people edit the idea in place with explicit operations (move this section, replace this sentence), so comments follow exactly instead of being guessed from a diff. Uploaded copies fall back to diff-based tracking, and comments that can't be placed are marked outdated with a link to the last version where they applied. As of 2026-10-25 this is treated as **the main differentiator** and the strongest technical moat.
4. **"On behalf of" attribution with purpose-specific tokens.** Matches where Linear and GitHub are heading. A supporting feature rather than a reason to adopt on its own.

## Risks

1. **Scope.** 1.0 now includes versioning and diffs, multi-file trees, comment re-anchoring, teams and groups, three token types, theming, a CLI, skills, an MCP server and suggested edits. Consider a 0.x that proves the core loop first (sync, view, comment, re-anchor, reply/resolve, with CLI and MCP), then add teams/groups and suggested edits.
2. **Plannotator could open source its team tier.** That would shrink the gap. Shipping the self-host story early is the hedge.
3. **Platform maturity.** Self-hosters would run our app on Rivet, a fast-moving project (its API still changes). Pin versions, keep the platform-specific code thin, and prove the self-hosted shapes (one VM, three VMs) before launch (see `mvp/spike-rivet.md`).
4. **"Why not just open a PR?"** PRs are free and the default. The README needs a one-line answer, for example: review before a branch exists, no code noise, comments that survive edits, targets that aren't git, reviewers who aren't engineers.

## Alternative considered

Contributing a team/self-host mode to Crit (written in Go, already has comments that persist across rounds) or to Plannotator's open source core. Less work, but it means giving up the self-hosted actor architecture, the multi-file and target-branch design, and the attribution model. Given how specific the vision is, building Ideation Factory as its own project is reasonable.

## Sources

- [Plannotator](https://docs.plannotator.ai/open-source), [sharing](https://docs.plannotator.ai/open-source/workflows/sharing), [pricing](https://help.plannotator.ai/workspaces/billing/plans-trials-and-seats.md)
- [Crit](https://crit.md/), [md-redline](https://github.com/dejuknow/md-redline), [Human Review](https://github.com/petergyang/human-review)
- [Commentary](https://commentary.dev/), [Commentary pricing](https://commentary.dev/pricing), [Notebind](https://notebind.com/)
- [Proof](https://www.proofeditor.ai/), [Every on Proof](https://every.to/podcast/transcript-how-we-use-proof-a-collaborative-editor-for-humans-and-ai)
- [HackMD agent workflows](https://hackmd.io/blog/2026/03/22/agentic-workflow-2026)
- [GitBook change requests](https://gitbook.com/docs/collaborate/change-requests), [GitBook Agent](https://www.gitbook.com/blog/introducing-docs-agent)
- [Linear agents](https://linear.app/developers/agents), [Copilot agent commit tracing](https://github.blog/changelog/2026-03-20-trace-any-copilot-coding-agent-commit-to-its-session-logs)
- [Spec Kit vs Kiro vs Claude Code](https://www.glukhov.org/ai-devtools/ai-coding-assistants/spec-kit-vs-kiro-vs-claude-code/)
- [celld](https://celld.dev) (the earlier self-hosting plan)
- [Rivet](https://github.com/rivet-dev/rivet)
