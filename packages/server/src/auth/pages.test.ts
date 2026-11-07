// The bare sign-in page's own script: it parses, and once someone has signed
// in it only sends them on to a page of this site (?next=), never elsewhere.
import { expect, test } from 'bun:test'
import { loginPage } from './pages.ts'

const html = await loginPage().text()
const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))

test("the page's script parses", () => {
  expect(() => new Function(script)).not.toThrow()
})

test('?next= is followed only to a path on this site', () => {
  const line = script.split('\n').find((l) => l.includes('const next ='))!
  const pattern = new Function(`return ${/= (\/.+\/)\.test\(/.exec(line)![1]}`)() as RegExp
  for (const next of ['/', '/teams/mobile', '/ideas/i1?file=plan.md']) {
    expect(pattern.test(next)).toBe(true)
  }
  for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '']) {
    expect(pattern.test(next)).toBe(false)
  }
})
