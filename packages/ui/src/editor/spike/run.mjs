// SPIKE: the clipboard cases of docs/design-rich-text.md ("A spike before the page editor"), driven
// with the real keys in each browser, on the story Editor/Spike/Clipboard (ui's Storybook running).
//
//   node packages/ui/src/editor/spike/run.mjs chromium|firefox|webkit [storybook URL]
//
// WebKit runs in Playwright's own image (its libraries aren't on every Linux), reached through
// WEBKIT_WS: docker run --rm --network host mcr.microsoft.com/playwright:v1.64.1-noble \
//   npx -y playwright@1.64.1 run-server --port 3333
import { chromium, firefox, webkit } from 'playwright'

const which = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://localhost:6116'
const story = `${base}/iframe.html?id=editor-spike-clipboard--two-files&viewMode=story&globals=theme:light`
const engines = { chromium, firefox, webkit }
const browser =
  which === 'webkit' && process.env.WEBKIT_WS
    ? await webkit.connect(process.env.WEBKIT_WS)
    : await engines[which].launch()
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
if (which === 'chromium') {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
}
const page = await context.newPage()
const mod = 'Control'

// ---- in the page ----

async function fresh() {
  await page.goto(story)
  await page.waitForFunction(() => window.spike?.editors?.a && window.spike?.editors?.b)
}

/** Selects a block's whole text (as a triple click does), or `words` of it. */
async function select(file, id, words) {
  await page.evaluate(
    async ({ file, id, words }) => {
      const view = window.spike.editors[file].view()
      let at = -1
      let size = 0
      view.state.doc.descendants((node, pos) => {
        if (node.attrs.blockId === id) {
          at = pos
          size = node.nodeSize
        }
        return at < 0
      })
      if (at < 0) {
        throw new Error(`no block ${id} in ${file}`)
      }
      const block = view.state.doc.nodeAt(at)
      // the text inside: a list item's paragraph is one deeper
      const inner = block.type.name === 'list_item' ? at + 2 : at + 1
      let from = inner
      let to = at + size - (block.type.name === 'list_item' ? 2 : 1)
      if (words) {
        const text = view.state.doc.textBetween(from, to)
        from = inner + text.indexOf(words)
        to = from + words.length
      }
      const { TextSelection } = window.spikeProse
      view.focus()
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
      await new Promise((r) => setTimeout(r, 50))
    },
    { file, id, words },
  )
}

/** The caret at the start (or `offset` into the text) of a block. */
async function caret(file, id, offset = 0) {
  await page.evaluate(
    async ({ file, id, offset }) => {
      const view = window.spike.editors[file].view()
      let at = -1
      view.state.doc.descendants((node, pos) => {
        if (node.attrs.blockId === id) {
          at = pos
        }
        return at < 0
      })
      const block = view.state.doc.nodeAt(at)
      const inner = block.type.name === 'list_item' ? at + 2 : at + 1
      const { TextSelection } = window.spikeProse
      view.focus()
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inner + offset)))
      await new Promise((r) => setTimeout(r, 50))
    },
    { file, id, offset },
  )
}

const key = async (combo) => {
  await page.keyboard.press(combo)
  await page.waitForTimeout(150)
}
const blocks = (file) => page.evaluate((file) => window.spike.editors[file].blocks(), file)
const log = () => page.evaluate(() => window.spike.log.slice())
const unchanged = (file) => page.evaluate((file) => window.spike.editors[file].unchanged(), file)
const withId = (list, id) => list.filter((b) => b.id === id)
const withText = (list, text) => list.filter((b) => b.text.includes(text))

/**
 * A paste from another app: HTML (or plain text) copied with the real keys from outside the
 * editors, so the browser puts it on its clipboard as it would from a web page, then pasted with
 * the real keys at the start of a block.
 */
async function pasteFromOutside(file, id, html, text) {
  await page.evaluate(
    ({ html, text }) => {
      const host = document.createElement(html ? 'div' : 'textarea')
      host.id = 'outside'
      document.body.append(host)
      if (html) {
        host.innerHTML = html
        const range = document.createRange()
        range.selectNodeContents(host)
        getSelection().removeAllRanges()
        getSelection().addRange(range)
      } else {
        host.value = text
        host.focus()
        host.select()
      }
    },
    { html, text },
  )
  await key(`${mod}+c`)
  await page.evaluate(() => document.getElementById('outside').remove())
  await caret(file, id)
  await key(`${mod}+v`)
}

// ---- the cases ----

