// Where a comment is marked in the document: its own mark (data-comment-id), or the mark of a block or
// a section it shares with other comments (data-comment-ids, a list of them).

/** The selectors for one comment's marks. */
export function markForms(id: string): string[] {
  const quoted = CSS.escape(id)
  return [`[data-comment-id="${quoted}"]`, `[data-comment-ids~="${quoted}"]`]
}

/** A selector for one comment's marks, for querySelector. */
export function markSelector(id: string): string {
  return markForms(id).join(', ')
}
