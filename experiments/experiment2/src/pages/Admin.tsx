// PROTOTYPE: the site admin page. Everyone in the organization, with the
// option to mark people inactive (read-only), e.g. when they leave the company.
// Also lists teams and groups that no longer have an active admin.
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { EMAIL_DOMAIN, ME, type ExternalImages, type SignIn, type User } from '../data'
import { useStore } from '../store'
import { ago, isActive, isOpen, noActiveAdmin } from '../model'
import { rank } from '../search'
import { AdminCallout, AdminMark, Avatar, Dialog, Empty, InactiveTag, PageHeader, SearchInput, fmt, usePaged, useParam } from '../ui'

export function Admin() {
  const [tab, setTab] = useParam<'people' | 'deployment' | 'signin'>('tab', 'people')
  const { state } = useStore()
  if (!state.siteAdmin)
    return (
      <div className="page">
        <PageHeader title="Site admin" />
        <Empty>Only site admins can open this page. (In the prototype, use the “site admin” switch in the corner.)</Empty>
      </div>
    )
  return (
    <div className="page">
      <PageHeader title={<>Site admin <AdminMark /></>} sub="Settings and people across the whole deployment." />
      <AdminCallout title="Everything on this page is a site admin action">
        Other people never see this page. Changes here affect everyone in the organization and are logged as site admin actions.
      </AdminCallout>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>
          People
        </button>
        <button role="tab" aria-selected={tab === 'deployment'} className={tab === 'deployment' ? 'on' : ''} onClick={() => setTab('deployment')}>
          Deployment
        </button>
        <button role="tab" aria-selected={tab === 'signin'} className={tab === 'signin' ? 'on' : ''} onClick={() => setTab('signin')}>
          Sign-in
        </button>
      </div>
      {tab === 'people' ? <People /> : tab === 'deployment' ? <DeploymentSettings /> : <SignInSettings />}
    </div>
  )
}

