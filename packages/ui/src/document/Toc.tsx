import './Toc.css'

export interface TocEntry {
  // the heading's id in the document (MarkdownView gives each one)
  id: string
  title: string
  // 2–4: the file's title (1) is the page's heading, not an entry
  level: number
  // changed against the target
  changed?: boolean
  // open comments on the section and the text in it
  openComments?: number
}

export interface TocProps {
  entries: TocEntry[]
  // the section being read
  active?: string | null
  onJump: (entry: TocEntry) => void
}

// The file's contents, nested by level, with the section you're reading marked,
// a dot on changed sections and a count of open comments.
export function Toc({ entries, active, onJump }: TocProps) {
  if (entries.length === 0) {
    return <p className="toc-empty">No headings in this file.</p>
  }
  return (
    <nav className="toc" aria-label="Contents">
      <ol>
        {entries.map((entry) => (
          <li key={entry.id} className={`toc-l${Math.min(Math.max(entry.level, 2), 4)}`}>
            <a
              href={`#${entry.id}`}
              aria-current={active === entry.id ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault()
                onJump(entry)
              }}
            >
              <span className="toc-title">{entry.title}</span>
              {entry.changed && (
                <span className="toc-changed" title="Changed against the target">
                  <span className="visually-hidden">, changed</span>
                </span>
              )}
              {entry.openComments ? (
                <span
                  className="toc-count"
                  title={`${entry.openComments} open comment${entry.openComments > 1 ? 's' : ''}`}
                >
                  <span aria-hidden>{entry.openComments}</span>
                  <span className="visually-hidden">
                    , {entry.openComments} open comment{entry.openComments > 1 ? 's' : ''}
                  </span>
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
