// Bare pages until the web app (step 8) has real ones, talking to Better
// Auth's endpoints from the browser: sign in (an email code and a handle the
// first time, or the organization's single sign-on, then back to the web app's
// page in ?next=, or optionally a personal token), the OAuth consent page (what a token may do), and the page that
// shows the cli the code to paste.
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

/** The identity provider, as the sign-in page offers it; null while single sign-on is off. */
export type SsoChoice = { name: string; providerId: string } | null

/** JSON to put inside a script element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c')

export const loginPage = (sso: SsoChoice = null) => html(login(sso))
export const consentPage = () => html(CONSENT)
export const cliCodePage = () => html(CLI_CODE)

const STYLE = `<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 30rem; margin: 3rem auto; padding: 0 1rem; color: #1d1d1f; }
  label { display: block; margin-top: .75rem; }
  fieldset { margin-top: 1rem; border: 1px solid #ccc; border-radius: 6px; }
  input[type=text], input[type=email], input:not([type]) { width: 100%; box-sizing: border-box; }
  input, button { font: inherit; padding: .4rem .6rem; }
  button { margin-top: 1rem; margin-right: .5rem; }
  [hidden] { display: none; }
  .error { color: #b00020; }
  code { word-break: break-all; background: #f2f2f2; padding: .1rem .3rem; }
  .big { font-size: 1.4rem; display: block; padding: .6rem; margin: 1rem 0; }
</style>`

/** Shared script: posting to Better Auth, and the signed OAuth query it hands these pages. */
const SCRIPT_BASE = `
  const $ = (id) => document.getElementById(id)
  const post = async (path, body) => {
    const response = await fetch('/api/auth' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.message || data.error_description || data.error || 'something went wrong (' + response.status + ')')
      error.code = data.code
      throw error
    }
    return data
  }
  const run = (fn) => async (event) => {
    event.preventDefault()
    $('error').textContent = ''
    try { await fn() } catch (error) { $('error').textContent = error.message }
  }
  // During an OAuth sign-in Better Auth signs the request it sends here; hand back just the signed part
  const signedQuery = () => {
    const params = new URLSearchParams(location.search)
    if (!params.has('sig')) return undefined
    const names = new Set(params.getAll('ba_param'))
    const out = new URLSearchParams()
    for (const [name, value] of params.entries()) if (name === 'sig' || name === 'ba_param' || names.has(name)) out.append(name, value)
    return out.toString()
  }
  const follow = (data) => {
    const url = data && (data.url || data.redirect_uri || data.redirectURI)
    if (url) { location.href = url; return true }
    return false
  }
  const currentUser = async () => {
    const response = await fetch('/api/auth/get-session')
    const data = response.ok ? await response.json().catch(() => null) : null
    return (data && data.user) || null
  }
  // An account single sign-on made has a handle suggested from the email: its
  // person keeps or changes it before anything else (resolves with the user)
  const confirmHandle = (user) => new Promise((resolve) => {
    if (!user || user.handleConfirmed !== false) return resolve(user)
    $('suggested').textContent = user.username
    $('new-handle').value = user.username
    $('handle-form').hidden = false
    $('handle-form').onsubmit = run(async () => {
      const { handle } = await post('/ideaf/confirm-handle', { handle: $('new-handle').value.trim() })
      $('handle-form').hidden = true
      resolve({ ...user, username: handle, handleConfirmed: true })
    })
  })
`

const HANDLE_FORM = `<form id="handle-form" hidden>
  <p>Welcome! Your handle is how people mention you: <strong>@<span id="suggested"></span></strong>. Keep it or pick another. You can't change it later.</p>
  <label>Handle (lowercase letters, digits and dashes) <input id="new-handle" autocomplete="username"></label>
  <button>Continue</button>
</form>`

const login = (sso: SsoChoice) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Ideation Factory</title>
${STYLE}
</head>
<body>
<h1>Sign in</h1>
<section id="sso" hidden>
  <button id="sso-button" type="button">Continue with <span id="sso-name"></span></button>
  <p><a href="#" id="admin-link">Site admin? Sign in with an email code</a></p>
