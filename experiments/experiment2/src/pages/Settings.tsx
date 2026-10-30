// PROTOTYPE: settings. Profile (picture, display name, handle, primary email),
// Sign-in (email codes and passkeys, or your organization's single sign-on) and
// Tokens (for the ideaf CLI and agents, with the three purposes from idea.md).
import { useRef, useState } from 'react'
import { ME, NOW, type Token, type TokenPurpose } from '../data'
import { newTokenValue, useStore } from '../store'
import { ago } from '../model'
import { ActorLabel, AdminCallout, AdminMark, Avatar, Dialog, Empty, PageHeader, useParam } from '../ui'

export function Settings() {
  const [tab, setTab] = useParam<'profile' | 'signin' | 'tokens'>('tab', 'profile')
  return (
    <div className="page">
      <PageHeader title="Settings" />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>
          Profile
        </button>
        <button role="tab" aria-selected={tab === 'signin'} className={tab === 'signin' ? 'on' : ''} onClick={() => setTab('signin')}>
          Sign-in
        </button>
        <button role="tab" aria-selected={tab === 'tokens'} className={tab === 'tokens' ? 'on' : ''} onClick={() => setTab('tokens')}>
          Tokens
        </button>
      </div>
      {tab === 'profile' ? <Profile /> : tab === 'signin' ? <SignIn /> : <Tokens />}
    </div>
  )
}

// ---------- profile ----------

const MAX_BYTES = 2 * 1024 * 1024

function Profile() {
  const { state, dispatch } = useStore()
  const me = state.users[ME]
  const [name, setName] = useState(me.name)
  // undefined = unchanged, null = removed, string = new picture
  const [picture, setPicture] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const sso = state.deployment.signIn.mode === 'sso' ? state.deployment.signIn : null

  const shown = picture === undefined ? state.avatars[ME] : picture
  const trimmed = name.trim()
  const dirty = trimmed !== me.name || picture !== undefined
  const valid = trimmed.length > 0 && trimmed.length <= 60

  const onFile = (f: File | undefined) => {
    setError(null)
    if (!f) return
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return setError('Use a PNG, JPG, WebP or GIF image.')
    if (f.size > MAX_BYTES) return setError('That image is over 2 MB.')
    setPicture(URL.createObjectURL(f))
  }

  return (
    <div className="settings-grid">
      <section className="section">
        <h2>Profile picture</h2>
        <div className="picture-row">
          <span className={`avatar avatar-xl ${shown ? 'has-img' : ''}`} data-user={ME}>
            {shown ? <img src={shown} alt="Your profile picture" /> : me.initials}
          </span>
          <div className="picture-actions">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button onClick={() => file.current?.click()}>{shown ? 'Change picture' : 'Upload picture'}</button>
            {shown && (
              <button className="ghost" onClick={() => setPicture(null)}>
                Remove
              </button>
            )}
            <span className="hint">PNG, JPG, WebP or GIF, up to 2 MB. Square images look best. Without one, your initials are used.</span>
            {error && <span className="field-error">{error}</span>}
          </div>
        </div>

        <h2>Display name</h2>
        <label className="field">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Display name" />
          <span className="hint">Shown on your ideas, comments and reviews, and on bots that act on your behalf.</span>
          {!valid && <span className="field-error">Enter a name.</span>}
        </label>

        <h2>Handle</h2>
        <div className="field">
          <span className="handle-value">@{me.handle}</span>
          <span className="hint">You picked this when you signed up. It’s unique, and it’s how people @mention you and how the ideaf cli shows you. It can’t be changed here.</span>
        </div>

        <h2>Primary email</h2>
        <div className="field">
          <span className="email-row">
            <span className="handle-value">{me.email}</span>
            {sso && <span className="tag">Managed by {sso.provider}</span>}
          </span>
          <span className="hint">
            {sso
              ? `Your account is tied to this address. ${sso.provider} manages it; ask your IT team to change it.`
              : 'Your account is tied to this address: sign-in codes go here, so it can’t be changed from a signed-in session. Only you see it.'}
          </span>
        </div>

        <div className="row-end">
          <button
            className="ghost"
            disabled={!dirty}
            onClick={() => {
              setName(me.name)
              setPicture(undefined)
              setError(null)
            }}
          >
            Discard
          </button>
          <button
            className="primary"
            disabled={!dirty || !valid}
            onClick={() => {
              dispatch({ type: 'setProfile', name: trimmed, avatar: picture })
              setPicture(undefined)
              dispatch({ type: 'toast', text: 'Profile saved' })
            }}
          >
            Save profile
          </button>
        </div>
      </section>

      <aside className="section">
        <h2>How you’ll appear</h2>
        <div className="preview">
          <div className="preview-row">
            <span className={`avatar avatar-sm ${shown ? 'has-img' : ''}`} data-user={ME}>
              {shown ? <img src={shown} alt="" /> : trimmed ? initialsOf(trimmed) : '?'}
            </span>
            <b>{trimmed || 'Your name'}</b>
            <span className="muted">commented · just now</span>
          </div>
          <div className="preview-row">
            <span className="bot-mark" aria-hidden>
              🤖
            </span>
            <b className="preview-bot">planbot</b>
            <span className="actor-behalf">
              on behalf of <span className="actor-person">{trimmed || 'Your name'}</span>
            </span>
          </div>
        </div>
        <p className="hint">Changes apply everywhere once saved, including older comments.</p>
      </aside>
    </div>
  )
}

