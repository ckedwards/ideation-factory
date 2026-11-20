# Design: rich text for comments and pages

**Date:** 17 November 2026. **Status:** agreed, all twelve [choices](#choices) decided on 17 November 2026; not built yet. **Written against:** `feat/reader-view` at 67b957d.

## In short

- **One editor, used everywhere text is typed:** comments, replies, review summaries, suggested edits and the page editor. You type and see the result (bold is bold, a list is a list), and a switch shows the Markdown instead.
- **Comments get GitHub's box:** a toolbar on top, the text, the buttons at the foot, the same shortcuts, and Markdown typed by hand still works.
- **Markdown stays what's stored.** Nothing changes in the database, the API, the cli or what agents read and write.
- **The library is Milkdown** (`@milkdown/kit`, MIT), decided on 17 November 2026. It is ProseMirror with the same Markdown parser family the app already uses, and it was the only candidate that changed no block's meaning in a test over this repository's own Markdown (see [Libraries](#libraries)).
- **The page editor is one document under a toolbar,** like any document editor: click anywhere and type. It replaces editing one block at a time, and it saves to the idea's draft by itself.
- **Tables are edited as a grid,** in pages and in comments.
- **Cut and paste moves comments with the text,** as Google Docs does. Paste as plain text doesn't.
- **One way to a new version, everywhere:** the draft. A suggested edit is accepted by adding it to the draft, in the web app, the cli and the API alike.

## Where things are today

| | Today | Where |
|---|---|---|
| Reading a comment | Already Markdown: the text is parsed and drawn by the document's own renderer, in its compact size | `shared.tsx` (`MarkdownView variant="compact"`) |
| Writing a comment | A plain text box with no help. Nothing says Markdown works | `CommentBox.tsx`, `CommentCard.tsx` (reply), `SelectionMenu.tsx`, `ReviewPanel.tsx` |
| A comment elsewhere | The raw text, cut short: asterisks and backticks show in the inbox, in email and in the cli | `server/src/idea/notify.ts`, `mail/notification.ts`, `cli/src/commands/*` |
| Editing a page | One block at a time: Edit opens that block's Markdown source in a text box, and saving sends it to the idea's shared draft | `IdeaEditor.tsx`, `editing.tsx`, `core/src/draft.ts` |
| Suggesting an edit | The selection's Markdown source in a text box | `SelectionMenu.tsx`, `core/src/suggest.ts` |
| The parser | One, in `core`: micromark with GitHub's extensions and front matter, giving an mdast tree. The page, comment anchors and edits all come from it | `core/src/markdown.ts` |

So "Markdown in comments" is half there. What's missing is help writing it, and the places that show a comment without rendering it.

## Choices

1. **Decided: rich text first, with a switch to Markdown, in place of GitHub's Write and Preview tabs.** GitHub's own box is a Markdown source box with a preview. You asked for rich text and for GitHub's box, so this takes GitHub's layout, toolbar and shortcuts and puts rich text inside. With rich text there's nothing to preview, so the second tab becomes "Markdown".
2. **Decided: Milkdown is the library.** The case is under [Libraries](#libraries).
3. **Decided: the page editor is one document under a top toolbar,** not a box for each block.
4. **Decided: tables are edited as a grid.**
5. **Decided: the page saves to the draft by itself,** after a pause in typing, with no Save button. The bar says "Saved to the draft".
6. **Decided: Tab leaves the editor, except in a table.** Everywhere else Tab moves focus, so the keyboard can always leave the editor, and lists indent with ⌘] and ⌘[. In a table, Tab and Shift+Tab move between cells.
7. **Decided: the switch is remembered for each browser,** not for each account.
8. **Decided: cut and paste carries comments.** ⌘X then ⌘V moves the text and its comments. ⌘⇧V pastes plain text, and the comments stay behind.
9. **Decided: a suggested edit can only be added to the draft.** "Accept as a new version" goes from the web app.
10. **Decided: the cli and the API lose it too.** Fewer versions is the point: changes gather in the draft and Commit makes one version of them. `acceptSuggestions` loses `into: 'version'` and `outdateDraft` (nothing it does can outdate the draft any more); `ideaf comment accept` always adds to the draft, and its `--draft` and `--outdate-draft` flags go. Agents' `accept_suggestions` tool adds to the draft too.
11. **Decided: a two-day spike on the clipboard before the page editor is built** (see [A spike before the page editor](#a-spike-before-the-page-editor)). Comments and suggested edits don't wait for it.
12. **Decided: not in this work:** uploading images from the web app, and @mentions. The editor leaves room for both.

## What stays true

These are the rules the rest follows from.

1. **Markdown is what's stored.** The editor reads Markdown and gives Markdown back. No new stored format, no schema or API change.
2. **One parser.** What the editor reads and writes agrees with `core`'s parser, so what you see while typing is what the page shows after.
3. **A block nobody changed is never rewritten.** Every Markdown editor re-styles some source when it writes it back (see the measurements). So the editor only writes a block whose content changed, and gives back the original source for the rest.
4. **Raw HTML never runs.** Decided on 18 November 2026: it's drawn, on the page and in the editor alike, once DOMPurify has cut it down to a short allowlist: text, headings, lists, tables, links, `details` and `summary`, and the attributes `href`, `title`, `open`, `colspan`, `rowspan`, `align` and `start`. Everything else goes: script, event handlers, styles, classes, ids, frames, forms. An image becomes its alt text, since pictures from other sites follow the deployment's setting (a Markdown image is the way to show one). The list widens only when there's a need. An HTML block that leaves an element open is drawn as one with the blocks up to the one that closes it, the Markdown between them inside; HTML that closes what it didn't open is shown as its source. Inline HTML in a paragraph stays as text. Everything the editor makes itself is its own node types, never HTML strings.
5. **Edits go where they go today:** to the draft as block changes, and from there to commands. Comments keep following edits by the same rules.
6. **The plain box still works.** The Markdown side of the switch is the text box the app has now, as tall as its text. Until the editor has loaded and drawn, the text shows as the comment will read, so nothing moves when the editor takes its place.

## The comment box

![The comment box under an idea's activity: a toolbar, a comment with a list, bold, code and a link, and the buttons at the foot](design-review/rich-comment-box.png)

*The comment box at its widest, on the Overview tab. The text reads as it will when it's sent.*

**Taken from GitHub:**

- One bordered box: toolbar, text, buttons.
- The toolbar: bold, italic, strikethrough, heading, quote, code, link, bulleted list, numbered list, task list. Table is added at the end.
- **Heading** opens a menu: Normal text, and Heading 1 to Heading 6, the current one checked.
- **Link** opens a box with the link's text and its address. The text starts as the selected text (or, in a link, its text and address). Left empty, the link's text is its address. Unchanged text keeps its formatting; changed text replaces it. On the Markdown side the box types `[text](address)`.
- **Table** opens a grid for its size (columns, and rows counting the header). With the caret in a table it opens the table's menu.
- **Right click** opens the editor's own menu where it has one: in a table, the table's menu (each item with an icon, acting on the cell clicked, with Row above and deleting the row greyed out on the header row); on a link, Edit link, Open link and Remove link; on drawn HTML, Edit in source view. Elsewhere the browser's menu shows, spelling suggestions and all. The menu key and Shift+F10 open the same menus at the caret.
- **The link box opens under the selected text.** On the Markdown side it opens under the Link button.
- **The caret stays marked while focus is in the toolbar or one of its menus or boxes** (heading, table, More, the link box, a right-click menu): the selection stays highlighted, or a caret is drawn where it was. Not on the Markdown side, where the plain box can't draw one.
- **What can't apply is greyed out,** and its tooltip says why. In a code block: only Quote (it can go around the block); nothing else. In a table cell: no headings, quotes or lists. Headings and lists don't mix: no list in a heading, no heading in a list, and typing `# ` in a list item or `- ` at a heading's start stays text. With an HTML block (or other source-only block) selected: everything; it's only editable in source view. Their keys do nothing there either. On the Markdown side nothing is greyed out, since the toolbar only types Markdown.
- Its shortcuts (see [Keyboard](#keyboard)).
- Typing Markdown works: `**bold**`, `` `code` ``, `- `, `1. `, `> ` and `# ` turn into what they mean as you type.
- Pasting a web address over selected text makes it a link. Pasting Markdown text is read as Markdown.
- Enter in a list makes the next item, and Enter on an empty item ends the list.

**Different from GitHub:**

- The text is rich. The Markdown icon (M↓) at the end of the toolbar, named "View Markdown source", shows the source in the plain box, and its tooltip then says "View formatted text"; and the toolbar works there too (it wraps the selection in the Markdown).

  ![The same comment with Markdown switched on: its source, with asterisks, backticks and a link in brackets](design-review/rich-comment-markdown.png)

  *The same comment with Markdown on.*

- No attachments, mentions, saved replies or slash commands yet.

**Sizes.** The comment column is 22 to 24rem, which doesn't fit eleven buttons and the switch. Buttons that don't fit go into a "More" menu, in toolbar order, with their shortcuts beside them.

![The comment box in the comments column: five buttons and a More menu, shown closed and open](design-review/rich-comment-narrow.png)

*In the comments column: the five most used, then More.*

**Replies.** Reply opens the same box in the thread, with focus in it. Cancel, or Esc, closes it.

![A reply being typed in a thread, with the toolbar above it and Cancel, Add to your review and Reply below](design-review/rich-reply.png)

**Two boxes together.** Where a form has two boxes (a suggestion and its reason), only the box with focus shows its toolbar.

**Where it's used:**

| Box | Flavor |
|---|---|
| Comment on a whole file, and on the idea | Full |
| Reply in a thread | Full |
| Comment on a selection or a section | Full |
| A review's summary, and a pending comment being changed | Full |
| The replacement in a suggested edit | Inline: marks and links only, no blocks |
| The reader view's threads and selection menu | The same components, so the same boxes |

**The rest of comments:**

- **Excerpts:** the inbox row, the notifications page, email and the cli's lists show a comment's plain-text form (core's `plainLine`, which the draft panel uses too), so syntax doesn't show. Email quotes the inbox's excerpt, so it reads the same; `ideaf comment show` gives one thread's Markdown as written.
- **Compact styles:** check every construct in a comment at the compact size: tables, code blocks, task lists, quotes, nested lists and images. A comment's headings step down from 1.5em (heading 1) to 0.85em (heading 6), smaller than a document's but still a level apart.
- **Limits:** a comment stays at most 20,000 characters of Markdown. The box counts the Markdown, not the visible text, and says so near the limit.

## The page editor

![The file as one editable page under a toolbar: undo and redo, a text style menu, formatting, lists, quote, code block and table, then Saved to the draft and the Markdown switch. Two changed blocks carry a rail, and both are listed in the draft panel](design-review/rich-page-editor.png)

*Edit on the Files tab. The toolbar runs across the top of the document and stays there as it scrolls.*

Edit turns the file into one surface: click anywhere and type, Enter makes a paragraph, and blocks are added and removed by typing. The Edit, Add below and Delete buttons on each block go away. This is the "full editor" `architecture.md` says writes to the same draft.

**The toolbar,** left to right:

| Group | What's in it |
|---|---|
| History | Undo, redo |
| Style | A menu: Text, Heading 1 to Heading 4 |
| Text | Bold, italic, strikethrough, code, link |
| Lists | Bulleted, numbered, task |
| Blocks | Quote, code block, table |
| At the right | "Saved to the draft" (or "Saving…", or what went wrong), and the Markdown switch |

It's the comment box's toolbar with history, the style menu and code block added. A button is lit when the caret is in that kind of text.

**What stays as it is:** the idea's bar (Editing the draft, Commit, Preview, Close editor), the draft panel with each change and its Undo, the rail beside changed blocks, and the file list. The file's name stays above the document.

**Each kind of block:**

| Block | In the editor |
|---|---|
| Paragraphs, headings, lists, quotes | Typed in place |
| Tables | A grid (see [Tables](#tables)) |
| Code blocks | Typed in place, in the code face. A Mermaid block shows its code while the caret is in it and its diagram otherwise |
| Images | Shown as on the page. Changed in Markdown |
| Raw HTML | Drawn as the page draws it (rule 4) and read only, marked with an HTML icon (`</>`) in its top-right corner, whose tooltip says "HTML blocks are only editable in source view". An opening HTML block and its closing one are one read-only unit with the Markdown between them (between `<details>` and `</details>`, say): selected and deleted as one, and typing over it does nothing. All of it is changed on the Markdown side |
| Front matter, footnotes, link definitions | Shown as they are, and not typed in. Changed in Markdown |

**The Markdown switch** shows the whole file's source in the plain box. What's changed there goes to the draft the same way.

### How it reaches the draft

The draft doesn't change shape: it stays a list of changes to blocks, each checked against the text it was made on.

- **Each block on screen remembers which draft blocks it came from.** A list is one block on screen and one draft block for each item.
- **After a pause in typing (about a second), when focus leaves, and before Commit, Preview or Close editor,** every block whose content changed is written back as Markdown and sent as draft changes: an edit, an insertion or a deletion.
- **A block that didn't change sends nothing,** so its source is untouched (rule 3).
- **Other people's changes** arrive as they do now. A block you aren't typing in is replaced with theirs. A block you are typing in is refused as outdated when it's saved: the bar says so, your text stays on screen, and you choose theirs or yours.
- **Not live co-editing:** no shared cursors, and no merging of two people's typing in one block. The draft's rule stays: nothing is merged by guessing.

### Moving text

This follows Google Docs.

| What you do | What it is | Comments on that text |
|---|---|---|
| Cut and paste (⌘X, ⌘V), or drag a selection | A move | Go with it, marked *moved* |
| Cut and paste as plain text (⌘X, ⌘⇧V) | A deletion and new text | Stay behind, and become *outdated* |
| Copy and paste (⌘C, ⌘V) | A copy | Stay on the original |
| Paste the same cut a second time | A copy | Already moved with the first paste |

- **Any amount of text:** whole blocks, several blocks, a section with its heading, or a few words out of a paragraph.
- **Between files of the idea** as well as inside one.
- **Until it's pasted, a cut is a deletion.** The draft panel shows its comments as about to be outdated. Pasting turns the deletion into a move, and they show as moved.
- **A comment that's only partly inside the cut** keeps the part that stayed, as it does today when part of its text is replaced.
- **A block's whole text is the block:** a cut from the start of a block's text to its end (a triple click) takes the block, as Google Docs' triple click takes the line break too. A paste at the start of a block goes above it.
- **Narrowed by the spike:** a table row has no identity of its own (the draft knows a table as one block), so a cut row is an edit of its table and pastes as a new table, its comments outdated. Dragging into another file is a copy until the page editor makes it a move. A paste of several paragraphs into the middle of a block splits it, and step 5's function gives the block's identity to the half that kept its text.

**How:** a block keeps its draft identity through a cut, so when it's pasted the editor knows it as the same block in a new place and sends a move. Plain-text paste and copy carry no identity, so they arrive as new text.

### What `core` and the API need

These are the new work, and the riskiest part:

1. **A function in `core`** that turns "these draft blocks, now this Markdown" into edits, insertions, deletions and moves, with golden tests. Lists and tables are where it earns its keep.
2. **Several changes in one request,** applied together or not at all. Today it's one change a request.
3. **The draft holds the difference, not the history.** Successive edits to one block by one person fold into one change, and a block put back as the latest version has it leaves no change. Today every save would add a line to the draft panel.
4. **Changing a heading's level.** Today a draft edit can only rename a heading.
5. **A move as a draft change.** Whole blocks and sections use the `move` command agents already have.
6. **A command for moving part of a block's text.** `core` already follows any range of text from one place to another (it's how `move` carries comments), but no command asks for less than a block.

**Undo (⌘Z)** undoes typing, cuts and pastes. Because the draft holds the difference (item 3), undoing a saved change takes it back out of the draft: a cut that's undone leaves its comments exactly where they were. The draft panel's Undo still removes a change whole.

## Tables

![A table being edited: the caret in a cell, the cell outlined, and the toolbar's table menu open with insert row and column, align column, and delete row, column and table](design-review/rich-page-table.png)

*The caret is in a cell, so the table button opens the table's menu.*

- **Adding one:** the table button, with the caret outside a table, inserts three columns with a header row and two rows.
- **Changing one:** with the caret in a table, the same button opens a menu: insert a row above or below, insert a column left or right, align the column, and delete the row, the column or the table.
- **Typing:** cells take text with bold, italic, code and links. Tab goes to the next cell and adds a row after the last one. Shift+Tab goes back. Enter goes to the cell below. The arrow keys leave the table at its edges.
- **Pasting:** a table copied from a spreadsheet or a web page arrives as a table.
- **Wide tables** scroll sideways in place, as they do on the page.
- **In comments:** the same grid. Table is on the toolbar where it fits and under More where it doesn't.
- **What Markdown allows:** one header row, no merged cells, and no lists or paragraphs inside a cell. The editor doesn't offer what the file can't hold.

**How a table is written back.** Tables are the block Markdown editors re-style most: with Milkdown's stock writer, 68 of this repository's 80 tables came back padded differently. So the editor writes tables itself, in the file's style: padded into columns only if the file's tables are, and with the divider row kept as it was unless the columns changed. A first version of that writer brought back 53 of the 80 exactly, and none with a changed meaning. A table nobody edits is never rewritten at all (rule 3).

## Suggested edits

- **Writing one:** the replacement opens in the inline flavor, starting from the selection's source widened to whole formatting, as now. A suggestion that spans blocks stays unavailable, as now.

  ![Suggesting an edit to selected words: the replacement in a small box with bold, italic, strikethrough, code and link, and the reason's box below it](design-review/rich-suggest.png)

- **Reading one:** a thread shows the old and new text rendered, with the change marked, in place of raw source.

- **Accepting one:** Add to draft is the only way. "Accept as a new version" goes, so everything changed in the web app reaches a version the same way: it's in the draft, and Commit makes the version.

  ![A suggested edit in a thread. Today: the replacement shows asterisks, with Accept as a new version, Add to draft and Reject. Proposed: the word is bold, with Add to draft and Reject](design-review/rich-suggestion-thread.png)

What follows from accepting only into the draft:

- **The page already says a draft is waiting** ("The draft has 1 change, by …") and Edit reads "Open the draft", so an added suggestion isn't lost from view.
- **Accepting several at once** adds them all to the draft.
- **The "this would make the draft's changes outdated" question goes** from the web app, since nothing there makes a version around the draft any more.
- **The reader view's threads** lose the button too. They use the same card.
- **`architecture.md`** (Suggested edits, Drafts) needs the same change when this is built.

## Libraries

### What to add

| Package | Version now | Licence | What for |
|---|---|---|---|
| `@milkdown/kit` | 7.23.0 (27 October 2026) | MIT | The editor: ProseMirror, the CommonMark and GFM node types, Markdown in and out through remark, undo, clipboard, typing rules, and table editing (rows, columns, alignment, moving between cells) |
| `dompurify` | 3.4.17 (12 October 2026) | MPL-2.0 or Apache-2.0 | Cutting raw HTML down to the allowlist before it's drawn (rule 4) |

Those are the two new dependencies. Pin them exactly, as `@base-ui/react` and `pele` are.

Already in the app, and used for the rest:

- **`@base-ui/react`** for the toolbar, the "More" menu, the link popover and tooltips.
- **`core`'s parser** for everything that's read, unchanged.
- **`diff`** for showing a suggestion's change.

### Why Milkdown

The deciding question is rule 3: how much does an editor change Markdown it was only asked to open? An agent or a person pulls these files back into a repository, and comments are anchored to them.

I ran each candidate over the 37 tracked Markdown files in this repository (1,357 top-level blocks), opening and writing back each block with no edit.

| Candidate | Identical | Restyled only | Meaning changed |
|---|---|---|---|
| Milkdown 7.23, set to the file's style | 90.6% | 9.4% | **0** |
| Tiptap 3.34 with `@tiptap/markdown` | 89.5% | 8.9% | 1.6% (22 blocks) |
| Lexical 0.53 with `@lexical/mdast` (experimental) | 90.7% | 7.0% | 2.3% (31 blocks) |
| Lexical 0.53 with `@lexical/markdown` | 93.7% | 4.4% | 1.8% (25 blocks) |
| `prosemirror-markdown` 1.13 | 75.3% | 16.2% | 8.5% (no tables) |

"Restyled only" means the source differs but `core`'s parser reads the same tree. "Meaning changed" means it reads a different one.

- **What Tiptap and Lexical got wrong:** raw HTML dropped or turned into entities, a footnote definition escaped into plain text, and code blocks, tables and paragraphs nested in list items moved or re-indented.
- **Why Milkdown got none wrong:** it reads and writes through remark, which is the parser `core` uses, with ProseMirror in between. The others bring a second parser (Tiptap uses `marked`, `@lexical/markdown` its own).
- **What Milkdown restyles:** tables (68 of 80 were re-padded), `[` and `~` gaining a backslash, bare web addresses gaining `<…>`, and some list spacing. Rule 3 keeps that to blocks someone actually edited, and anchors compare plain text, so comments aren't disturbed.
- **Size:** about 150 KB gzipped measured alone. Tiptap and Lexical measured 161 and 162 KB with a comparable set of features. Part of Milkdown's is the parser the app already ships.

### Not adding

| Library | Why not |
|---|---|
| **Tiptap** | The biggest community and the best documentation, and the second choice. Its Markdown goes through a second parser, which is where its 22 changed blocks come from |
| **Lexical** | `@lexical/mdast` uses the same parser family as `core` and is worth watching, but it's marked experimental and may change in any release |
| **MDXEditor** | Lexical inside, aimed at MDX, with its own interface and styles to override |
| **BlockNote** | A Notion-style block editor. Its own Markdown export is named `blocksToMarkdownLossy`. Core is MPL-2.0 and its extra packages are GPL or paid |
| **Bare ProseMirror** with `@handlewithcare/remark-prosemirror` | The same design as Milkdown without the framework, and more to write and own. It's the fallback if Milkdown stalls |
| **Crepe** (Milkdown's ready-made interface) | Brings its own theme and CodeMirror. The app has its own components |
| **CodeMirror 6** for the Markdown side | Syntax colouring only. GitHub uses a plain box and so does the app. Add later if wanted |
| **GitHub's elements** (`markdown-toolbar-element`, `paste-markdown`, `text-expander-element`) | MIT, but they drive a text box only. One toolbar has to drive both sides of the switch, and the text-box half is small. Look at `text-expander-element` again with @mentions |

### Risks

- **Milkdown is a small project,** mostly one maintainer, though it releases steadily (7.22 in August, 7.23 in October). All of it sits behind one component in `ui`, and the fallback keeps the same node types and the same remark serialiser.
- **Its plugin system takes learning.** The wrapper should be the only code that knows it.
- **The page editor depends on new work in `core`** (see [How it reaches the draft](#how-it-reaches-the-draft)). That, not the library, is the part most likely to take longer than it looks.
- **Tables are re-styled most.** The table writer above is ours to write and test.
- **Moving text is our code on ProseMirror, not Milkdown's.** Milkdown passes it through and adds nothing, and its own clipboard plugin will need wrapping or replacing. The spike below is there to find out before the page editor is built on it.

### A spike before the page editor

**Done: go, on Milkdown** ([the results](spike-editor-clipboard.md)). Every case below passed in Chromium, Firefox and WebKit, except a table row, which is narrowed under [Moving text](#moving-text). It took a wrapper of our own in front of Milkdown's paste, which flattens a lone paragraph into text. Not yet tried in Safari itself.

**Recommendation:** spend two days proving the clipboard cases in a real browser before building the page editor. Comments and suggested edits don't use any of this, so they don't wait for it.

**Why:** whole-file editing and cut and paste carrying comments moved the hard part from the library to our own code underneath it. The Markdown side of Milkdown is measured. This side isn't.

**Already checked,** outside a browser, with Milkdown's real editor: a block can carry its draft identity, the identity survives the block being cut out and put back elsewhere, and it stays out of the Markdown.

**What the spike has to show,** in Chromium, Firefox and Safari:

| Case | Passes when |
|---|---|
| ⌘X then ⌘V on a whole block | The block arrives with the identity it left with |
| ⌘X then ⌘⇧V | It arrives as new text, with no identity |
| ⌘C then ⌘V | The copy has no identity, and the original keeps its own |
| ⌘X, ⌘V, then ⌘V again | The first paste has the identity, the second doesn't |
| Dragging a selection | The same as cut and paste |
| ⌘Z after a cut, and after a paste | The block is back with its identity, and the editor can tell nothing changed |
| A few words cut from one paragraph and pasted into another | The editor can say which block they left, which text it was, and where they landed |
| A cut in one file pasted into another file of the idea | The identity arrives |
| A list item, a table row and a whole table | Each behaves as a block does, or it's written down that it doesn't |
| Text pasted from outside (a web page, a document) | It arrives as new text, and nothing it carries is taken for an identity |
| Milkdown's clipboard plugin | Markdown and tables still paste correctly with our handling in front of it |

**What comes out of it:** the cases that pass and fail in each browser, and the editor's wrapper code for identity and the clipboard if it passes.

**If it fails:**

- **A few cases fail:** narrow the design to what works (the likeliest to go is moving part of a paragraph, which then stays a deletion and new text) and say so in [Moving text](#moving-text).
- **Milkdown is in the way:** build the page editor on bare ProseMirror with the same remark parser and writer (the fallback under [Not adding](#not-adding)). The comment boxes can stay on Milkdown or follow. The round-trip results carry over, since they come from remark, not from Milkdown.
- **The browser's clipboard is in the way:** no library fixes that, and the design changes instead.

## Keeping the source stable

- **Only changed blocks are written.** The editor compares each block's content with what it opened, not its Markdown.
- **A block that's only restyled sends nothing.** If the written Markdown parses to the same tree as the source, the source is kept.
- **Written in the file's style:** the bullet character, the emphasis character and the rule style are read from the file, and numbered lists keep `1.` on every line if the file does that.
- **Tables are written by our own writer,** in the file's table style (see [Tables](#tables)).
- **The round-trip test goes into the repository** with these files as fixtures, failing if any block's meaning changes. For the measurements it ran Milkdown's real parser and serialiser outside a browser, on a stand-in DOM (happy-dom). In the repository it can run with the stories' browser tests, which need nothing new.

A changed block's edit is already cut down to the smallest `replace` by `blockEdit` in `core`. Restyling inside that block widens the replace and marks more comments as changed, which is the reason to keep it low.

## Keyboard

| Keys | Does |
|---|---|
| ⌘B, ⌘I | Bold, italic |
| ⌘E | Code |
| ⌘K | Link: its text and address |
| ⌘⇧X | Strikethrough |
| ⌘⇧. | Quote |
| ⌘⇧7, ⌘⇧8 | Numbered list, bulleted list |
| ⌘⌥0, ⌘⌥1 to ⌘⌥6 | Normal text, heading 1 to 6 |
| ⌘], ⌘[ | Indent and outdent a list item |
| ⌘↵ | Send a comment |
| Esc | Cancel a comment |
| Tab, Shift+Tab in a table | Next cell (adding a row after the last), previous cell |
| Enter in a table | The cell below |
| ⌘Z, ⌘⇧Z | Undo, redo |
| ⌘X then ⌘V | Move text, with its comments |
| ⌘⇧V | Paste as plain text, without them |

Ctrl stands in for ⌘ off the Mac. Outside a table, Tab and Shift+Tab always move focus, and the arrow keys leave a table at its edges. The toolbar is one tab stop, with arrow keys between its buttons.

## Where the code goes

| What | Where |
|---|---|
| The editor: a `MarkdownEditor` taking Markdown and giving Markdown, with `flavor` (full, inline, page), `onSubmit`, `onCancel` and a label, as `TextArea` does | New, `packages/ui/src/editor/` |
| The toolbar and its two back ends (rich, and the text box), and the table menu | Same folder |
| The table writer | Same folder |
| The round-trip test and its fixtures | Same folder |
| The comment boxes | `CommentBox.tsx`, `CommentCard.tsx`, `SelectionMenu.tsx`, `ReviewPanel.tsx` swap `TextArea` for the editor |
| The page editor | `IdeaEditor.tsx` is replaced by the one surface. `editing.tsx` keeps the draft, the panel and the bar, and gains the saving |
| Excerpts | `server/src/idea/notify.ts`, the cli's `truncate` calls |
| Blocks to draft changes, the draft as a difference, heading levels, moves | `packages/core/src/draft.ts` and `edit.ts`, with golden tests |
| Moving part of a block's text | A new command in `packages/core/src/batch.ts` and `apply.ts` |
| Accepting a suggestion only into the draft | `CommentCard.tsx` (the suggestion's buttons), `IdeaView.tsx` (`accept`, and its confirmation dialog) |
| Several draft changes in one request | `packages/api/src/operations.ts`, `packages/server/src/idea/service.ts` |

The editor loads as its own chunk, fetched when an idea page is idle. A box opened before it arrives is the plain box for that use.

## Build order

1. **The editor in `ui`:** the component with its toolbar, tables and the table writer, its stories, and the round-trip test. No page uses it yet.
2. **Comments:** every box in the table above, and excerpts.
3. **Suggested edits:** the inline flavor, the rendered change in a thread, and Add to draft as the only way to accept.
4. **Done. The spike:** two days on the clipboard cases (see [A spike before the page editor](#a-spike-before-the-page-editor)), ending in a go, a narrower design, or bare ProseMirror for the page.
5. **Done. The draft's new work:** the function in `core`, changes sent together, the draft as a difference, heading levels and moves, each with tests and no interface yet.
6. **The page editor:** the surface, its toolbar and its saving, replacing the block editor.

Steps 1 and 2 are the smallest useful piece. Steps 4 and 5 can start alongside them, since they touch nothing the first three do. Step 6 waits for both.

## How to tell it's right

- Opening a file in the editor, clicking around it and closing it sends nothing to the draft.
- Editing one word of a paragraph changes only that word in the version's diff.
- A comment typed with the toolbar and the same comment typed as Markdown are stored the same.
- A comment written by an agent with a table, a code block and raw HTML opens in the box and saves back with the same meaning.
- Raw HTML in a comment or a page is drawn from the allowlist, on the page and in the editor, and never runs: no script, handler, style or image survives. The editor marks it with the HTML icon. Pasted HTML is reduced to the editor's own node types.
- Every shortcut in the table works on both sides of the switch.
- Tab leaves the editor from anywhere but a table, and the arrow keys leave a table.
- Changing one cell of a table changes that cell in the version's diff, and comments on other rows keep their place.
- A row or column can be added, removed and aligned from the keyboard alone.
- Typing for a minute in one paragraph leaves one change in the draft panel, not one for each pause.
- Cutting a paragraph that has a comment and pasting it under another heading leaves the comment on it, marked moved. Pasting it with ⌘⇧V leaves the comment outdated.
- Cutting a commented sentence out of one paragraph and pasting it into another keeps its comment.
- Cutting and then undoing leaves the draft with no change, and the comment where it was.
- A suggested edit has one way to be accepted, and accepting it never makes a version by itself.
- Two people editing different blocks of a file both keep their changes. Two editing the same block are told, and nothing is merged.
- The inbox, the notifications page and the cli show no Markdown syntax in a comment's excerpt.
- It reads correctly in the light and dark themes, and a screen reader names the box and each toolbar button with its state.

## Left out

- Uploading or pasting images from the web app.
- @mentions, and notifying the people mentioned.
- Merged cells, and lists or paragraphs inside a cell (Markdown tables can't hold them).
- Quote reply.
- Live co-editing with shared cursors.
- Rendering Markdown in email's HTML part.
