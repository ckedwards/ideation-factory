import { type InputHTMLAttributes, type ReactNode, useId } from 'react'
import './TextField.css'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'> {
  // what it is, shown above it ("Handle")
  label: string
  value: string
  onChange: (value: string) => void
  // before the text, inside the field ("@")
  prefix?: string
  // under it: what to type, or (with `error`) what's wrong
  hint?: ReactNode
  error?: ReactNode
}

// One line of text, labelled, with a hint or an error under it. The error is
// announced, and marks the field as invalid.
export function TextField({ label, value, onChange, prefix, hint, error, className, id, ...rest }: TextFieldProps) {
  const own = useId()
  const field = id ?? own
  const note = `${field}-note`
  return (
    <div className={['text-field', error && 'is-invalid', className].filter(Boolean).join(' ')}>
      <label htmlFor={field}>{label}</label>
      <span className="text-field-box">
        {prefix && (
          <span className="text-field-prefix" aria-hidden>
            {prefix}
          </span>
        )}
        <input
          id={field}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? note : undefined}
          {...rest}
        />
      </span>
      {(error || hint) && (
        <span id={note} className="text-field-note" role={error ? 'alert' : undefined}>
          {error ?? hint}
        </span>
      )}
    </div>
  )
}
