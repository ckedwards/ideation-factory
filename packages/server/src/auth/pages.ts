// A bare sign-in page, until the web app (step 8) has a real one: an email
// code, a handle the first time, then a personal token for the cli
// (IDEAF_TOKEN). It talks to Better Auth's endpoints from the browser.
export function loginPage(): Response {
  return new Response(LOGIN, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const LOGIN = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Ideation Factory</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; color: #1d1d1f; }
  label { display: block; margin-top: 1rem; }
  input, button { font: inherit; padding: .4rem .6rem; }
  input { width: 100%; box-sizing: border-box; }
  button { margin-top: 1rem; }
  [hidden] { display: none; }
  .error { color: #b00020; }
  code { word-break: break-all; background: #f2f2f2; padding: .1rem .3rem; }
</style>
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
  <form id="token-form">
    <label>Make a personal token for the cli, named <input id="token-name" value="ideaf cli" required></label>
    <button>Make a token</button>
  </form>
  <p id="token" hidden>Your token, shown once:<br><code id="token-value"></code><br>
    Use it with <code>export IDEAF_TOKEN=…</code></p>
</section>
<p class="error" id="error" role="alert"></p>
<script>
  const $ = (id) => document.getElementById(id)
  const post = async (path, body) => {
    const response = await fetch('/api/auth' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'something went wrong (' + response.status + ')')
    return data
  }
  const run = (fn) => async (event) => {
    event.preventDefault()
    $('error').textContent = ''
    try { await fn() } catch (error) { $('error').textContent = error.message }
  }
  $('email-form').onsubmit = run(async () => {
    await post('/email-otp/send-verification-otp', { email: $('email').value, type: 'sign-in' })
    $('sent-to').textContent = $('email').value
    $('email-form').hidden = true
    $('code-form').hidden = false
  })
  $('code-form').onsubmit = run(async () => {
    const handle = $('handle').value.trim()
    try {
      const { user } = await post('/sign-in/email-otp', {
        email: $('email').value,
        otp: $('code').value.trim(),
        ...(handle ? { username: handle, name: handle } : {}),
      })
      $('who').textContent = '@' + (user.username || user.name)
      $('code-form').hidden = true
      $('signed-in').hidden = false
    } catch (error) {
      // a new account: ask for a handle, then send another code
      if (/handle/.test(error.message) && $('handle-label').hidden) {
        $('handle-label').hidden = false
        await post('/email-otp/send-verification-otp', { email: $('email').value, type: 'sign-in' })
        throw new Error('New here: pick a handle. We sent a new code.')
      }
      throw error
    }
  })
  $('token-form').onsubmit = run(async () => {
    const { key } = await post('/api-key/create', { configId: 'personal', name: $('token-name').value, metadata: { purpose: 'me' } })
    $('token-value').textContent = key
    $('token').hidden = false
  })
</script>
</body>
</html>
`
