import type { SelectHTMLAttributes } from 'react'
import './Select.css'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export interface SelectProps<T extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange' | 'size'
> {
  options: SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  // highlighted, for a choice that differs from the default
  emphasized?: boolean
  size?: 'sm' | 'md'
}

// A native select: short, fixed lists only. For people, teams and groups, which
// run to thousands, use Combobox.
export function Select<T extends string>({
  options,
  value,
  onChange,
  emphasized = false,
  size = 'md',
  className,
  ...rest
}: SelectProps<T>) {
  const classes = ['select', `select-${size}`, emphasized && 'select-emphasized', className].filter(Boolean).join(' ')
  return (
    <select className={classes} value={value} onChange={(event) => onChange(event.target.value as T)} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
