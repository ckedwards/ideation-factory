// Access to an idea, as one choice: view (always, with commenting), and edit
// and share each on top of it. Everyone on the site can only be given view.

export type Level = 'view' | 'edit' | 'share' | 'all'

export const LEVELS: { value: Level; label: string }[] = [
  { value: 'view', label: 'can view and comment' },
  { value: 'edit', label: 'can edit' },
  { value: 'share', label: 'can view and share' },
  { value: 'all', label: 'can edit and share' },
]

export const levelOf = (a: { edit: boolean; share: boolean }): Level =>
  a.edit ? (a.share ? 'all' : 'edit') : a.share ? 'share' : 'view'

export const accessOf = (level: Level) => ({
  edit: level === 'edit' || level === 'all',
  share: level === 'share' || level === 'all',
})
