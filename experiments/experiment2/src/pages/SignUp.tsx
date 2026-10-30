// PROTOTYPE: sign in / sign up, previewed while still logged in as Riley.
// Follows the deployment's sign-in setting (Site admin → Sign-in):
//   built-in: email → one-time code → (new account) name + handle → offer a passkey;
//             (returning account) → offer a passkey. Passkeys are only ever added
//             here, right after an email code, never from an open session.
//             Or sign in with a passkey straight away (no offer).
//   single sign-on: "Continue with <provider>" → the provider vouches for a name and
//             email → existing account: signed in; none: create one (confirm the
//             handle) if auto-create is on, otherwise "ask a site admin"
// Nothing here changes the prototype's state.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useStore } from '../store'
import { handleProblem, isEmail, suggestHandle, userByEmail } from '../model'

type Step =
  | { at: 'start' }
  | { at: 'code'; email: string }
  | { at: 'profile'; email: string; fromProvider: boolean; name: string }
  | { at: 'passkey'; name: string; handle: string; returning: boolean }
  | { at: 'done'; name: string; handle: string; returning: boolean }
  | { at: 'no-account'; email: string }

// who the pretend identity provider says you are
const PROVIDER_PERSON = { name: 'Jamie Rivera', email: 'jamie.rivera@acme.dev' }

export function SignUp() {
  const { state } = useStore()
  const signIn = state.deployment.signIn
  const [step, setStep] = useState<Step>({ at: 'start' })
  const restart = () => setStep({ at: 'start' })

  return (
    <div className="auth-page">
      <div className="auth-preview-bar">
        Preview of the sign-in page ({signIn.mode === 'sso' ? `single sign-on through ${signIn.provider}` : 'email code or passkey'}). Nothing here changes
        your account. <Link to="/">Back to the prototype</Link>
      </div>
      <main className="auth-card">
        <div className="auth-brand">
          <span className="nav-logo" aria-hidden>
            ✳
          </span>{' '}
          Ideation Factory
        </div>

        {step.at === 'start' &&
          (signIn.mode === 'sso' ? (
            <>
              <h1>Sign in</h1>
              <p className="auth-sub">Use your {signIn.provider} account. New here? Your account is set up the first time you sign in.</p>
              <button
                className="primary auth-wide"
                onClick={() => {
                  const existing = userByEmail(state, PROVIDER_PERSON.email)
                  if (existing) setStep({ at: 'done', name: existing.name, handle: existing.handle, returning: true })
                  else if (signIn.autoCreate) setStep({ at: 'profile', email: PROVIDER_PERSON.email, fromProvider: true, name: PROVIDER_PERSON.name })
                  else setStep({ at: 'no-account', email: PROVIDER_PERSON.email })
                }}
              >
                Continue with {signIn.provider}
              </button>
              <p className="hint">
                Prototype: {signIn.provider} signs you in as {PROVIDER_PERSON.name} ({PROVIDER_PERSON.email}), who doesn’t have an account yet.
              </p>
            </>
          ) : (
            <EmailStart
              onEmail={(email) => setStep({ at: 'code', email })}
              onPasskey={() => setStep({ at: 'done', name: state.users.riley.name, handle: state.users.riley.handle, returning: true })}
            />
          ))}

        {step.at === 'code' && (
          <CodeStep
            email={step.email}
            onBack={restart}
            onOk={() => {
              const existing = userByEmail(state, step.email)
              if (existing) setStep({ at: 'passkey', name: existing.name, handle: existing.handle, returning: true })
              else setStep({ at: 'profile', email: step.email, fromProvider: false, name: '' })
            }}
          />
        )}

        {step.at === 'profile' && (
          <ProfileStep
            email={step.email}
            fromProvider={step.fromProvider}
            providerName={signIn.mode === 'sso' ? signIn.provider : ''}
            initialName={step.name}
            onBack={restart}
            onDone={(name, handle) => setStep(step.fromProvider ? { at: 'done', name, handle, returning: false } : { at: 'passkey', name, handle, returning: false })}
          />
        )}

        {step.at === 'passkey' && (
          <>
            <h1>{step.returning ? 'Add a passkey for this device?' : 'Add a passkey?'}</h1>
            <p className="auth-sub">
              Next time, sign in with your fingerprint, face, screen lock or a security key instead of waiting for an email. This is the only place passkeys are
              added: right after you sign in with a code.
            </p>
            <button className="primary auth-wide" onClick={() => setStep({ at: 'done', name: step.name, handle: step.handle, returning: step.returning })}>
              Add a passkey
            </button>
            <button className="ghost auth-wide" onClick={() => setStep({ at: 'done', name: step.name, handle: step.handle, returning: step.returning })}>
              Skip for now
            </button>
          </>
        )}

        {step.at === 'done' && (
          <>
            <h1>{step.returning ? `Welcome back, ${step.name.split(' ')[0]}` : `You’re in, ${step.name.split(' ')[0]}`}</h1>
            <p className="auth-sub">
              {step.returning ? 'Signed in' : 'Your account is ready'} as <b>{step.name}</b> <span className="handle-value">@{step.handle}</span>.
            </p>
            <Link to="/" className="button primary auth-wide">
              Go to Ideation Factory
            </Link>
            <button className="link" onClick={restart}>
              Start the preview again
            </button>
          </>
        )}

        {step.at === 'no-account' && (
          <>
            <h1>No account yet</h1>
            <p className="auth-sub">
              {signIn.mode === 'sso' ? signIn.provider : 'Your provider'} signed you in as <b>{step.email}</b>, but there’s no Ideation Factory account for it, and
              this deployment doesn’t create them automatically. Ask a site admin to invite you.
            </p>
            <button className="ghost auth-wide" onClick={restart}>
              Back
            </button>
          </>
        )}
      </main>
    </div>
  )
}

