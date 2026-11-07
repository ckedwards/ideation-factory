// A team's name, handle and description, for its admins. A new handle moves
// its page and its ideas' addresses; the old handle keeps leading to it until
// another team takes it.
import { useState } from 'react'
import { Button, Stack, TextArea, TextField } from '@ideaf/ui'
import './TeamPolicies.css'

export interface TeamProfileProps {
  name: string
  handle: string
  description: string
  onSave: (changes: { name?: string; handle?: string; description?: string }) => Promise<unknown>
}

export function TeamProfile(props: TeamProfileProps) {
  const [name, setName] = useState(props.name)
  const [handle, setHandle] = useState(props.handle)
  const [description, setDescription] = useState(props.description)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changes = {
    ...(name.trim() !== props.name ? { name: name.trim() } : {}),
    ...(handle.trim().toLowerCase() !== props.handle ? { handle: handle.trim().toLowerCase() } : {}),
    ...(description !== props.description ? { description } : {}),
  }
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        setSaving(true)
        setError(null)
        try {
          await props.onSave(changes)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setSaving(false)
        }
      }}
    >
      <Stack gap={3}>
        <TextField label="Name" value={name} onChange={setName} />
        <TextField
          label="Handle"
          value={handle}
          onChange={setHandle}
          spellCheck={false}
          hint={`Its page is /${handle.trim().toLowerCase() || '…'}. A new handle keeps the old one leading here until another team takes it.`}
          error={error ?? undefined}
        />
        <label className="policy-description">
          <span>What it’s for</span>
          <TextArea value={description} onChange={setDescription} rows={3} aria-label="What it’s for" />
        </label>
        <div>
          <Button type="submit" variant="primary" disabled={saving || Object.keys(changes).length === 0}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Stack>
    </form>
  )
}
