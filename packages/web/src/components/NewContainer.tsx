// Making a team or a group, from its list page: a name, a handle (suggested from the name until it's
// typed over), and what it's for. The creator becomes its first admin.
import { useId, useState } from 'react'
import { Button, Dialog, Stack, TextArea, TextField } from '@ideaf/ui'
import { suggestHandle } from '../handles.ts'
import './NewContainer.css'

export interface NewContainerProps {
  kind: 'team' | 'group'
  open: boolean
  onClose: () => void
  /** Makes it: resolves once made, or rejects with what's wrong (a handle that's taken, say). */
  onCreate: (container: { name: string; handle: string; description?: string }) => Promise<unknown>
}

export function NewContainer({ kind, open, onClose, onCreate }: NewContainerProps) {
  const formId = useId()
  const [name, setName] = useState('')
  const [typedHandle, setTypedHandle] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const handle = (typedHandle ?? suggestHandle(name)).trim().toLowerCase()
  const close = () => {
    setName('')
    setTypedHandle(null)
    setDescription('')
    setError(null)
    onClose()
  }
  const page = kind === 'team' ? `/${handle || '…'}` : `/groups/${handle || '…'}`
  return (
    <Dialog
      open={open}
      title={kind === 'team' ? 'New team' : 'New group'}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={saving || !name.trim() || !handle}>
            {saving ? 'Creating…' : kind === 'team' ? 'Create team' : 'Create group'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={async (event) => {
          event.preventDefault()
          setSaving(true)
          setError(null)
          try {
            await onCreate({ name: name.trim(), handle, ...(description.trim() ? { description } : {}) })
            close()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setSaving(false)
          }
        }}
      >
        <Stack gap={3}>
          <TextField label="Name" value={name} onChange={setName} autoFocus required />
          <TextField
            label="Handle"
            value={typedHandle ?? handle}
            onChange={setTypedHandle}
            spellCheck={false}
            hint={`Its page is ${page}.`}
            error={error ?? undefined}
          />
          <label className="new-container-field">
            <span>What it’s for (optional)</span>
            <TextArea value={description} onChange={setDescription} rows={3} aria-label="What it’s for" />
          </label>
          <p className="new-container-note">
            {kind === 'team'
              ? 'You’ll be its first admin. Teams are invite only: people ask to join, and admins let them in.'
              : 'You’ll be its first admin. Everyone can see a group and its members; admins add people.'}
          </p>
        </Stack>
      </form>
    </Dialog>
  )
}
