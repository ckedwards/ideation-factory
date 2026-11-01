// ideaf auth login | status | logout. Login is OAuth's authorization code flow
// with PKCE: the browser opens to sign in and choose what this sign-in may do
// (who acts with it, read only or not, which teams or ideas), then hands the
// code back to a one-off listener on 127.0.0.1. With no browser of its own
// (over SSH, say), or with --no-browser, the code is shown on a page to paste
// here instead. The tokens go in the OS keychain and are refreshed as needed.
import type { Output, Operations } from '@ideaf/api'
import { CliError, type Context, EXIT } from '../context.ts'
import { type LoginChoices, authorizeUrl, CLI_CODE_PATH, exchangeCode, newAuthorization } from '../oauth.ts'

const WAIT_MS = 5 * 60_000
type TokenInfo = Output<Operations['currentToken']>

export async function login(ctx: Context, flags: LoginChoices & { noBrowser: boolean }): Promise<number> {
  if (flags.bot !== undefined && !/^[a-z0-9][a-z0-9-]{0,38}$/.test(flags.bot)) {
    throw new CliError('--bot is a name: lowercase letters, digits and dashes', EXIT.usage, 'usage')
  }
  const send = ctx.io.fetch ?? ((request: Request) => fetch(request))
  const store = await ctx.io.credentials()
  const authorization = newAuthorization()
  let grant: { code: string; redirect: string }

  const paste = flags.noBrowser || !(await canListen())
  if (!paste) {
    const callback = listen(authorization.state)
    const redirect = `http://127.0.0.1:${callback.port}/callback`
    const url = authorizeUrl(ctx.server, redirect, authorization, flags)
    const opened = await ctx.io.openBrowser(url)
    if (opened) {
      ctx.say('Opening your browser to sign in. Waiting for you to approve…')
    } else if (ctx.io.interactive && !ctx.json) {
      // no browser here: sign in on another device and paste the code instead
      callback.stop()
      grant = await pasted(ctx, authorization, flags)
      return finish(ctx, send, store, { ...grant, verifier: authorization.verifier })
    } else {
      ctx.say(`Open this link to sign in, then come back here:\n  ${url}`)
    }
    try {
      grant = { code: await callback.code, redirect }
    } finally {
      callback.stop()
    }
  } else {
    if (!ctx.io.interactive || ctx.json) {
      throw new CliError(
        'signing in without a browser needs a person to paste a code: run it at a terminal (in CI, set IDEAF_TOKEN)',
        EXIT.usage,
        'usage',
      )
    }
    grant = await pasted(ctx, authorization, flags)
  }
  return finish(ctx, send, store, { ...grant, verifier: authorization.verifier })
}

/** The paste-a-code path: the code goes to a page on the server, and the person copies it here. */
async function pasted(
  ctx: Context,
  authorization: ReturnType<typeof newAuthorization>,
  flags: LoginChoices,
): Promise<{ code: string; redirect: string }> {
  const redirect = `${ctx.server}${CLI_CODE_PATH}`
  ctx.say(
    `Open this link on any device, sign in, and paste the code it shows:\n  ${authorizeUrl(ctx.server, redirect, authorization, flags)}\n`,
  )
  const answer = (await ctx.io.ask('Code'))?.trim() ?? ''
  const [code, state] = answer.split('.')
  if (!code) {
    throw new CliError('no code: not signed in', EXIT.usage, 'usage')
  }
  if (state !== authorization.state) {
    throw new CliError('that code is for another sign-in: start again with `ideaf auth login`', EXIT.usage, 'usage')
  }
  return { code, redirect }
}

async function finish(
  ctx: Context,
  send: (request: Request) => Promise<Response>,
  store: Awaited<ReturnType<Context['io']['credentials']>>,
  grant: { code: string; redirect: string; verifier: string },
): Promise<number> {
  const credentials = await exchangeCode(send, ctx.server, grant)
  await store.set(ctx.server, credentials)
  const info = await ctx.api.currentToken({})
  ctx.say(`Signed in to ${ctx.server} as ${describe(info)}.`)
  if (ctx.io.env.IDEAF_TOKEN) {
    ctx.say('IDEAF_TOKEN is set, and it wins: unset it to use this sign-in.')
  }
  ctx.result({ server: ctx.server, ...info, kept: store.where })
  return EXIT.ok
}

