import { useState } from 'react'
import './CopyText.css'

export interface CopyTextProps {
  // what's shown, and copied
  text: string
  // for screen readers: what it is ("The idea's address")
  label: string
}

// Something people copy (an idea's address, for chat or the cli): shown small, in monospace, with a
// button that copies it and says so.
export function CopyText({ text, label }: CopyTextProps) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="copy-text">
      <code>{text}</code>
      <button
        type="button"
        className="copy-text-button"
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        title="Copy"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}
