// What you hear about: what your bots do, and (where the server sends email)
// what reaches you by email, how often, and whether the teams you watch do.
import type { NotificationSettings } from '@ideaf/api'
import { Select, Stack } from '@ideaf/ui'
import './settings.css'

type Changes = Partial<Omit<NotificationSettings, 'emailAvailable'>>

export interface NotificationSettingsFormProps {
  /** Null while loading. */
  value: NotificationSettings | null
  onChange: (changes: Changes) => void
}

const EMAIL = [
  { value: 'involved', label: 'Everything about ideas I’m involved in' },
  { value: 'review-requests', label: 'Only when I’m asked to review' },
  { value: 'off', label: 'Nothing' },
] as const

const CADENCE = [
  { value: 'bundled', label: 'An email per idea, once it’s gone quiet for a few minutes' },
  { value: 'daily', label: 'One digest a day' },
] as const

export function NotificationSettingsForm({ value, onChange }: NotificationSettingsFormProps) {
  const loading = value === null
  return (
    <Stack gap={3}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value?.ownBots ?? true}
          disabled={loading}
          onChange={(event) => onChange({ ownBots: event.target.checked })}
        />
        What a bot does on your behalf shows in your inbox
      </label>
      {value && !value.emailAvailable && <p className="settings-note">This server doesn’t send notification emails.</p>}
      {value?.emailAvailable && (
        <>
          <label className="settings-field">
            <span>Email me</span>
            <Select
              options={[...EMAIL]}
              value={value.email}
              emphasized={value.email !== 'involved'}
              onChange={(email) => onChange({ email })}
            />
          </label>
          {value.email !== 'off' && (
            <label className="settings-field">
              <span>How often</span>
              <Select options={[...CADENCE]} value={value.cadence} onChange={(cadence) => onChange({ cadence })} />
            </label>
          )}
          {value.email === 'involved' && (
            <label className="settings-check">
              <input
                type="checkbox"
                checked={value.emailWatching}
                onChange={(event) => onChange({ emailWatching: event.target.checked })}
              />
              The teams I watch email me too, not just my inbox
            </label>
          )}
          <p className="settings-note">
            Reading an idea before its email goes, or marking it read or done, stops the email.
          </p>
        </>
      )}
    </Stack>
  )
}
