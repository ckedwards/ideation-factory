import './SearchInput.css'

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  // what's searched, for screen readers ("Search ideas")
  label: string
  placeholder?: string
  autoFocus?: boolean
  // a keyboard shortcut that focuses it, shown as a hint ("/")
  shortcut?: string
}

export function SearchInput({ value, onChange, label, placeholder, autoFocus, shortcut }: SearchInputProps) {
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
      {shortcut && !value && (
        <kbd className="search-kbd" aria-hidden>
          {shortcut}
        </kbd>
      )}
    </label>
  )
}