// ---------- sign-in ----------

function SignIn() {
  const { state, dispatch } = useStore()
  const me = state.users[ME]
  const sso = state.deployment.signIn.mode === 'sso' ? state.deployment.signIn : null
  if (sso)
    return (
      <section className="section settings-form">
        <div className="banner banner-locked">
          <b>You sign in with {sso.provider}</b> ({sso.protocol === 'saml' ? 'SAML' : 'OIDC'}). Your organization manages how you sign in, so email codes and
          passkeys are turned off here.
        </div>
        <p className="hint">
          Your account is matched by your primary email, {me.email}.
          {state.passkeys.length > 0 && ` Your ${state.passkeys.length} passkey${state.passkeys.length === 1 ? ' is' : 's are'} kept, and work again if a site admin switches back.`}
        </p>
      </section>
    )
  return (
    <div className="section-stack">
      <section className="section">
        <h2>Email code</h2>
        <p className="hint">
          You can always sign in with a one-time code sent to <b>{me.email}</b>. There are no passwords.
        </p>
      </section>
      <section className="section">
        <h2>
          Passkeys <span className="muted">{state.passkeys.length}</span>
        </h2>
        <p className="hint">
          Sign in with your fingerprint, face, screen lock or a security key instead of waiting for an email. Passkeys are only added right after you sign in
          with an email code, never from a session that’s already open, so a stolen session can’t give itself one.
        </p>
        <div className="card-list">
          {state.passkeys.map((p) => (
            <div key={p.id} className="passkey-row">
              <div className="passkey-main">
                <b>🔑 {p.name}</b>
                <span className="muted">
                  Added {ago(p.createdAt)} · {p.lastUsedAt ? `last used ${ago(p.lastUsedAt)}` : 'never used'}
                </span>
              </div>
              <button
                className="ghost danger"
                onClick={() => {
                  dispatch({ type: 'removePasskey', id: p.id })
                  dispatch({ type: 'toast', text: `Removed “${p.name}”. It can’t sign you in any more.` })
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {state.passkeys.length === 0 && <Empty>No passkeys. Next time you sign in with an email code, you’ll be offered one.</Empty>}
        </div>
      </section>
    </div>
  )
}

function initialsOf(name: string) {
  const p = name.split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

// ---------- tokens ----------

const PURPOSES: { id: TokenPurpose; label: string; blurb: string }[] = [
  { id: 'me', label: 'Me', blurb: 'For your own use of the ideaf CLI. Activity shows as you.' },
  { id: 'userbot', label: 'A bot working for me', blurb: 'For an agent you drive (e.g. a coding agent). Activity shows as the bot, on your behalf.' },
  { id: 'bot', label: 'A bot on its own', blurb: 'For fully automated checks (e.g. CI). Activity shows as the bot, marked automated, not tied to you.' },
]

function purposeLabel(p: TokenPurpose) {
  return PURPOSES.find((x) => x.id === p)!.label
}

function Tokens() {
  const { state, dispatch } = useStore()
  const [creating, setCreating] = useState(false)
  const [creatingAdmin, setCreatingAdmin] = useState(false)
  const [revoking, setRevoking] = useState<Token | null>(null)
  const personal = state.tokens.filter((t) => t.scope === 'personal')
  const adminTokens = state.tokens.filter((t) => t.scope === 'site-admin')

  return (
    <>
      <div className="section-head">
        <p className="hint tokens-intro">
          Tokens let the <code>ideaf</code> CLI and agents act in Ideation Factory. What a token is for decides how its activity is labeled, so people
          can tell your own work from a bot’s.
          {state.siteAdmin && ' These never have site admin access, even though you’re a site admin.'}
        </p>
        <button className="primary" onClick={() => setCreating(true)}>
          New token
        </button>
      </div>

      <div className="token-table" role="table">
        <div className="token-row token-head" role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Shows as</span>
          <span role="columnheader">Last used</span>
          <span role="columnheader">Expires</span>
          <span role="columnheader" />
        </div>
        {personal.map((t) => (
          <div key={t.id} className="token-row" role="row">
            <span role="cell">
              <b>{t.name}</b>
              <span className="token-meta">
                <span className="tag">{purposeLabel(t.purpose)}</span> <code>{t.prefix}…</code>
              </span>
            </span>
            <span role="cell">
              <ActorLabel actor={t.purpose === 'me' ? { kind: 'user', userId: ME } : t.purpose === 'userbot' ? { kind: 'userbot', bot: t.bot!, userId: ME } : { kind: 'bot', bot: t.bot! }} />
            </span>
            <span role="cell" className="muted">
              {t.lastUsedAt ? ago(t.lastUsedAt) : 'Never'}
            </span>
            <span role="cell" className="muted">
              {new Date(t.expiresAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span role="cell">
              <button className="ghost danger" onClick={() => setRevoking(t)}>
                Revoke
              </button>
            </span>
          </div>
        ))}
        {personal.length === 0 && <Empty>No tokens. Create one to use the ideaf CLI.</Empty>}
      </div>

      {state.siteAdmin && (
        <section className="section admin-tokens">
          <AdminCallout title="Site admin tokens">
            A separate, more dangerous kind of token. It can do anything a site admin can (permanently delete teams, mark people inactive, change any team
            or group’s settings and roles) and acts as you. Make one only for automation that truly needs it. They last at most 30 days, need a reason,
            and every use is logged.
          </AdminCallout>
          <div className="section-head">
            <span className="muted">
              {adminTokens.length} site admin token{adminTokens.length === 1 ? '' : 's'}
            </span>
            <button className="via-admin" onClick={() => setCreatingAdmin(true)}>
              New site admin token
            </button>
          </div>
          <div className="token-table token-table-admin" role="table">
            {adminTokens.map((t) => (
              <div key={t.id} className="token-row" role="row">
                <span role="cell">
                  <b>{t.name}</b>
                  <span className="token-meta">
                    <AdminMark label="Site admin" /> <code>{t.prefix}…</code>
                  </span>
                </span>
                <span role="cell" className="token-reason">
                  {t.reason}
                </span>
                <span role="cell" className="muted">
                  {t.lastUsedAt ? `Used ${ago(t.lastUsedAt)}` : 'Never used'}
                </span>
                <span role="cell" className="muted">
                  {`Expires ${new Date(t.expiresAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`}
                </span>
                <span role="cell">
                  <button className="ghost danger" onClick={() => setRevoking(t)}>
                    Revoke
                  </button>
                </span>
              </div>
            ))}
            {adminTokens.length === 0 && <Empty>No site admin tokens.</Empty>}
          </div>
        </section>
      )}

      {creating && <TokenDialog onClose={() => setCreating(false)} />}
      {creatingAdmin && <AdminTokenDialog onClose={() => setCreatingAdmin(false)} />}
      {revoking && (
        <Dialog
          title={`Revoke “${revoking.name}”?`}
          onClose={() => setRevoking(null)}
          footer={
            <>
              <button className="ghost" onClick={() => setRevoking(null)}>
                Cancel
              </button>
              <button
                className="danger-solid"
                onClick={() => {
                  dispatch({ type: 'revokeToken', id: revoking.id })
                  dispatch({ type: 'toast', text: `Revoked ${revoking.name}` })
                  setRevoking(null)
                }}
              >
                Revoke token
              </button>
            </>
          }
        >
          <p>
            Anything using this token stops working immediately{revoking.bot ? `, including ${revoking.bot}` : ''}. Past activity keeps its
            attribution. This can’t be undone.
          </p>
        </Dialog>
      )}
    </>
  )
}

// Every token expires; personal tokens last at most a year.
const EXPIRY = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: '1 year (the most allowed)', days: 365 },
]

function TokenDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState<TokenPurpose>('me')
  const [bot, setBot] = useState('')
  const [expiry, setExpiry] = useState('90')
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const needsBot = purpose !== 'me'
  const botOk = !needsBot || /^[a-z][a-z0-9-]{1,30}$/.test(bot)
  const valid = name.trim().length > 0 && botOk
  const meName = state.users[ME].name

  const create = () => {
    if (!valid) return
    const value = newTokenValue(purpose)
    const days = EXPIRY.find((e) => e.id === expiry)!.days
    dispatch({
      type: 'createToken',
      token: {
        id: `t-${Date.now()}`,
        name: name.trim(),
        scope: 'personal',
        purpose,
        bot: needsBot ? bot : undefined,
        prefix: value.slice(0, value.indexOf('_', 6) + 5),
        createdAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + days * 86_400_000).toISOString(),
      },
    })
    setCreated(value)
  }

  if (created)
    return (
      <Dialog
        title="Copy your new token"
        onClose={onClose}
        footer={
          <button className="primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <p>This is the only time it’s shown. Store it somewhere safe, like your agent’s secret store.</p>
        <div className="token-value">
          <code>{created}</code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(created).catch(() => {})
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="hint">Use it with the CLI:</p>
        <pre className="token-cli">
          {purpose === 'me' ? `ideaf auth login --with-token < token.txt` : `IDEAF_TOKEN=${created.slice(0, 12)}… ideaf comments list`}
        </pre>
      </Dialog>
    )

  return (
    <Dialog
      title="New token"
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!valid} onClick={create}>
            Create token
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Work laptop, Review agent, CI" maxLength={60} />
        <span className="hint">Only you see this. It helps you tell tokens apart.</span>
      </label>

      <fieldset className="field purpose">
        <legend className="field-label">What is it for?</legend>
        {PURPOSES.map((p) => (
          <label key={p.id} className={`purpose-option ${purpose === p.id ? 'on' : ''}`}>
            <input type="radio" name="purpose" value={p.id} checked={purpose === p.id} onChange={() => setPurpose(p.id)} />
            <span className="purpose-text">
              <b>{p.label}</b>
              <span className="hint">{p.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {needsBot && (
        <label className="field">
          <span className="field-label">Bot name</span>
          <input value={bot} onChange={(e) => setBot(e.target.value.toLowerCase())} placeholder="e.g. reviewbot" maxLength={31} />
          {bot && !botOk && <span className="field-error">Lowercase letters, numbers and dashes, starting with a letter.</span>}
        </label>
      )}

      <div className="field">
        <span className="field-label">Its activity will show as</span>
        <div className="preview">
          <div className="preview-row">
            {purpose === 'me' ? (
              <>
                <Avatar userId={ME} size="sm" /> <b>{meName}</b>
              </>
            ) : (
              <>
                <span className="bot-mark" aria-hidden>
                  🤖
                </span>
                <b className="preview-bot">{bot || 'botname'}</b>
                {purpose === 'userbot' ? (
                  <span className="actor-behalf">
                    on behalf of <span className="actor-person">{meName}</span>
                  </span>
                ) : (
                  <span className="tag tag-bot">automated</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <label className="field">
        <span className="field-label">Expires</span>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
          {EXPIRY.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <span className="hint">Tokens always expire, after a year at most. Make a new one when it does.</span>
      </label>
    </Dialog>
  )
}

// Site admin tokens: separate from personal tokens, short-lived, need a reason,
// and the dialog spells out how much they can do.
const ADMIN_EXPIRY = [
  { id: '1', label: '1 day', days: 1 },
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days (the most allowed)', days: 30 },
]

function AdminTokenDialog({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore()
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [expiry, setExpiry] = useState('7')
  const [ack, setAck] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const valid = name.trim().length > 0 && reason.trim().length >= 10 && ack

  if (created)
    return (
      <Dialog
        title="Copy your site admin token"
        onClose={onClose}
        footer={
          <button className="primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <AdminCallout title="Treat this like a master key">
          Anyone with this token can act as a site admin, as you, until it expires or you revoke it. It’s shown only once. Put it straight into a secret
          store, never in a repo, chat or ticket.
        </AdminCallout>
        <div className="token-value">
          <code>{created}</code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(created).catch(() => {})
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="token-cli">{`IDEAF_ADMIN_TOKEN=${created.slice(0, 13)}… ideaf admin users deactivate @someone`}</pre>
      </Dialog>
    )

  return (
    <Dialog
      title="New site admin token"
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="danger-solid"
            disabled={!valid}
            onClick={() => {
              const value = newTokenValue('site-admin')
              const days = ADMIN_EXPIRY.find((e) => e.id === expiry)!.days
              dispatch({
                type: 'createToken',
                token: {
                  id: `t-${Date.now()}`,
                  name: name.trim(),
                  scope: 'site-admin',
                  reason: reason.trim(),
                  purpose: 'me',
                  prefix: value.slice(0, 13),
                  createdAt: new Date(NOW).toISOString(),
                  expiresAt: new Date(NOW + days * 86_400_000).toISOString(),
                },
              })
              setCreated(value)
            }}
          >
            🛡 Create site admin token
          </button>
        </>
      }
    >
      <AdminCallout title="This token can do anything a site admin can">
        Permanently delete teams and everything in them, mark people inactive, change any team’s or group’s settings, roles and requirements, and read
        everything. It acts as you, and its activity is labeled “via site admin token”.
      </AdminCallout>
      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Offboarding sync" maxLength={60} />
      </label>
      <label className="field">
        <span className="field-label">Why does this need site admin access?</span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Marks people inactive from the HR leavers feed" />
        <span className="hint">Required. It’s logged with every use and shown to other site admins.</span>
      </label>
      <label className="field">
        <span className="field-label">Expires</span>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
          {ADMIN_EXPIRY.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <span className="hint">Site admin tokens can’t last longer than 30 days.</span>
      </label>
      <label className="check admin-ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand anyone holding this token can act as a site admin,
        as me.
      </label>
    </Dialog>
  )
}