const SECOND = 'The second paragraph'
const cases = {
  'cut then paste, a whole block': async () => {
    await select('a', 'a-3')
    await key(`${mod}+x`)
    await caret('a', 'a-8')
    await key(`${mod}+v`)
    const after = await blocks('a')
    const moved = withId(after, 'a-3')
    return {
      pass: moved.length === 1 && moved[0].text.startsWith(SECOND) && withText(after, SECOND).length === 1,
      detail: { a3: moved, order: after.map((b) => b.id) },
    }
  },
  'cut then paste as plain text': async () => {
    await select('a', 'a-3')
    await key(`${mod}+x`)
    await caret('a', 'a-8')
    await key(`${mod}+Shift+v`)
    const after = await blocks('a')
    const pasted = withText(after, SECOND)
    // plain text joins the block the caret's in, as typing it would: none of it is the cut block
    return {
      pass: pasted.length === 1 && withId(after, 'a-3').length === 0,
      detail: { pasted, last: (await log()).at(-1) },
    }
  },
  'copy then paste': async () => {
    await select('a', 'a-3')
    await key(`${mod}+c`)
    await caret('a', 'a-8')
    await key(`${mod}+v`)
    const copies = withText(await blocks('a'), SECOND)
    return {
      pass:
        copies.length === 2 && copies.filter((b) => b.id === 'a-3').length === 1 && copies.some((b) => b.id === null),
      detail: { copies },
    }
  },
  'cut, paste, paste again': async () => {
    await select('a', 'a-3')
    await key(`${mod}+x`)
    await caret('a', 'a-8')
    await key(`${mod}+v`)
    await caret('a', 'a-2')
    await key(`${mod}+v`)
    const pasted = withText(await blocks('a'), SECOND)
    return {
      pass:
        pasted.length === 2 && pasted.filter((b) => b.id === 'a-3').length === 1 && pasted.some((b) => b.id === null),
      detail: { pasted, order: (await blocks('a')).map((b) => b.id) },
    }
  },
  'drag a selection': async () => {
    await select('a', 'a-3')
    const from = await page.evaluate(() => {
      const r = getSelection().getRangeAt(0).getBoundingClientRect()
      return { x: r.left + 20, y: r.top + r.height / 2 }
    })
    const to = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-file="a"] [data-block-id="a-8"]')][0]
      const r = el.getBoundingClientRect()
      return { x: r.left + 2, y: r.top + 4 }
    })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 })
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = await blocks('a')
    return {
      pass:
        withId(after, 'a-3').length === 1 &&
        withText(after, SECOND).length === 1 &&
        (await log()).some((e) => e.kind === 'drop' && e.as === 'move'),
      detail: { order: after.map((b) => `${b.id}:${b.text.slice(0, 14)}`), log: await log() },
    }
  },
  'drag into another file': async () => {
    await select('a', 'a-3')
    const from = await page.evaluate(() => {
      const r = getSelection().getRangeAt(0).getBoundingClientRect()
      return { x: r.left + 20, y: r.top + r.height / 2 }
    })
    const to = await page.evaluate(() => {
      const r = document.querySelector('[data-file="b"] [data-block-id="b-3"]').getBoundingClientRect()
      return { x: r.left + 2, y: r.top + 4 }
    })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 })
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const a = await blocks('a')
    const b = await blocks('b')
    return {
      pass: withId(b, 'a-3').length === 1 && withText(a, SECOND).length === 0,
      note: 'ProseMirror deletes the original only for a drag within one editor',
      detail: {
        a: a.map((x) => `${x.id}:${x.text.slice(0, 12)}`),
        b: b.map((x) => `${x.id}:${x.text.slice(0, 12)}`),
        log: await log(),
      },
    }
  },
  'undo after a cut': async () => {
    await select('a', 'a-3')
    await key(`${mod}+x`)
    await key(`${mod}+z`)
    return { pass: await unchanged('a'), detail: { a3: withId(await blocks('a'), 'a-3') } }
  },
  'undo after a paste': async () => {
    await select('a', 'a-3')
    await key(`${mod}+x`)
    await caret('a', 'a-8')
    await key(`${mod}+v`)
    await key(`${mod}+z`)
    await key(`${mod}+z`)
    return { pass: await unchanged('a'), detail: { order: (await blocks('a')).map((b) => b.id) } }
  },
  'a few words into another paragraph': async () => {
    await select('a', 'a-2', 'with a comment')
    await key(`${mod}+x`)
    await caret('a', 'a-8', 'The last'.length)
    await key(`${mod}+v`)
    const paste = (await log()).find((e) => e.kind === 'paste')
    const after = await blocks('a')
    return {
      pass:
        paste?.as === 'move' &&
        paste.words?.from === 'a-2' &&
        paste.words.text === 'with a comment' &&
        paste.words.to === 'a-8' &&
        paste.words.at === 'The last'.length &&
        withId(after, 'a-8')[0]?.text.includes('with a comment'),
      detail: { paste, a2: withId(after, 'a-2'), a8: withId(after, 'a-8') },
    }
  },
  'into another file': async () => {
    await select('a', 'a-3')
    await key(`${mod}+x`)
    await caret('b', 'b-3')
    await key(`${mod}+v`)
    const inB = withId(await blocks('b'), 'a-3')
    return {
      pass: inB.length === 1 && inB[0].text.startsWith(SECOND) && withText(await blocks('a'), SECOND).length === 0,
      detail: { inB, b: (await blocks('b')).map((x) => x.id) },
    }
  },
  'a list item': async () => {
    await select('a', 'a-5')
    await key(`${mod}+x`)
    await caret('a', 'a-8')
    await key(`${mod}+v`)
    const after = await blocks('a')
    return {
      pass: withId(after, 'a-5').length === 1 && withText(after, 'two item').length === 1,
      detail: { order: after.map((b) => `${b.id}:${b.type}:${b.text.slice(0, 12)}`) },
    }
  },
  'a table row': async () => {
    // the row's cells, as dragging across them selects them
    await page.evaluate(async () => {
      const view = window.spike.editors.a.view()
      const { CellSelection } = window.spikeProse
      const cells = []
      view.state.doc.descendants((node, pos) => {
        if ((node.type.name === 'table_cell' || node.type.name === 'table_header') && node.textContent === 'b row') {
          cells.push(pos)
        }
        if (node.type.name === 'table_cell' && node.textContent === '2') {
          cells.push(pos)
        }
        return true
      })
      view.focus()
      view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cells[0], cells[1])))
      await new Promise((r) => setTimeout(r, 50))
    })
    await key(`${mod}+x`)
    await caret('a', 'a-8')
    await key(`${mod}+v`)
    const after = await blocks('a')
    return {
      pass: false,
      note: 'a row has no identity of its own (the draft has none: a table is one block); recorded, not passed',
      detail: { order: after.map((b) => `${b.id}:${b.type}:${b.text.slice(0, 16)}`), log: await log() },
    }
  },
  'a whole table': async () => {
    await page.evaluate(async () => {
      const view = window.spike.editors.a.view()
      const { NodeSelection } = window.spikeProse
      let at = -1
      view.state.doc.descendants((node, pos) => {
        if (node.attrs.blockId === 'a-7') {
          at = pos
        }
        return at < 0
      })
      view.focus()
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)))
      await new Promise((r) => setTimeout(r, 50))
    })
    await key(`${mod}+x`)
    await caret('a', 'a-2')
    await key(`${mod}+v`)
    const after = await blocks('a')
    return {
      pass: withId(after, 'a-7').length === 1 && withId(after, 'a-7')[0].type === 'table',
      detail: { order: after.map((b) => `${b.id}:${b.type}`) },
    }
  },
  'text from another app': async () => {
    // a web page's HTML that happens to carry our attribute, and an identity that's on the page
    await pasteFromOutside(
      'a',
      'a-8',
      '<p data-block-id="a-2">From a web page</p><p data-block-id="z-9">More</p>',
      'From a web page\n\nMore',
    )
    const after = await blocks('a')
    // nothing it carries is taken: a-2 stays on its own block, z-9 is nowhere (the text joins the
    // block the caret's in, as any paste does)
    return {
      pass:
        withText(after, 'From a web page').length === 1 &&
        withId(after, 'z-9').length === 0 &&
        withId(after, 'a-2').length === 1 &&
        withId(after, 'a-2')[0].text.startsWith('The first paragraph'),
      detail: { pasted: withText(after, 'From a web page').concat(withText(after, 'More')) },
    }
  },
  "Milkdown's Markdown and tables": async () => {
    await pasteFromOutside('b', 'b-3', null, 'Some **bold** text.\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n')
    const html = await page.evaluate(() => window.spike.editors.b.view().dom.innerHTML)
    return {
      pass: html.includes('<strong>bold</strong>') && html.includes('<table') && !html.includes('**bold**'),
      detail: { strong: html.includes('<strong>bold</strong>'), table: html.includes('<table') },
    }
  },
}

const only = process.env.CASE
const results = []
for (const [name, run] of Object.entries(cases)) {
  if (only && !name.includes(only)) {
    continue
  }
  await fresh()
  try {
    const r = await run()
    results.push({ name, ...r })
  } catch (error) {
    results.push({ name, pass: false, detail: { error: String(error).split('\n')[0] } })
  }
}
await browser.close()
const ua = which
console.log(JSON.stringify({ browser: ua, results }, null, 1))
