// Latency of auth paths that touch storage, per approach (local engine, one
// machine, so hops are loopback: a lower bound). Run against each mode:
//
//   ./restart.sh adapter && bun src/bench.ts >> out/bench.txt
//   ./restart.sh actor   && bun src/bench.ts >> out/bench.txt
const BASE = 'http://localhost:25445'
const spike = async (p: string) => (await fetch(BASE + p)).json() as Promise<any>
const { mode, transport } = await spike('/health')
const ip = () => `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const jar: string[] = []

async function post(path: string, body: unknown, addr = ip()) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': addr, cookie: jar.join('; ') }, body: JSON.stringify(body) })
  for (const c of r.headers.getSetCookie()) jar.push(c.split(';')[0]!)
  return r
}
async function timed(label: string, n: number, fn: (i: number) => Promise<Response>) {
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    const r = await fn(i)
    await r.arrayBuffer()
    if (!r.ok) throw new Error(`${label}: ${r.status}`)
    ms.push(performance.now() - t)
  }
  ms.sort((a, b) => a - b)
  console.log(`${(mode + '/' + transport).padEnd(12)} ${label.padEnd(34)} median ${ms[Math.floor(n / 2)]!.toFixed(2)} ms  p95 ${ms[Math.floor(n * 0.95)]!.toFixed(2)} ms  (n=${n})`)
}

const email = `bench-${Date.now().toString(36)}@example.com`
await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
const otp = ((await spike('/spike/outbox')) as any[]).filter((m) => m.email === email).at(-1).otp
await post('/api/auth/sign-in/email-otp', { email, otp, username: `bench-${Date.now().toString(36)}` })

await timed('get-session (session read)', 200, () => fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: jar.join('; '), 'x-forwarded-for': ip() } }))
await timed('GET /token (session → 15-min JWT)', 200, () => fetch(`${BASE}/api/auth/token`, { headers: { cookie: jar.join('; '), 'x-forwarded-for': ip() } }))
await timed('sign-in with an email code (2 requests)', 20, async () => {
  const e = `b${Math.random().toString(36).slice(2)}@example.com`
  const a = ip()
  await post('/api/auth/email-otp/send-verification-otp', { email: e, type: 'sign-in' }, a)
  const code = ((await spike('/spike/outbox')) as any[]).filter((m) => m.email === e).at(-1).otp
  return post('/api/auth/sign-in/email-otp', { email: e, otp: code, username: `b${Math.random().toString(36).slice(2, 10)}` }, a)
})
