import { Button } from '../controls/Button.tsx'

export interface ViewInVersionProps {
  // the last version that still had the comment's text
  version: number
  onView: () => void
  label?: string
}

// For an outdated comment: open the newest version where its text still was,
// with the comment back in place.
export function ViewInVersion({ version, onView, label = `View in v${version}` }: ViewInVersionProps) {
  return (
    <Button
      variant="link"
      size="sm"
      title={`Open v${version}, the last version with the text this comment was on`}
      onClick={(event) => {
        event.stopPropagation()
        onView()
      }}
    >
      {label} <span aria-hidden>→</span>
    </Button>
  )
}