function EmailStart({ onEmail, onPasskey }: { onEmail: (email: string) => void; onPasskey: () => void }) {
  const [email, setEmail] = useState('')
  const clean = email.trim().toLowerCase()
  const [tried, setTried] = useState(false)
  const bad = tried && !isEmail(clean)
  return (
    <>
      <h1>Sign in or sign up</h1>
      <p className="auth-sub">Enter your email and we’ll send you a code. If you don’t have an account yet, you’ll make one next.</p>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault()
          setTried(true)
          if (isEmail(clean)) onEmail(clean)
        }}
      >
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email webauthn" placeholder="you@example.com" autoFocus />
          {bad && <span className="field-error">Enter an email address.</span>}
        </label>
        <button className="primary auth-wide" type="submit">
          Email me a code
        </button>
      </form>
      <div className="auth-or">or</div>
      <button className="auth-wide" onClick={onPasskey}>
        🔑 Sign in with a passkey
      </button>
      <p className="hint">Prototype: riley.park@acme.dev (or the passkey) signs in as Riley; any other address makes a new account.</p>
    </>
  )
}

function CodeStep({ email, onBack, onOk }: { email: string; onBack: () => void; onOk: () => void }) {
  const [code, setCode] = useState('')
  const [resent, setResent] = useState(false)
  return (
    <>
      <h1>Check your email</h1>
      <p className="auth-sub">
        We sent a 6-digit code to <b>{email}</b>. It expires in 10 minutes.
      </p>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (/^\d{6}$/.test(code)) onOk()
        }}
      >
        <label className="field">
          <span className="field-label">Code</span>
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
            aria-label="6-digit code"
          />
          <span className="hint">Prototype: any 6 digits work.</span>
        </label>
        <button className="primary auth-wide" type="submit" disabled={!/^\d{6}$/.test(code)}>
          Continue
        </button>
      </form>
      <div className="auth-links">
        <button className="link" onClick={onBack}>
          Use a different email
        </button>
        <button className="link" disabled={resent} onClick={() => setResent(true)}>
          {resent ? 'Sent again' : 'Send it again'}
        </button>
      </div>
    </>
  )
}

function ProfileStep({
  email,
  fromProvider,
  providerName,
  initialName,
  onBack,
  onDone,
}: {
  email: string
  fromProvider: boolean
  providerName: string
  initialName: string
  onBack: () => void
  onDone: (name: string, handle: string) => void
}) {
  const { state } = useStore()
  const [name, setName] = useState(initialName)
  const [handle, setHandle] = useState(() => suggestHandle(state, email))
  const problem = handleProblem(state, handle)
  const nameOk = name.trim().length > 0 && name.trim().length <= 60
  return (
    <>
      <h1>{fromProvider ? 'Set up your account' : 'Create your account'}</h1>
      <p className="auth-sub">
        {fromProvider ? (
          <>
            {providerName} signed you in as <b>{email}</b>. Pick the handle people will @mention you by.
          </>
        ) : (
          <>
            For <b>{email}</b>. Your name shows on your ideas and comments; your handle is how people @mention you.
          </>
        )}
      </p>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (nameOk && !problem) onDone(name.trim(), handle)
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} readOnly={fromProvider} autoFocus={!fromProvider} />
          {fromProvider && <span className="hint">From {providerName}. You can change it later in Settings.</span>}
        </label>
        <label className="field">
          <span className="field-label">Handle</span>
          <span className="handle-input">
            <span aria-hidden>@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s+/g, ''))}
              maxLength={39}
              autoFocus={fromProvider}
              aria-label="Handle"
              spellCheck={false}
            />
          </span>
          {problem ? <span className="field-error">{problem}</span> : <span className="field-ok">✓ @{handle} is free</span>}
          <span className="hint">Lowercase letters, numbers, and . - _. It can’t be changed later, so pick one you’ll keep.</span>
        </label>
        <button className="primary auth-wide" type="submit" disabled={!nameOk || !!problem}>
          Create account
        </button>
      </form>
      {!fromProvider && (
        <div className="auth-links">
          <button className="link" onClick={onBack}>
            Use a different email
          </button>
        </div>
      )}
    </>
  )
}