export async function status(ctx: Context): Promise<number> {
  const store = await ctx.io.credentials()
  const using = ctx.io.env.IDEAF_TOKEN ? 'IDEAF_TOKEN' : (await store.get(ctx.server)) ? store.where : null
  if (!using) {
    ctx.result({ server: ctx.server, signedIn: false })
    ctx.say(`Not signed in to ${ctx.server}: run \`ideaf auth login\` (or, in CI, set IDEAF_TOKEN).`)
    return EXIT.unauthorized
  }
  const info = await ctx.api.currentToken({})
  ctx.say(`Signed in to ${ctx.server} as ${describe(info)}.`)
  ctx.say(using === 'IDEAF_TOKEN' ? 'With the token in IDEAF_TOKEN.' : `Tokens kept in ${using}.`)
  ctx.result({ server: ctx.server, signedIn: true, using, ...info })
  return EXIT.ok
}

export async function logout(ctx: Context): Promise<number> {
  const store = await ctx.io.credentials()
  const stored = await store.get(ctx.server)
  if (!stored) {
    ctx.say(`Not signed in to ${ctx.server}.`)
    ctx.result({ server: ctx.server, signedOut: false })
    return EXIT.ok
  }
  // end it on the server too, so the refresh token is worthless wherever it is;
  // if it already ended there, forgetting it here is all that's left
  await ctx.api.revokeToken({}).catch(() => null)
  await store.delete(ctx.server)
  ctx.say(`Signed out of ${ctx.server}.`)
  if (ctx.io.env.IDEAF_TOKEN) {
    ctx.say('IDEAF_TOKEN is still set, so ideaf still uses it.')
  }
  ctx.result({ server: ctx.server, signedOut: true })
  return EXIT.ok
}

/** "@chris (Chris), as planbot (a bot for you), limited to team:core, read only". */
function describe(info: TokenInfo): string {
  const who =
    info.user.name && info.user.name !== info.user.handle
      ? `@${info.user.handle} (${info.user.name})`
      : `@${info.user.handle}`
  const as =
    info.purpose === 'bot-for-me'
      ? `, as ${info.bot} (a bot for you)`
      : info.purpose === 'bot'
        ? `, as ${info.bot} (a bot)`
        : ''
  const reach = info.limits
    ? `, limited to ${[
        ...info.limits.teams.map((t) => `team:${t.handle}`),
        ...info.limits.ideas,
        ...(info.limits.noTeam ? ['ideas outside teams'] : []),
      ].join(', ')}`
    : ''
  return `${who}${as}${reach}${info.readOnly ? ', read only' : ''}`
}

/** Whether this machine can take the browser's answer on localhost at all. */
async function canListen(): Promise<boolean> {
  try {
    Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }).stop(true)
    return true
  } catch {
    return false
  }
}

/** A one-off listener on 127.0.0.1 for the browser's redirect back with the code. */
function listen(state: string) {
  let resolve!: (code: string) => void
  let reject!: (error: Error) => void
  const code = new Promise<string>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  const page = (title: string, text: string) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;max-width:28rem;margin:3rem auto"><h1>${title}</h1><p>${text}</p>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
        return new Response('not found', { status: 404 })
      }
      const error = url.searchParams.get('error')
      if (error) {
        reject(
          new CliError(
            `not signed in: ${url.searchParams.get('error_description') ?? error}`,
            EXIT.unauthorized,
            'unauthorized',
          ),
        )
        return page('Not signed in', 'You can close this tab.')
      }
      resolve(url.searchParams.get('code') ?? '')
      return page('Signed in', 'You can close this tab and go back to your terminal.')
    },
  })
  const timer = setTimeout(
    () =>
      reject(new CliError('gave up waiting for the browser: run `ideaf auth login` again', EXIT.error, 'timed_out')),
    WAIT_MS,
  )
  return {
    port: server.port,
    code,
    stop: () => {
      clearTimeout(timer)
      // not forced: the browser is still being sent the "signed in" page
      void server.stop()
    },
  }
}