</section>
${HANDLE_FORM}
<form id="email-form">
  <label>Email <input id="email" type="email" autocomplete="email" required></label>
  <button>Send me a code</button>
  <p>Or <button id="passkey-button" type="button">sign in with a passkey</button></p>
</form>
<form id="code-form" hidden>
  <p>We sent a 6-digit code to <strong id="sent-to"></strong>.</p>
  <label>Code <input id="code" inputmode="numeric" autocomplete="one-time-code" required></label>
  <label id="handle-label" hidden>Pick a handle (lowercase letters, digits and dashes)
    <input id="handle" autocomplete="username"></label>
  <button>Sign in</button>
</form>
<section id="signed-in" hidden>
  <p>Signed in as <strong id="who"></strong>.</p>
  <p>For the cli, run <code>ideaf auth login</code>. A personal token is only for CI, where nobody can sign in:</p>
  <form id="token-form">
    <label>Make a personal token named <input id="token-name" value="ci" required></label>
    <label><input type="checkbox" id="token-read-only"> Read only</label>
    <label>Only these teams (handles, comma-separated; empty for everything you can see)
      <input id="token-teams" type="text"></label>
    <button>Make a token</button>
  </form>
  <p id="token" hidden>Your token, shown once:<br><code id="token-value"></code><br>
    Use it with <code>export IDEAF_TOKEN=…</code></p>
</section>
<p class="error" id="error" role="alert"></p>
<script>
${SCRIPT_BASE}
  const SSO = ${scriptJson(sso)}
  const params = new URLSearchParams(location.search)
  // where to go once signed in: a page of the web app (?next=/teams/mobile), never another site
  const next = /^\\/(?![\\/\\\\])/.test(params.get('next') || '') ? params.get('next') : null
  const showSignedIn = (user) => {
    if (next) { location.replace(next); return }
    for (const id of ['sso', 'email-form', 'code-form']) $(id).hidden = true
    $('who').textContent = '@' + (user.username || user.name)
    $('signed-in').hidden = false
  }
  // back from the identity provider with an error (no account, a domain that can't sign in…)
  if (params.get('error')) $('error').textContent = params.get('error_description') || params.get('error').replaceAll('_', ' ')
  if (SSO) {
    // the organization's sign-in; email codes are only for site admins
    $('sso-name').textContent = SSO.name
    $('sso').hidden = false
    $('email-form').hidden = true
    $('admin-link').onclick = (event) => {
      event.preventDefault()
      $('admin-link').hidden = true
      $('email-form').hidden = false
    }
    $('sso-button').onclick = run(async () => {
      // Better Auth doesn't carry an OAuth sign-in (the cli's) through single
      // sign-on: come back to its authorize request, which then goes on to consent
      const back = signedQuery()
        ? '/api/auth/oauth2/authorize?' + authorizeQuery()
        : next ? '/login?next=' + encodeURIComponent(next) : '/login'
      follow(await post('/sign-in/sso', { providerId: SSO.providerId, callbackURL: back, errorCallbackURL: '/login' }))
    })
  }
  // The authorize request, from the query Better Auth sent here (its own signature left out)
  function authorizeQuery() {
    const out = new URLSearchParams()
    for (const [name, value] of params.entries()) if (name !== 'sig' && name !== 'ba_param' && name !== 'error' && name !== 'error_description') out.append(name, value)
    return out.toString()
  }
  // signed in already (back from single sign-on, say): confirm the handle if it's new
  currentUser().then(async (user) => {
    if (!user) return
    showSignedIn(await confirmHandle(user))
  })
  // a passkey added in your settings: the browser asks for it, and sign-in checks it
  $('passkey-button').onclick = run(async () => {
    if (!window.PublicKeyCredential || !PublicKeyCredential.parseRequestOptionsFromJSON) {
      throw new Error('This browser can’t sign in with a passkey: use a code instead.')
    }
    const options = await (await fetch('/api/auth/passkey/generate-authenticate-options')).json()
    let credential
    try {
      credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) })
    } catch {
      throw new Error('No passkey was used. Try again, or use a code instead.')
    }
    const { clientExtensionResults, ...response } = credential.toJSON()
    const oauth = signedQuery()
    const data = await post('/passkey/verify-authentication', { response, ...(oauth ? { oauth_query: oauth } : {}) })
    // signing in for an OAuth client (the cli): on to the consent page
    if (follow(data)) return
    showSignedIn(await currentUser())
  })
  $('email-form').onsubmit = run(async () => {
    await post('/email-otp/send-verification-otp', { email: $('email').value, type: 'sign-in' })
    $('sent-to').textContent = $('email').value
    $('email-form').hidden = true
    $('code-form').hidden = false
  })
  // Signing in uses the code up, so anything that could still go wrong is
  // checked first: whether the account is new (which needs a handle), and
  // whether the handle is free. A first sign-in takes one code, like any other.
  $('code-form').onsubmit = run(async () => {
    const email = $('email').value
    const otp = $('code').value.trim()
    const handle = $('handle').value.trim()
    if ($('handle-label').hidden) {
      try {
        // checks the code without using it, and says if there's no account yet
        await post('/email-otp/check-verification-otp', { email, otp, type: 'sign-in' })
      } catch (error) {
        if (error.code !== 'USER_NOT_FOUND') throw error
        $('handle-label').hidden = false
        $('handle').focus()
        throw new Error('New here: pick a handle, then sign in with the same code.')
      }
    } else {
      const { available } = await post('/is-username-available', { username: handle })
      if (!available) throw new Error('@' + handle + ' is taken: pick another handle.')
    }
    const oauth = signedQuery()
    const data = await post('/sign-in/email-otp', {
      email,
      otp,
      ...(handle ? { username: handle, name: handle } : {}),
      ...(oauth ? { oauth_query: oauth } : {}),
    })
    // signing in for an OAuth client (the cli): on to the consent page
    if (follow(data)) return
    if (next) { location.replace(next); return }
    $('who').textContent = '@' + (data.user.username || data.user.name)
    $('code-form').hidden = true
    $('signed-in').hidden = false
  })
  $('token-form').onsubmit = run(async () => {
    const teams = $('token-teams').value.split(',').map((t) => t.trim()).filter(Boolean)
    const readOnly = $('token-read-only').checked
    let metadata = { purpose: 'me' }
    if (teams.length || readOnly) {
      const { grant } = await post('/ideaf/token-grant', { purpose: 'me', readOnly, limits: teams.length ? { teams } : null })
      metadata = { grant: grant.id }
    }
    const { key } = await post('/api-key/create', { configId: 'personal', name: $('token-name').value, metadata })
    $('token-value').textContent = key
    $('token').hidden = false
  })
