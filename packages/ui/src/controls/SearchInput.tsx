import './SearchInput.css'

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  // what's searched, for screen readers ("Search ideas")
  label: string
  placeholder?: string
  autoFocus?: boolean
}

export function SearchInput({ value, onChange, label, placeholder, autoFocus }: SearchInputProps) {
  return (
    <label className="search">
      <span className="search-icon" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
