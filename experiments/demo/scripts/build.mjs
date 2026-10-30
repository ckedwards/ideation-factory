// PROTOTYPE DEMO: builds both prototypes for the demo and puts them in ./dist:
//   experiment 2 at /, experiment 1 at /prototype/idea (its index.html), with
//   both apps' hashed assets side by side in /assets.
// VITE_DEMO keeps the prototype switches (site admin, sign-up, state, external
// images), since that's how people explore.
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const here = resolve(import.meta.dirname, '..')
const exp = (n) => resolve(here, '..', `experiment${n}`)
const out = join(here, 'dist')

const build = (dir, env) => {
  if (!existsSync(join(dir, 'node_modules'))) execSync('npm install', { cwd: dir, stdio: 'inherit' })
  execSync('npm run build', { cwd: dir, stdio: 'inherit', env: { ...process.env, ...env } })
}
build(exp(2), { VITE_DEMO: '1', VITE_IDEA_PAGE_URL: '/prototype/idea' })
build(exp(1), { VITE_DEMO: '1', VITE_SITE_URL: '/' })

rmSync(out, { recursive: true, force: true })
cpSync(join(exp(2), 'dist'), out, { recursive: true })

// experiment 1: its page under /prototype/idea, everything else merged in
const one = join(exp(1), 'dist')
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
for (const file of walk(one)) {
  const rel = relative(one, file)
  const dest = rel === 'index.html' ? join(out, 'prototype', 'idea', 'index.html') : join(out, rel)
  if (existsSync(dest) && !readFileSync(dest).equals(readFileSync(file))) throw new Error(`Both prototypes have a different ${rel}`)
  mkdirSync(resolve(dest, '..'), { recursive: true })
  cpSync(file, dest)
}
console.log(`\nDemo built in ${relative(process.cwd(), out) || out}: ${walk(out).length} files`)