</script>
</body>
</html>
`

const CONSENT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allow access · Ideation Factory</title>
${STYLE}
</head>
<body>
<h1>Allow <span id="client">an app</span>?</h1>
${HANDLE_FORM}
<form id="consent" hidden>
  <p>Choose what it may do. It can never do more than you can, and you can sign it out at any time.</p>
  <fieldset><legend>Who acts with it</legend>
    <label><input type="radio" name="purpose" value="me" checked> Me</label>
    <label><input type="radio" name="purpose" value="bot-for-me"> A bot, on my behalf</label>
    <label><input type="radio" name="purpose" value="bot"> A bot</label>
    <label id="bot-label" hidden>The bot's name (lowercase letters, digits and dashes) <input id="bot" type="text"></label>
  </fieldset>
  <fieldset><legend>What it may do</legend>
    <label><input type="radio" name="access" value="write" checked> Read and change ideas, and comment</label>
    <label><input type="radio" name="access" value="read"> Read only</label>
  </fieldset>
  <fieldset><legend>Which ideas</legend>
    <label><input type="radio" name="reach" value="all" checked> Everything I can see</label>
    <label><input type="radio" name="reach" value="some"> Only these:</label>
    <div id="some" hidden>
      <label>Teams (handles, comma-separated) <input id="teams" type="text"></label>
      <label>Ideas (IDs, comma-separated) <input id="ideas" type="text"></label>
      <label><input type="checkbox" id="no-team"> Ideas outside any team</label>
      <p>Limited to some ideas, it can't share them, move them, or manage teams.</p>
    </div>
  </fieldset>
  <button>Allow</button><button type="button" id="deny">Deny</button>
</form>
<p class="error" id="error" role="alert"></p>
<script>
${SCRIPT_BASE}
  const params = new URLSearchParams(location.search)
  const known = { 'ideaf-cli': 'ideaf, the command line' }
  const clientId = params.get('client_id') || ''
  $('client').textContent = known[clientId] || clientId || 'an app'
  // an MCP client (its ID is the URL of its metadata): its name, where that came from, and, unless it
  // asked for something else, a bot for you named after it, so its work reads "🤖 claude-code on behalf of …"
  const botName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39).replace(/-+$/, '')
  const named = clientId.startsWith('https://')
    ? fetch('/api/auth/oauth2/public-client?client_id=' + encodeURIComponent(clientId))
        .then((r) => (r.ok ? r.json() : {}))
        .then((client) => {
          const name = client.client_name || new URL(clientId).hostname
          $('client').textContent = name + ' (from ' + new URL(clientId).hostname + ')'
          if (!params.get('ideaf_bot') && !params.get('ideaf_purpose')) {
            choose('purpose', 'bot-for-me')
            $('bot').value = botName(name) || 'agent'
            sync()
          }
        })
        .catch(() => {})
    : Promise.resolve()
  const list = (value) => (value || '').split(',').map((v) => v.trim()).filter(Boolean)
  const choose = (name, value) => { const input = document.querySelector('input[name=' + name + '][value="' + value + '"]'); if (input) input.checked = true }
  const sync = () => {
    $('bot-label').hidden = document.querySelector('input[name=purpose]:checked').value === 'me'
    $('some').hidden = document.querySelector('input[name=reach]:checked').value !== 'some'
  }
  // what the app asked for, to start from (ideaf auth login --bot … --team … --read-only)
  if (params.get('ideaf_bot')) { choose('purpose', params.get('ideaf_purpose') || 'bot-for-me'); $('bot').value = params.get('ideaf_bot') }
  if (params.get('ideaf_read_only') === '1') choose('access', 'read')
  if (params.get('ideaf_teams') || params.get('ideaf_ideas') || params.get('ideaf_no_team') === '1') {
    choose('reach', 'some')
    $('teams').value = params.get('ideaf_teams') || ''
    $('ideas').value = params.get('ideaf_ideas') || ''
    $('no-team').checked = params.get('ideaf_no_team') === '1'
  }
  document.querySelectorAll('input[type=radio]').forEach((input) => { input.onchange = sync })
  sync()
  // a new account from single sign-on confirms its handle first
  currentUser().then(confirmHandle).then(() => named).then(() => { $('consent').hidden = false })
  $('consent').onsubmit = run(async () => {
    const purpose = document.querySelector('input[name=purpose]:checked').value
    const some = document.querySelector('input[name=reach]:checked').value === 'some'
    await post('/ideaf/token-grant', {
      purpose,
      ...(purpose === 'me' ? {} : { bot: $('bot').value.trim() }),
      readOnly: document.querySelector('input[name=access]:checked').value === 'read',
      limits: some ? { teams: list($('teams').value), ideas: list($('ideas').value), noTeam: $('no-team').checked } : null,
      forConsent: true,
    })
    follow(await post('/oauth2/consent', { accept: true, oauth_query: signedQuery() }))
  })
  $('deny').onclick = run(async () => {
    follow(await post('/oauth2/consent', { accept: false, oauth_query: signedQuery() }))
  })
</script>
</body>
</html>
`

const CLI_CODE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed in · Ideation Factory</title>
${STYLE}
</head>
<body>
<h1 id="title">Copy this into ideaf</h1>
<p id="message">Paste it where <code>ideaf auth login</code> is waiting:</p>
<code class="big" id="code"></code>
<p>It works once, only with the ideaf that asked for it, and for a few minutes.</p>
<script>
  const params = new URLSearchParams(location.search)
  if (params.get('error')) {
    document.getElementById('title').textContent = 'Not signed in'
    document.getElementById('message').textContent = params.get('error_description') || params.get('error')
  } else {
    // the code and the state together, so ideaf can check this answer is to its own request
    document.getElementById('code').textContent = (params.get('code') || '') + '.' + (params.get('state') || '')
  }
</script>
</body>
</html>
`