function People() {
  const { state } = useStore()
  const [q, setQ] = useParam<string>('q', '')
  const [show, setShow] = useParam<'active' | 'inactive' | 'all'>('show', 'active')
  const [confirming, setConfirming] = useState<User | null>(null)

  const counts = useMemo(() => {
    const teams = new Map<string, number>()
    const groups = new Map<string, number>()
    for (const t of state.teams) if (!t.personal) for (const m of t.members) teams.set(m, (teams.get(m) ?? 0) + 1)
    for (const g of state.groups) if (!g.deletedAt) for (const m of g.members) groups.set(m, (groups.get(m) ?? 0) + 1)
    return { teams, groups }
  }, [state.teams, state.groups])

  const people = useMemo(() => {
    const pool = Object.values(state.users).filter((u) => (show === 'active' ? !u.inactive : show === 'inactive' ? !!u.inactive : true))
    return q.trim()
      ? rank(pool, q.replace(/^@/, ''), (u) => [
          { name: 'name', text: u.name, weight: 0 },
          { name: 'handle', text: u.handle, weight: 1 },
        ]).map((r) => r.item)
      : pool.sort((a, b) => a.name.localeCompare(b.name))
  }, [state.users, q, show])
  const { slice, pager } = usePaged(people)
  const orphans = [
    ...state.teams.filter((t) => !t.personal && !t.archivedAt && noActiveAdmin(state, t)).map((t) => ({ kind: 'team' as const, m: t })),
    ...state.groups.filter((g) => !g.deletedAt && noActiveAdmin(state, g)).map((g) => ({ kind: 'group' as const, m: g })),
  ]
  const inactiveCount = Object.values(state.users).filter((u) => u.inactive).length

  return (
    <>
      <p className="hint">Mark someone inactive when they leave: they become read-only and their tokens stop working.</p>

      {orphans.length > 0 && (
        <section className="section">
          <h2>Needs a new admin</h2>
          <p className="hint">Every admin of these is inactive, so nobody can manage their settings. Make someone else an admin.</p>
          <div className="card-list">
            {orphans.map(({ kind, m }) => (
              <Link
                key={m.id}
                className="attention is-error"
                to={kind === 'team' ? '/teams/$teamId/settings' : '/groups/$groupId/settings'}
                params={(kind === 'team' ? { teamId: m.id } : { groupId: m.id }) as never}
                search={{ tab: 'members' } as never}
              >
                ⚠ {kind === 'team' ? 'Team' : 'Group'} <b>{m.name}</b>: {m.admins.map((a) => state.users[a]?.name).join(', ')}{' '}
                {m.admins.length === 1 ? 'is' : 'are'} inactive. Pick a new admin →
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>People</h2>
        <SearchInput value={q} onChange={setQ} placeholder="Search by name or @handle" label="Search people" />
        <div className="toolbar">
          <div className="seg" role="radiogroup" aria-label="Show">
            {(
              [
                ['active', 'Active'],
                ['inactive', `Inactive (${inactiveCount})`],
                ['all', 'Everyone'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
                {label}
              </button>
            ))}
          </div>
          <span className="muted toolbar-note">
            {fmt(people.length)} {people.length === 1 ? 'person' : 'people'}
          </span>
        </div>
        <div className="member-table" role="table">
          {slice.map((u) => (
            <div key={u.id} className={`member-row admin-row ${u.inactive ? 'is-inactive' : ''}`} role="row">
              <span role="cell" className="actor">
                <Avatar userId={u.id} size="sm" />
                <span>
                  <b>{u.name}</b> <span className="muted">@{u.handle}</span>
                </span>
                <InactiveTag userId={u.id} />
              </span>
              <span role="cell" className="muted">
                {u.inactive
                  ? `Inactive ${ago(u.inactive.since)}, by ${state.users[u.inactive.by]?.name ?? 'a site admin'}`
                  : `${fmt(counts.teams.get(u.id) ?? 0)} teams · ${fmt(counts.groups.get(u.id) ?? 0)} groups`}
              </span>
              <span role="cell">
                <button
                  className={u.inactive ? '' : 'ghost danger'}
                  disabled={u.id === ME}
                  title={u.id === ME ? 'You can’t mark yourself inactive.' : undefined}
                  onClick={() => setConfirming(u)}
                >
                  {u.inactive ? 'Reactivate' : 'Mark inactive'}
                </button>
              </span>
            </div>
          ))}
        </div>
        {pager}
        {people.length === 0 && <Empty>No one matches.</Empty>}
      </section>

      {confirming && <InactiveDialog user={confirming} onClose={() => setConfirming(null)} />}
    </>
  )
}

// Deployment-wide decisions: how ideas handle images. Not per team or per user.
function DeploymentSettings() {
  const { state, dispatch } = useStore()
  const [external, setExternal] = useState<ExternalImages>(state.deployment.externalImages)
  const [maxMB, setMaxMB] = useState(String(state.deployment.maxImageMB))
  const mb = Number(maxMB)
  const valid = Number.isFinite(mb) && mb >= 1 && mb <= 100
  const dirty = external !== state.deployment.externalImages || mb !== state.deployment.maxImageMB
  return (
    <section className="section settings-form">
      <fieldset className="field purpose">
        <legend className="field-label">External images in ideas</legend>
        <span className="hint">Images in markdown that point at another site (https://…). Loading them tells that site who is reading and when.</span>
        {(
          [
            ['click', 'Show after a click', 'Readers see a placeholder and choose to load each image. The default.'],
            ['always', 'Always show', 'Images load automatically, like any web page. Outside sites can see who reads which idea.'],
            ['never', 'Never show', 'Only a link to the image. Nothing is loaded from outside sites.'],
          ] as const
        ).map(([id, label, blurb]) => (
          <label key={id} className={`purpose-option ${external === id ? 'on' : ''}`}>
            <input type="radio" name="external" checked={external === id} onChange={() => setExternal(id)} />
            <span className="purpose-text">
              <b>{label}</b>
              <span className="hint">{blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field-label">Maximum image upload size</span>
        <span className="rule-count">
          <input type="number" min={1} max={100} value={maxMB} onChange={(e) => setMaxMB(e.target.value)} aria-label="Maximum image upload size in MB" /> MB per
          image
        </span>
        <span className="hint">
          The cli skips larger images and lists them; the idea shows a placeholder with a link to the source. A repository’s own cli config can set a lower limit,
          never a higher one.
        </span>
        {!valid && <span className="field-error">Pick a size from 1 to 100 MB.</span>}
      </label>
      <div className="row-end">
        <button
          className="ghost"
          disabled={!dirty}
          onClick={() => {
            setExternal(state.deployment.externalImages)
            setMaxMB(String(state.deployment.maxImageMB))
          }}
        >
          Discard
        </button>
        <button
          className="primary via-admin-solid"
          disabled={!dirty || !valid}
          onClick={() => {
            dispatch({ type: 'setDeployment', deployment: { ...state.deployment, externalImages: external, maxImageMB: mb } })
            dispatch({ type: 'toast', text: 'Deployment settings saved. They apply to everyone.' })
          }}
        >
          🛡 Save for everyone
        </button>
      </div>
    </section>
  )
}

// How people sign in, for the whole deployment. Built-in (email code or
// passkey) by default; an organization can switch to its own identity provider
// (SAML or OIDC), optionally creating accounts for people who don't have one.
function SignInSettings() {
  const { state, dispatch } = useStore()
  const cur = state.deployment.signIn
  const [mode, setMode] = useState<SignIn['mode']>(cur.mode)
  const [protocol, setProtocol] = useState<'saml' | 'oidc'>(cur.mode === 'sso' ? cur.protocol : 'saml')
  const [provider, setProvider] = useState(cur.mode === 'sso' ? cur.provider : 'Acme SSO')
  const [autoCreate, setAutoCreate] = useState(cur.mode === 'sso' ? cur.autoCreate : true)
  const [domains, setDomains] = useState(cur.mode === 'sso' ? cur.domains.join(', ') : EMAIL_DOMAIN)
  const domainList = domains
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  const next: SignIn = mode === 'builtin' ? { mode } : { mode, protocol, provider: provider.trim(), autoCreate, domains: domainList }
  const dirty = JSON.stringify(next) !== JSON.stringify(cur)
  const valid = mode === 'builtin' || (provider.trim().length > 0 && domainList.length > 0)
  const people = Object.values(state.users)
  const outside = mode === 'sso' ? people.filter((u) => !u.inactive && !domainList.some((d) => u.email.endsWith(`@${d}`))).length : 0
  const active = people.filter((u) => !u.inactive).length
  const reset = () => {
    setMode(cur.mode)
    if (cur.mode === 'sso') {
      setProtocol(cur.protocol)
      setProvider(cur.provider)
      setAutoCreate(cur.autoCreate)
      setDomains(cur.domains.join(', '))
    }
  }
  return (
    <section className="section settings-form">
      <fieldset className="field purpose">
        <legend className="field-label">How people sign in</legend>
        <span className="hint">Every account has a name, a handle and a primary email. The sign-in method decides how people prove they own that email.</span>
        {(
          [
            ['builtin', 'Email code or passkey', 'The default. People sign up with their email, get a one-time code, pick a name and a handle, and can add passkeys. No passwords.'],
            ['sso', 'Your organization’s single sign-on', 'People sign in through your identity provider (SAML or OIDC). Accounts match on primary email. Email codes and passkeys are turned off.'],
          ] as const
        ).map(([id, label, blurb]) => (
          <label key={id} className={`purpose-option ${mode === id ? 'on' : ''}`}>
            <input type="radio" name="signin" checked={mode === id} onChange={() => setMode(id)} />
            <span className="purpose-text">
              <b>{label}</b>
              <span className="hint">{blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {mode === 'sso' && (
        <div className="sso-fields">
          <label className="field">
            <span className="field-label">Protocol</span>
            <select value={protocol} onChange={(e) => setProtocol(e.target.value as 'saml' | 'oidc')}>
              <option value="saml">SAML 2.0</option>
              <option value="oidc">OpenID Connect (OIDC)</option>
            </select>
            <span className="hint">
              {protocol === 'saml' ? 'Upload your provider’s metadata XML, and give it this deployment’s ACS URL and entity ID.' : 'Enter your provider’s issuer URL, client ID and secret, and add this deployment’s redirect URL.'}{' '}
              (Not prototyped.)
            </span>
          </label>
          <label className="field">
            <span className="field-label">Button label</span>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={40} />
            <span className="hint">Shown on the sign-in page: “Continue with {provider.trim() || '…'}”.</span>
          </label>
          <label className="field">
            <span className="field-label">Email domains</span>
            <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.dev, acme.co.uk" />
            <span className="hint">Only these domains can sign in. Separate several with commas.</span>
            {domainList.length === 0 && <span className="field-error">Add at least one domain.</span>}
          </label>
          <label className="check rule-auto">
            <input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} />
            <span>
              Create accounts automatically
              <span className="hint">
                {' '}
                · anyone your provider signs in who doesn’t have an account gets one: name and email from the provider, and a handle suggested from their email
                that they confirm on first visit. Off: a site admin has to invite them first.
              </span>
            </span>
          </label>
        </div>
      )}

      {dirty && mode === 'sso' && cur.mode === 'builtin' && (
        <div className="banner banner-warn">
          <b>Switching to single sign-on changes how all {fmt(active)} active people sign in.</b> Each existing account is matched to your provider by its
          primary email, so their ideas, comments and tokens carry over. Email codes and passkeys stop working.
          {outside > 0 && (
            <>
              {' '}
              <b>
                {fmt(outside)} {outside === 1 ? 'person has' : 'people have'} a primary email outside {domainList.join(', ') || 'those domains'}
              </b>{' '}
              and won’t be able to sign in.
            </>
          )}{' '}
          Keep a site admin session open while you test it.
        </div>
      )}
      {dirty && mode === 'builtin' && cur.mode === 'sso' && (
        <div className="banner banner-warn">
          <b>Switching back to email codes and passkeys.</b> People sign in with a code sent to their primary email, then can add passkeys again. Accounts and
          everything in them stay as they are.
        </div>
      )}

      <div className="row-end">
        <Link to="/signup" className="button ghost">
          Preview sign-up →
        </Link>
        <button className="ghost" disabled={!dirty} onClick={reset}>
          Discard
        </button>
        <button
          className="primary via-admin-solid"
          disabled={!dirty || !valid}
          onClick={() => {
            dispatch({ type: 'setDeployment', deployment: { ...state.deployment, signIn: next } })
            dispatch({ type: 'toast', text: next.mode === 'sso' ? `Sign-in now goes through ${next.provider}.` : 'Sign-in is back to email codes and passkeys.' })
          }}
        >
          🛡 Save for everyone
        </button>
      </div>
    </section>
  )
}

function InactiveDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const reactivate = !!user.inactive
  const wrote = state.ideas.filter((i) => i.authorId === user.id && isOpen(state, i)).length
  const reviewing = state.ideas.filter((i) => isActive(state, i) && i.reviewers.some((r) => r.kind === 'user' && r.userId === user.id)).length
  const soleAdmin = [
    ...state.teams.filter((t) => !t.archivedAt && t.admins.includes(user.id) && t.admins.every((a) => a === user.id || state.users[a]?.inactive)),
    ...state.groups.filter((g) => !g.deletedAt && g.admins.includes(user.id) && g.admins.every((a) => a === user.id || state.users[a]?.inactive)),
  ]
  const done = () => {
    dispatch({ type: 'setInactive', userId: user.id, inactive: !reactivate })
    dispatch({ type: 'toast', text: reactivate ? `${user.name} is active again` : `${user.name} is now inactive (read only)` })
    onClose()
  }

  if (reactivate)
    return (
      <Dialog
        title={`Reactivate ${user.name}?`}
        onClose={onClose}
        footer={
          <>
            <button className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" onClick={done}>
              Reactivate
            </button>
          </>
        }
      >
        <p>
          {user.name} (@{user.handle}) will be able to comment, review, upload and change things again, and their tokens (including bots acting on
          their behalf) will work again. Their teams, groups and roles are as they left them.
        </p>
      </Dialog>
    )

  return (
    <Dialog
      title={`Mark ${user.name} inactive?`}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="danger-solid" onClick={done}>
            Mark inactive
          </button>
        </>
      }
    >
      <p>
        Use this when someone leaves. {user.name} (@{user.handle}) becomes <b>read only</b>:
      </p>
      <ul className="consequences">
        <li>They can still sign in and read, but can’t comment, review, approve, upload or change settings.</li>
        <li>Their tokens stop working, including any bots acting on their behalf.</li>
        <li>They’re marked inactive wherever their name appears, can’t be added to teams or groups, and can’t be asked to review.</li>
        <li>They stop getting notifications.</li>
        <li>Everything they did stays, with their name. Approvals they already gave still count.</li>
        {wrote > 0 && (
          <li>
            The {fmt(wrote)} open idea{wrote === 1 ? '' : 's'} they wrote stay open, but they can’t update {wrote === 1 ? 'it' : 'them'}.
          </li>
        )}
        {reviewing > 0 && (
          <li>
            They’re a reviewer on {fmt(reviewing)} active idea{reviewing === 1 ? '' : 's'}. Those authors may want to ask someone else.
          </li>
        )}
        {soleAdmin.length > 0 && (
          <li className="is-serious">
            They’re the only active admin of <b>{soleAdmin.map((m) => m.name).join(', ')}</b>. {soleAdmin.length === 1 ? 'It' : 'Those'} will have no one to
            manage {soleAdmin.length === 1 ? 'it' : 'them'} until you make someone else an admin.
          </li>
        )}
      </ul>
      <p className="hint">You can reactivate them later.</p>
    </Dialog>
  )
}
