// Your name and your handle. A new handle is checked before it's saved, and
// your old one keeps leading to you until someone else takes it.
import { useState } from 'react'
import { Button, Stack, TextField } from '@ideaf/ui'
import './ProfileForm.css'

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])$/

export interface ProfileFormProps {
  name: string
  handle: string
  onName: (name: string) => Promise<unknown>
  onHandle: (handle: string) => Promise<unknown>
  /** Whether a handle is free. */
  isFree: (handle: string) => Promise<boolean>
}

export function ProfileForm({ name: savedName, handle: savedHandle, onName, onHandle, isFree }: ProfileFormProps) {
  const [name, setName] = useState(savedName)
  const [handle, setHandle] = useState(savedHandle)
  const [nameNote, setNameNote] = useState<{ error?: string; done?: string }>({})
  const [handleNote, setHandleNote] = useState<{ error?: string; done?: string }>({})
  const [saving, setSaving] = useState<'name' | 'handle' | null>(null)

  const saveName = async () => {
    const next = name.trim()
    if (!next || next.length > 100) {
      return setNameNote({ error: 'A name is 1 to 100 characters.' })
    }
    setSaving('name')
    try {
      await onName(next)
      setNameNote({ done: 'Saved.' })
    } catch (error) {
      setNameNote({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(null)
    }
  }
  const saveHandle = async () => {
    const next = handle.trim().toLowerCase().replace(/^@/, '')
    if (!HANDLE.test(next)) {
      return setHandleNote({
        error: 'A handle is 2 to 39 lowercase letters, digits and dashes, not starting or ending with a dash.',
      })
    }
    setSaving('handle')
    try {
      if (!(await isFree(next))) {
        return setHandleNote({ error: `@${next} is taken: pick another handle.` })
      }
      await onHandle(next)
      setHandleNote({ done: `You’re @${next} now. @${savedHandle} still leads to you, until someone else takes it.` })
    } catch (error) {
      setHandleNote({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack gap={4}>
      <form
        className="profile-row"
        onSubmit={(event) => {
          event.preventDefault()
          void saveName()
        }}
      >
        <TextField
          label="Name"
          value={name}
          onChange={(value) => {
            setName(value)
            setNameNote({})
          }}
          autoComplete="name"
          hint={nameNote.done}
          error={nameNote.error}
        />
        <Button type="submit" disabled={saving !== null || name.trim() === savedName}>
          {saving === 'name' ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <form
        className="profile-row"
        onSubmit={(event) => {
          event.preventDefault()
          void saveHandle()
        }}
      >
        <TextField
          label="Handle"
          prefix="@"
          value={handle}
          onChange={(value) => {
            setHandle(value)
            setHandleNote({})
          }}
          autoComplete="username"
          spellCheck={false}
          hint={handleNote.done ?? 'How people mention and find you; your ideas are at /@handle.'}
          error={handleNote.error}
        />
        <Button type="submit" disabled={saving !== null || handle.trim() === savedHandle}>
          {saving === 'handle' ? 'Checking…' : 'Change'}
        </Button>
      </form>
    </Stack>
  )
}
