// The rich side of MarkdownEditor, as React: Milkdown drawn into a div, kept in step with the value
// it's given. Loaded as its own chunk (MarkdownEditor lazy-loads it), since Milkdown is most of the
// editor's weight and a page shows the plain box until it arrives.
import { useEffect, useRef } from 'react'
// ProseMirror's own rules: among them, hiding the caret while a whole block (drawn HTML, say) is selected
import '@milkdown/kit/prose/view/style/prosemirror.css'
import { createRichEditor, type Flavor, type RichEditor, type RichOptions, type Selection } from './milkdown.ts'

export interface RichSurfaceProps {
  value: string
  onChange: (value: string) => void
  flavor: Flavor
  label: string
  placeholder?: string | undefined
  /** Not shown yet (the stand-in is, until the editor's drawn). */
  hidden: boolean
  onSubmit?: (() => void) | undefined
  onCancel?: (() => void) | undefined
  onLink: () => void
  onContextMenu: RichOptions['onContextMenu']
  onSelection: (state: Selection) => void
  /** The editor once it's made, and null once it's gone. */
  onReady: (editor: RichEditor | null) => void
}

export default function RichSurface(props: RichSurfaceProps) {
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<RichEditor | null>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    let gone = false
    let made: RichEditor | null = null
    const options = {
      root: root.current!,
      source: latest.current.value,
      flavor: latest.current.flavor,
      label: latest.current.label,
      onChange: (markdown: string) => latest.current.onChange(markdown),
      onSelection: (state: Selection) => latest.current.onSelection(state),
      onLink: () => latest.current.onLink(),
      onContextMenu: (...args: Parameters<RichOptions['onContextMenu']>) => latest.current.onContextMenu(...args),
      // read when they're used, so they follow the props
      get placeholder() {
        return latest.current.placeholder
      },
      get onSubmit() {
        return latest.current.onSubmit
      },
      get onCancel() {
        return latest.current.onCancel
      },
    }
    void createRichEditor(options).then((made_) => {
      if (gone) {
        made_.destroy()
        return
      }
      made = made_
      editor.current = made_
      latest.current.onReady(made_)
      // the value may have changed while it was being made
      made_.load(latest.current.value)
    })
    return () => {
      gone = true
      made?.destroy()
      editor.current = null
      latest.current.onReady(null)
    }
  }, [props.flavor])

  // given a different value from outside (cleared once sent, say): open it
  useEffect(() => {
    editor.current?.load(props.value)
  }, [props.value])

  return <div ref={root} className="md-editor-rich" hidden={props.hidden} />
}
