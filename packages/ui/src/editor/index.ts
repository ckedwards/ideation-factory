// The Markdown editor: its own entry (`@ideaf/ui/editor`), so a page that doesn't write anything
// doesn't load it.
export {
  MarkdownEditor,
  type MarkdownEditorHandle,
  type MarkdownEditorProps,
  preloadMarkdownEditor,
} from './MarkdownEditor.tsx'
export type { Action, Flavor, PageMark } from './milkdown.ts'
