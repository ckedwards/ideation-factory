import type { TextareaHTMLAttributes } from 'react'
import './TextArea.css'

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  // ⌘↵ or Ctrl+↵: send it
  onSubmit?: () => void
  // Esc: give up
  onCancel?: () => void
}

export function TextArea({ value, onChange, onSubmit, onCancel, className, onKeyDown, ...rest }: TextAreaProps) {
  return (
    <textarea
      className={['textarea', className].filter(Boolean).join(' ')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit) {
          event.preventDefault()
          onSubmit()
        } else if (event.key === 'Escape' && onCancel) {
          event.preventDefault()
          onCancel()
        }
        onKeyDown?.(event)
      }}
      {...rest}
    />
  )
}
