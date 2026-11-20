# Spike: the clipboard before the page editor

**Status:** done. **Go, on Milkdown,** with the wrapper below and three things narrowed. It answers [A spike before the page editor](design-rich-text.md#a-spike-before-the-page-editor) in the rich-text design; the code is throwaway, in `packages/ui/src/editor/spike/`.

## The question

The page editor moves comments with the text they're on when it's cut and pasted, the way Google Docs does. That rests on each block on screen keeping its draft identity through the browser's clipboard: through a cut and a paste, not a copy; once, not twice; and never from text pasted in from elsewhere. Milkdown's Markdown side was measured (the round trip). This side hadn't been, in a real browser.

## How it was run

- **The editor:** Milkdown with the same presets, history and clipboard plugin as the comment boxes, and an identity on each of the draft's blocks (paragraphs, headings, quotes, code, rules, list items, tables): an attribute drawn as `data-block-id`, so it rides in the clipboard's HTML, and never in the Markdown. Two files of an idea side by side, one clipboard between them (`spike/identity.ts`, story `Editor/Spike/Clipboard`).
- **The cases:** each run with the real keys (Ctrl+X, Ctrl+C, Ctrl+V, Ctrl+Shift+V, Ctrl+Z) and a real mouse drag, in a fresh page, by `spike/run.mjs`. Text "from another app" is copied with the real keys from outside the editors, so it's what the browser puts on its clipboard from a web page.
- **The browsers:** Chromium 156 and Firefox 157 (Playwright's) on Linux, and Playwright's WebKit, the engine Safari is built on, in Playwright's own container (its libraries aren't on every Linux). **Not run in Safari itself:** that needs a Mac. Opening the story in Safari and trying the cases by hand would close the gap.

## Results

The same in all three.

| Case | Chromium | Firefox | WebKit |
|---|---|---|---|
| ⌘X then ⌘V on a whole block: it arrives with its identity | ✓ | ✓ | ✓ |
| ⌘X then ⌘⇧V: new text, no identity | ✓ | ✓ | ✓ |
| ⌘C then ⌘V: the copy has none, the original keeps its own | ✓ | ✓ | ✓ |
| ⌘X, ⌘V, ⌘V again: the first has it, the second doesn't | ✓ | ✓ | ✓ |
| Dragging a selection within a file: as cut and paste | ✓ | ✓ | ✓ |
| ⌘Z after a cut, and after a paste: back, and the editor knows nothing changed | ✓ | ✓ | ✓ |
| A few words into another paragraph: which block and text they left, and where they landed | ✓ | ✓ | ✓ |
| A cut in one file pasted into another | ✓ | ✓ | ✓ |
| A list item | ✓ | ✓ | ✓ |
| A whole table | ✓ | ✓ | ✓ |
| A table row | as a new table (see below) | same | same |
| Text from another app, carrying `data-block-id`: nothing taken | ✓ | ✓ | ✓ |
| Milkdown's clipboard: Markdown and tables still paste | ✓ | ✓ | ✓ |
| Dragging into another file (not in the design's list) | a copy (see below) | same | same |

## What it took

What the page editor's wrapper has to do. None of it fights Milkdown; one piece goes in front of it.

- **A block's whole text is the block.** ProseMirror's triple click selects a paragraph's text, not the paragraph, so a cut left an empty paragraph behind, keeping the identity, and the paste joined the paragraph at the caret. A cut, copy or drag from the start of a block's text to the end of a block's text takes the blocks, as Google Docs' triple click takes the line break too.
- **Pasting whole blocks goes in front of Milkdown's paste.** Milkdown's clipboard plugin turns a lone paragraph of plain text into bare text, so it joins the paragraph at the caret: a moved block lost itself, and a copied one merged into another. The wrapper puts whole blocks in itself and leaves everything else to Milkdown, whose Markdown and table pasting still works.
- **A paste at the start of a block goes above it.** Otherwise ProseMirror splits the block and the identity stays on the empty first half, while the block's text goes on in a new one.
- **A cut is noted on the page, and spent by its paste.** The identities ride in the clipboard's HTML; a paste keeps them only if they belong to a cut on this page not yet pasted. That's what makes a second paste, a copy (whose identities are stripped as it's copied) and text from elsewhere all new text.
- **No identity on two blocks.** One put back by ⌘Z, or kept by a block split in two, stays on the first; the other is new. With that, undo needs nothing of its own: the document is exactly as opened, identities and all.
- **A few words carry their origin, not an identity.** They have none of their own, so the cut notes the block and text they left, and the paste says where they landed (the block and the offset). That's what step 5's command for moving part of a block needs, so that command is worth building.

## Narrowed

- **A table row has no identity.** The draft knows a table as one block, so cutting a row is an edit of its table, and pasting it makes a new one-row table. Comments on the row's text go outdated, as they would if it were retyped.
- **Dragging into another file is a copy.** ProseMirror deletes the original only for a drag within one editor. It's safe (nothing is lost or doubled), and making it a move is small work for the page editor: the page notes what a drag carries, and the editor it's dropped on takes it out of the other.
- **A paste of several paragraphs into the middle of a block** splits it, and the identity stays on the first half, whichever half has the block's text. Pasting at a block's start is handled (above); in the middle, the draft side decides: step 5's function, turning blocks into changes, compares the halves' text with the block's and gives the identity to the one that kept it.

## What changes in the design

[Moving text](design-rich-text.md#moving-text) holds, with the three narrowings above, and these written in: a block's whole text is the block, and a paste at a block's start goes above it. Building the page editor (step 6) starts from `spike/identity.ts`'s approach.
