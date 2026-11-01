// Bare pages until the web app (step 8) has real ones, talking to Better
// Auth's endpoints from the browser: sign in (an email code, a handle the
// first time, then optionally a personal token), the OAuth consent page (what
// a token may do), and the page that shows the cli the code to paste.
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

export const loginPage = () => html(LOGIN)
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
    if (!response.ok) throw new Error(data.message || data.error_description || data.error || 'something went wrong (' + response.status + ')')
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
`

const LOGIN = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Ideation Factory</title>
${STYLE}
</head>
<body>
<h1>Sign in</h1>
<form id="email-form">
  <label>Email <input id="email" type="email" autocomplete="email" required></label>
  <button>Send me a code</button>
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
  $('email-form').onsubmit = run(async () => {
    await post('/email-otp/send-verification-otp', { email: $('email').value, type: 'sign-in' })
    $('sent-to').textContent = $('email').value
    $('email-form').hidden = true
    $('code-form').hidden = false
  })
  $('code-form').onsubmit = run(async () => {
    const handle = $('handle').value.trim()
    let data
    try {
      const oauth = signedQuery()
      data = await post('/sign-in/email-otp', {
        email: $('email').value,
        otp: $('code').value.trim(),
        ...(handle ? { username: handle, name: handle } : {}),
        ...(oauth ? { oauth_query: oauth } : {}),
      })
    } catch (error) {
      // a new account: ask for a handle, then send another code
      if (/handle/.test(error.message) && $('handle-label').hidden) {
        $('handle-label').hidden = false
        await post('/email-otp/send-verification-otp', { email: $('email').value, type: 'sign-in' })
        throw new Error('New here: pick a handle. We sent a new code.')
      }
      throw error
    }
    // signing in for an OAuth client (the cli): on to the consent page
    if (follow(data)) return
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
<p>Choose what it may do. It can never do more than you can, and you can sign it out at any time.</p>
<form id="consent">
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
  $('client').textContent = known[params.get('client_id')] || params.get('client_id') || 'an app'
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
