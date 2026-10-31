// CIMD: does @better-auth/cimd/node's transport hold its guarantees under Bun?
//
//   bun src/cimd-transport.ts >> out/cimd.txt
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { request } from 'node:https'

const results: [string, boolean, string][] = []
const deadline = <T>(p: Promise<T> | T, ms = 10_000): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`no answer after ${ms} ms`)), ms))])
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, detail])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail.slice(0, 240)}` : ''}`)
}
console.log(`# CIMD transport under Bun ${Bun.version}\n`)

// 1. Bun's node:https honors the lookup option (the pinning mechanism).
//    Point example.com at TEST-NET-1 (192.0.2.1, unroutable): honored → no
//    connection; ignored → a normal 200 from the real example.com.
{
  let calls = 0
  const outcome = await new Promise<string>((resolve) => {
    const req = request('https://example.com/', {
      agent: false,
      timeout: 4000,
      lookup: (_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
        calls++
        if (opts.all) cb(null, [{ address: '192.0.2.1', family: 4 }])
        else cb(null, '192.0.2.1', 4)
      },
    } as never, (res) => resolve(`connected: ${res.statusCode}`))
    req.on('timeout', () => (req.destroy(), resolve('timeout')))
    setTimeout(() => (req.destroy(), resolve('no connection after 6 s')), 6000)
    req.on('error', (e) => resolve(`error: ${(e as NodeJS.ErrnoException).code ?? e.message}`))
    req.end()
  })
  check('node:https honors lookup (connection goes to the pinned address)', calls > 0 && !outcome.startsWith('connected'), `lookup called ${calls}×, ${outcome}`)
  // and with the real address pinned, TLS still uses the hostname (SNI + cert check)
  const { lookup } = await import('node:dns/promises')
  const real = await lookup('example.com')
  const ok = await new Promise<string>((resolve) => {
    const req = request('https://example.com/', {
      agent: false,
      servername: 'example.com',
      lookup: (_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
        opts.all ? cb(null, [real]) : cb(null, real.address, real.family),
    } as never, (res) => resolve(String(res.statusCode)))
    req.on('error', (e) => resolve(`error: ${e.message}`))
    req.end()
  })
  check('pinned to the real address, TLS verifies against the hostname', ok === '200', ok)
}

// 2. The transport itself: a public HTTPS URL works; private targets are refused.
{
  const r = await deadline(fetchClientMetadataResource('https://example.com/'))
  check('transport: public HTTPS URL fetched', r.status === 200, `status ${r.status}`)
}
const privateTargets = [
  'https://127.0.0.1/',
  'https://10.0.0.1/',
  'https://169.254.169.254/latest/meta-data/',
  'https://[::1]/',
  'https://localhost/',
  // public names that resolve to private addresses (sslip.io echoes the IP)
  'https://127.0.0.1.sslip.io/client.json',
  'https://10.1.2.3.sslip.io/client.json',
  'https://192-168-1-1.sslip.io/client.json',
  'https://169.254.169.254.sslip.io/client.json',
  'https://fd00--1.sslip.io/client.json',
  'https://--1.sslip.io/client.json',
  'https://100.64.0.1.sslip.io/client.json',
]
for (const url of privateTargets) {
  const outcome = await Promise.resolve(deadline(fetchClientMetadataResource(url))).then(
    (r) => `fetched ${r.status}`,
    (e: Error) => `refused: ${e.message}`,
  )
  check(`transport: refuses ${url}`, outcome.startsWith('refused'), outcome)
}
{
  const outcome = await Promise.resolve(fetchClientMetadataResource('http://example.com/')).then((r) => `fetched ${r.status}`, (e: Error) => `refused: ${e.message}`)
  check('transport: refuses plain http', outcome.startsWith('refused'), outcome)
}

// 3. Redirects are returned, never followed.
{
  const r = await deadline(fetchClientMetadataResource('https://google.com/'))
  check('transport: redirect returned to the caller, not followed', r.status >= 300 && r.status < 400 && !!r.headers.get('location'), `status ${r.status} location ${r.headers.get('location')}`)
}

// 4. The address check the transport applies to every DNS answer. (This
//    machine's resolver drops private answers for public names, so names like
//    10.1.2.3.sslip.io fail at DNS before reaching it; check it directly.)
{
  const { isPublicRoutableHost } = await import('@better-auth/core/utils/host')
  const refused = ['10.1.2.3', '172.16.0.1', '192.168.1.1', '127.0.0.1', '0.0.0.0', '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2002:0a00:0001::1', 'ff02::1']
  const allowed = ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111']
  const wrong = [...refused.filter((a) => isPublicRoutableHost(a)), ...allowed.filter((a) => !isPublicRoutableHost(a)).map((a) => `${a} (public)`)]
  check(`address check: ${refused.length} private/special-use addresses refused, public ones allowed`, wrong.length === 0, wrong.length ? `wrong: ${wrong.join(', ')}` : refused.join(' '))
}

const failed = results.filter((r) => !r[1])
console.log(`\n${results.length - failed.length}/${results.length} passed`)
