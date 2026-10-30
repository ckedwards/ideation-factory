# Experiment 1: the idea page

**Status:** prototype, throwaway. Front end only, with canned data. Nothing persists except the theme choice.

The question this answers: what should the idea page look and feel like? It should be writer-friendly and fit the plans in `idea.md`, `architecture.md` and `cli.md`.

## Run it

```sh
npm --prefix experiments/experiment1 install   # first time only
npm --prefix experiments/experiment1 run dev
```

Open http://localhost:5199/prototype/idea. The logged-in user is **Riley Park**, the idea's author, so author-only actions are available: changing the status, and accepting or rejecting suggestions.

The small **state** button in the bottom-left corner (dev builds only) shows the in-memory state, so you can see what each action changed.

To show it to people, `experiments/demo` packages both prototypes as one password-protected Cloudflare site (see its README).

## The page

Three panes, each scrolling on its own. The page state lives in the URL: `file`, `v` (the version you're viewing), `compare` (what you're comparing against) and `view=feed`.

### Left: navigation

- **Idea title and status.** Click to open Details.
- **Comments feed**, with the idea's open-thread count. Opens the feed in the center (see below).
- **Files:** the idea's files as a tree. Single-child folders are collapsed, and each file shows a change badge (A/M) and its open-comment count. **Changed / All** hides or shows unchanged files.
  - The line under the toggle is a status, not a control. Normally it reads "Changed vs main". In compare mode it becomes a green **Comparing** strip ("Files changed since v1 → v3"), and the badges and filter follow that base.
  - While you're viewing an older version, the heading reads "Files in v2".
- **Contents** for the current file: H2–H4, nested.
  - The section you're reading is highlighted as you scroll.
  - Each entry shows its open-comment count and a dot if the section changed vs `main`.
  - Clicking jumps to the section, or to its line in source view.
- **Theme:** Auto / Light / Dark / High contrast.

### Center: the document

- **Toolbar:** the file path (with **@ v2** when viewing an older version) and status chips. "Changes v1 → v3 ✕" shows while comparing, and "Markdown source ✕" shows in source view. Markdown source is an advanced option behind a small `</>` button at the right.
- **Rendered document:** sections changed vs `main` get a thin rail in the left margin. Files that are entirely new vs `main` get none, since the tree already says "new". Internal `.md` links open that file, and code links point to the repository.
- **Compare mode** shows a rendered redline:
  - Unchanged blocks read normally.
  - Edited lines show inline word changes.
  - Added and removed blocks are marked in the margin.
  - Blocks that moved without edits are labeled **Moved**, not shown as a delete plus an insert.
