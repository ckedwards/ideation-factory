// Your settings: your name and handle, where you're signed in, your
// passkeys, what you hear about (in the inbox and by email), and the tokens
// and apps that act for you. Each list comes from sign-in, and each change
// goes straight to it.
import { useState } from 'react'
import { Button, Page, PageHeader, RelativeTime, Section, Stack, Toast } from '@ideaf/ui'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api, meQuery } from '../../api.ts'
import { account, AuthError } from '../../auth.ts'
import { AccountList } from './-components/AccountList.tsx'
import { NotificationSettingsForm } from './-components/NotificationSettingsForm.tsx'
import { ProfileForm } from './-components/ProfileForm.tsx'
import './-components/settings.css'

export const Route = createFileRoute('/settings/')({
  staticData: { nav: 'settings' },
  component: Settings,
})

const at = (iso: string) => <RelativeTime at={Date.parse(iso)} />

/** "Chrome on Linux", from a browser's user agent; enough to tell sessions apart. */
function device(agent: string | null | undefined): string {
  if (!agent) {
    return 'An unknown browser or app'
  }
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Chrome\//.test(agent)
      ? 'Chrome'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Safari\//.test(agent)
          ? 'Safari'
          : /^ideaf|Bun|node/i.test(agent)
            ? 'The cli'
            : 'A browser'
  const system = /Windows/.test(agent)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(agent)
      ? 'macOS'
      : /Android/.test(agent)
        ? 'Android'
        : /iPhone|iPad/.test(agent)
          ? 'iOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : null
  return system ? `${browser} on ${system}` : browser
}

/** Apps by their client ID: the cli is ours; others name themselves (MCP clients, later). */
const appName = (clientId: string) => (clientId === 'ideaf-cli' ? 'ideaf, the command line' : clientId)

function Settings() {
  const queryClient = useQueryClient()
  const { data: me } = useSuspenseQuery(meQuery)
  const [note, setNote] = useState<string | null>(null)
  const sessions = useQuery({ queryKey: ['account', 'sessions'], queryFn: account.sessions })
  const current = useQuery({
    queryKey: ['account', 'session'],
    queryFn: () => fetch('/api/auth/get-session', { credentials: 'same-origin' }).then((r) => r.json()),
  })
  const passkeys = useQuery({ queryKey: ['account', 'passkeys'], queryFn: account.passkeys })
  const tokens = useQuery({ queryKey: ['account', 'tokens'], queryFn: account.tokens })
  const consents = useQuery({ queryKey: ['account', 'consents'], queryFn: account.consents })
  const notifications = useQuery({ queryKey: ['me', 'notifications'], queryFn: () => api.getNotificationSettings({}) })
  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['account'] }),
    onError: (error) => setNote(error.message),
  })
  const currentId = (current.data as { session?: { id: string } } | undefined)?.session?.id

  return (
    <Page>
      <PageHeader title="Your settings" sub={`@${me.handle}`} />
      <Section title="Profile">
        <ProfileForm
          name={me.name}
          handle={me.handle}
          isFree={account.handleFree}
          onName={async (name) => {
            await account.update({ name })
            await queryClient.invalidateQueries({ queryKey: ['me'] })
          }}
          onHandle={async (username) => {
            await account.update({ username })
            await queryClient.invalidateQueries({ queryKey: ['me'] })
          }}
        />
      </Section>

      <Section
        title="Passkeys"
        action={
          <Button
            size="sm"
            onClick={() =>
              change.mutate(async () => {
                try {
                  await account.addPasskey(device(navigator.userAgent))
                  setNote('Passkey added: you can sign in with it now.')
                } catch (error) {
                  // sign-in only lets a passkey be added just after signing in with a code
                  throw error instanceof AuthError && error.status === 403
                    ? new Error(
                        'A passkey can be added only within 5 minutes of signing in with a code. Sign out, sign in with a code, then add it.',
                      )
                    : error
                }
              })
            }
          >
            Add a passkey
          </Button>
        }
      >
        <AccountList
          label="Passkeys"
          items={(passkeys.data ?? []).map((p) => ({
            id: p.id,
            title: p.name || 'A passkey',
            sub: <>Added {at(p.createdAt)}</>,
            action: { label: 'Remove', onClick: () => change.mutate(() => account.removePasskey(p.id)) },
          }))}
          empty="No passkeys yet: you sign in with a code sent to your email."
        />
      </Section>

      <Section
        title="Where you’re signed in"
        action={
          (sessions.data?.length ?? 0) > 1 ? (
            <Button size="sm" variant="ghost" onClick={() => change.mutate(account.signOutElsewhere)}>
              Sign out everywhere else
            </Button>
          ) : undefined
        }
      >
        <AccountList
          label="Where you’re signed in"
          items={(sessions.data ?? []).map((s) => ({
            id: s.id,
            title: device(s.userAgent),
            sub: <>Signed in {at(s.createdAt)}</>,
            current: s.id === currentId,
            action:
              s.id === currentId
                ? undefined
                : { label: 'Sign out', onClick: () => change.mutate(() => account.signOut(s.token)) },
          }))}
          empty="Nowhere else."
        />
      </Section>

      <Section title="Notifications">
        <NotificationSettingsForm
          value={notifications.data ?? null}
          onChange={(changes) => {
            // shown at once; the server's answer (or, on failure, what it has) replaces it
            const key = ['me', 'notifications']
            queryClient.setQueryData(key, (was: typeof notifications.data) => (was ? { ...was, ...changes } : was))
            void api
              .setNotificationSettings(changes)
              .then((now) => queryClient.setQueryData(key, now))
              .catch(() => queryClient.invalidateQueries({ queryKey: key }))
          }}
        />
      </Section>

      <Section title="Apps and the cli">
        <Stack gap={3}>
          <AccountList
            label="Apps that act for you"
            items={(consents.data ?? []).map((c) => ({
              id: c.id,
              title: appName(c.clientId),
              sub: <>Allowed {at(c.createdAt)}</>,
              action: { label: 'Revoke', onClick: () => change.mutate(() => account.revokeConsent(c.id)) },
            }))}
            empty="No apps act for you. ideaf auth login signs the cli in."
          />
          <AccountList
            label="Personal tokens"
            items={(tokens.data ?? []).map((t) => ({
              id: t.id,
              title: t.name || 'A token',
              sub: (
                <>
                  {t.start ? `${t.start}… · ` : ''}made {at(t.createdAt)}
                  {t.expiresAt ? <> · expires {at(t.expiresAt)}</> : null}
                </>
              ),
              action: { label: 'Revoke', onClick: () => change.mutate(() => account.revokeToken(t.id)) },
            }))}
            empty="No personal tokens. They’re for CI, where nobody can sign in."
          />
        </Stack>
      </Section>
      <Toast message={note} onDismiss={() => setNote(null)} />
    </Page>
  )
}