- **Older version:** a quiet one-line banner stays under the toolbar. It reads "Older version: v2 · the latest is v3", plus who uploaded it, when, and "read only". It has **What changed since v2** and **Back to latest**. The document gets only a thin warning-colored edge on the left. Comments can only be added on the latest version.
- **Comments feed** (`?view=feed`): one timeline for the whole idea, oldest first, like a GitHub PR's Conversation tab.
  - **Opening post:** the idea description.
  - **Events:** version uploads (each changed file links to that version's changes), status changes and review requests.
  - **Threads:** every thread in every file.
    - The header says what the thread is attached to: **§ Section comment** with its path (e.g. Proposal › Conflicts), **Text comment** ("in Proposal › Conflicts") or **Whole file**.
    - Section comments preview the section as an outlined box (heading, level, first line) with a note that they apply to the whole section, including any subsections. Text comments show the line with the quote highlighted.
    - **View in document** opens the file with that comment highlighted.
  - **Resolved threads** collapse to one line with **Show**.
  - **Filters:** Everything / Comments only / Open threads, plus the author filter.
  - **Summary box at the end:** status, open threads per file, and where each reviewer is.

### Right: Comments, Versions, Details

- **Comments**
  - **Filters:** Open / Resolved / All, an author filter (Everyone, People, Bots for people, Automated bots, Me, My bots, following the `cli.md` filter names) and Suggestions only.
  - **Anchored view** (default):
    - **Text comments** sit in the panel level with their text and move with the document as it scrolls. Scrolling over the panel scrolls the document.
    - **Section comments** sit in the document, after the section's last line, inside an outline around the section. Outlines nest: an H3 box sits inside its H2 box, and the H2's comments come after its subsections.
    - **At the end of the document**, a panel holds **Whole file** comments (with a box to add one) and, only when the file has some, an **Outdated** tab.
  - **List view:** every comment for the file in one list (on the file, in the text, outdated).
  - **When Anchored isn't available** (comparing, source view, or a narrow window): the Anchored button is disabled with a tooltip, List shows as selected, and a short notice explains why, with **Stop comparing** or **Show rendered**. Anchored comes back afterwards.
- **Versions**
  - **Top bar:** "Viewing v3 ▾ · Compare: Off ▾".
    - The Compare picker starts with **No comparison**. Below a heading, "Show changes in the document since…", it lists `main` and the older versions; picking one turns on compare mode.
    - If you switch to a version at or before the base, the comparison clears.
  - **Timeline:** newest first, ending at `main`.
    - Each version shows its message, who uploaded it, the files it changed (clicking one opens that change) and which reviewers last saw it.
    - **Compare** on an older version or on `main` starts a comparison, and the range being compared is shaded.
- **Details**
  - **Notifications:** **Subscribe / Unsubscribe**, with why you're subscribed ("because you wrote this idea"). Unsubscribed, you only hear about it if someone asks you to review it.
  - **Idea info:** title, description, status (author only), author, team, source branch and target.
  - **Reviewers:** each one's last-seen version. For anyone behind, **What's new for them** compares from the version they last saw. Groups are listed with their members.

In the feed, the panel shows only Versions and Details, because the feed is the comments.

### Creating and acting on comments

- **Select text** in the latest version to get **Comment**, **Suggest edit**, or **On "Section"** (comment on the whole section). ⌘↵ posts and Esc cancels. A selection that spans paragraphs keeps only its first line.
- **Whole-file comments** are added from the end of the document (Anchored view) or the top of the list (List view).
- **Reply** and **Resolve / Reopen** are on every thread.
- **Accepting a suggestion** (author only) creates a new version with the change applied and re-anchors the comment to the new wording. **Reject** resolves it.
- **Outdated comments** (their text isn't in the version you're viewing) show the original quote and **View in v2 →**, which opens the last version where that text was, with the comment back in place. There's no re-attaching; reply or resolve. The comments feed shows them the same way: "isn't in the latest version; it was last in v2", with **View in v2**.

### Media

Images are uploaded so they render; everything else links to the source (see Media in `architecture.md`).

- **Uploaded images** render in place, with a caption: alt text, file name and size. They're part of the version they came with, so viewing v2 shows v2's image.
- **Changed images:** in the changes view, an image whose contents changed (same markdown line) shows **Image changed** with **Before** and **After** side by side.
- **Images that weren't uploaded** show a dashed placeholder with the alt text, the reason (e.g. "Not uploaded: 14.2 MB is over the 10 MB limit for images") and **View on GitHub**.
- **External images** (`https://…`) follow the deployment setting a site admin chooses:
  - **Click to show** (the default): a placeholder explaining why it isn't loaded, with **Show image**.
  - **Always:** loads like any image.
  - **Never:** a placeholder with a plain link.

  The dev control in the bottom-left corner switches between them.
- **The upload size limit** is also a deployment setting (10 MB here), and the skipped-image message names it.
- **Links to other files** (PDF, video, code, docs outside the idea) open on GitHub at the idea's branch, with a file-type badge ("PDF · GitHub", "Video · GitHub").

### Attribution

Every comment, reply, version and event shows who did it:

- People get an avatar and their name.
- Bots acting for a person show "🤖 planbot on behalf of Riley Park" ("for Riley Park" where space is tight).
- Fully automated bots show "🤖 archbot" with an **automated** tag.

Bot comments carry a violet rail, so agent feedback is distinguishable at a glance. This follows the three token purposes in `idea.md`: me, a bot associated with me, and a bot.

## The canned data

There are two ideas. `?idea=` picks one when the page loads; without it, it's the offline-sync idea.

- **`?idea=mvp`, "Ideation Factory MVP architecture"** (Dogfood team): the real docs from the repository's `mvp/` folder, read at build time, so the page always shows their current text, diagrams included. It's one version, with every file new against `main`. Maya and Sam are reviewing, with four example comments: Maya on § MVP scope, Sam on "One Durable Object per idea." (with Riley's reply), archbot on the back end's § Self-hosting, and a resolved whole-file note from "planbot on behalf of Maya" on the cli doc. If the docs change under those comments, they become outdated, as the real product would show it. Links between the docs work, including links to a heading in another doc.
- **The offline-sync idea** (the default) is described below.

- **Idea:** "Offline-first sync for the field app" by Riley Park, Mobile team, `acme/field-app` · `riley/offline-sync` → `main`. Status is Requesting review.
- **Reviewers:**
  - Maya Ortiz has seen v3.
  - Devon Fox last saw v2.
  - The Platform team group (Sam Achebe) hasn't opened it yet.
- **Versions:** v1 by Riley, v2 by "planbot on behalf of Riley", v3 by Riley. `main` is a snapshot of two files.
- **Files** (5, sparse across `docs/` and `services/sync/`):
  - `docs/README.md` is unchanged vs `main`.
  - `docs/architecture/overview.md` is modified vs `main`.
  - The rest are new.
- **Restructuring:** "Rollout" moved below "Proposal" in v3. Devon's v2 section comment still finds it, and the redline marks it as moved.
- **Nested sections:** "Proposal" (H2) contains "Sync endpoint" and "Conflicts" (H3s). There are comments on the H2 (archbot), on both H3s (Maya with a planbot reply, and Sam), and on a line inside "Conflicts" (Devon).
- **Outdated comments:**
  - Maya's v2 comment on "reuse the existing REST endpoints" (that text was removed in v3).
  - Devon's resolved comment on the old "Last write wins" rule.
- **Suggestions:** two are open. Maya's p95 rewording and typobot's spelling fix ("typobot on behalf of Devon").
- **Media:**
  - **README:** a sync-flow diagram under "Proposal" that changed between v2 and v3; an external badge under the title; and PDF and video links in "Rollout".
  - **conflict-resolution.md:** a screenshot of the conflict banner.
  - **overview.md:** a 14.2 MB whiteboard photo that was skipped for size.
- **Idea activity:** created as a draft, review requested, and status changes (Requesting review → Changes in progress → Requesting review). Changing the status adds an event.

## Design

- **Type:**
  - Headings: Source Serif 4.
  - Reading text: Literata at 1.125rem, 1.72 line height, 40rem line length.
  - Interface: Inter.
  - Code and paths: JetBrains Mono.
- **Color:**
  - Warm paper background and a spruce-green accent.
  - Highlighter yellow for comment anchors and section outlines.
  - Violet only for bots.
  - Green for comparisons and additions, and a warm warning color for older versions.
- **Themes:** light, dark (Auto follows the system) and high contrast.
  - Everything is a CSS variable in `src/theme.css`, so an organization can re-theme by overriding `:root`.
  - Sizes are `rem` on a token spacing scale. The CSS has no pixel values; the only ones are in the JavaScript that positions comments beside the text.
- **Mermaid** diagrams are drawn with [Pele](https://github.com/obsidianmd/pele) (Obsidian's MIT-licensed renderer, no runtime dependencies), **asynchronously but preloaded**:
  - **Preloading:** most architecture documents have diagrams, so the app starts fetching Pele (its own chunk) when it starts, plus the types those documents use most: flowchart, sequence, class, state, ER, C4 and architecture. Other types load the first time they're needed. In a production build, Pele and those types have arrived about 300 ms after the page starts loading.
  - **Rendering:** Markdown still renders at once. A diagram not drawn yet shows a "Drawing diagram…" placeholder about the size of a diagram, and the drawing replaces it when ready.
  - **Caching:** drawn diagrams are cached by their source, so switching versions or re-rendering never redraws or flickers.
  - **Theming:** its CSS variables (`--pele-fg`, `--pele-line`, `--pele-surface`, …) are mapped to the page's tokens, so a diagram follows light, dark and high contrast without being redrawn.
  - **Source:** each diagram sits in a bordered box with **Mermaid source** below it, folded away. The source is what's versioned and commented on. Labels inside the drawing don't count when matching comment quotes.
  - **Safety:** links and images inside diagrams are turned off, since diagrams come from people's documents.
  - **Errors:** a diagram Pele can't draw shows its source with "Couldn't draw this diagram (line 3): Expecting 'ACTOR', got 'NEWLINE'".
  - **Example:** the README's "Sync endpoint" sequence diagram.
  - **Size:** the main bundle stays at about 134 kB gzipped. Pele's core is a separate 17 kB chunk, and each diagram type is its own small chunk.

## Code map (`experiments/experiment1/src`)

| File | What's in it |
|---|---|
| `main.tsx` | Route `/prototype/idea` (TanStack Router), store provider |
| `IdeaPage.tsx` / `.css` | The page: panes, comments views, Versions, Details, pickers, file tree |
| `Feed.tsx` / `.css` | The comments feed |
| `shared.tsx` | Comment card, selection composer, markdown view, contents, status, theme, author labels |
| `useIdeaView.ts` | Derives the current file, version, comparison, comment placement and file entries |
| `diagrams.ts` | Mermaid drawing with Pele: preloading, asynchronous drawing, the cache, placeholders |
| `lib.ts` | Markdown rendering, anchoring, section wrapping, diffs and redline, URL state |
| `store.tsx` | In-memory state and actions (comments, replies, suggestions, versions, status, activity) |
| `data.ts` | Canned data |
| `theme.css` | Tokens, themes and shared styles |
| `DevState.tsx` | Dev-only state inspector |

## Known prototype shortcuts

- Comment anchors match rendered text exactly (first occurrence). The planned approach is different: anchors on the Markdown source, followed through each version's diff from its base, with moved blocks and renamed headings tracked and no fuzzy matching. See Keeping comments anchored in `architecture.md`.
- Moved-block detection only catches blocks that moved without edits.
- There are no file renames in the data; the CLI would report them.
- The anchored view needs a wide window (about 1200px or more); narrower windows get the list.
- Nothing about notifications, the idea list, teams or auth is prototyped.

## Open questions

1. Should section rails show changes vs `main` (as in the plan) or vs the reader's last-seen version? Or should the reader choose?
2. Do reviewers need their own review state (approved / changes requested), or is the idea-level status enough?
3. Accepting a suggestion creates a version authored by the author ("Accepted a suggested edit"). Should the version history credit the person who suggested it?
4. Should there be idea-level comments (a comment box at the end of the feed, like GitHub)? The plan only defines comments on a file, a section or text.
5. Section comments sit in the document in the anchored view. Is that the right trade-off, or should the outline stay and the comments collapse to a "§ 2 comments" marker that opens them in the panel?
