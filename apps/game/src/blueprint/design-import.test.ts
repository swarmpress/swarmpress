// @vitest-environment jsdom
// Importing a design (FEAT-093): an HTML page or a ZIP of pages becomes a
// proposed blueprint by fixed rules; scripts never run; tokens come from :root.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { interpretDesign, mapPage, tokensOf, unzipText } from './design-import'

const home = readFileSync(resolve(__dirname, 'fixtures/design-home.html'), 'utf8')

/** A minimal ZIP writer (stored or deflated entries) for the tests. */
function zip(entries: { path: string; text: string; deflate?: boolean }[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.path)
    const raw = enc.encode(e.text)
    const data = e.deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const local = new Uint8Array(30 + name.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, e.deflate ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, e.deflate ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let at = 0
  for (const p of [...locals, ...centrals, end]) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('design import', () => {
  it('maps each section to a catalogue block by its facts, and says why', () => {
    const { page, header, footer } = mapPage('index.html', home)
    expect(header).toBe(true)
    expect(footer).toBe(true)
    expect(page.title).toBe('Riviera Daily')
    expect(page.sections.map((s) => [s.block, s.rule])).toEqual([
      ['hero-section', 'the first section with a top heading'],
      ['latest-stories', 'three or more repeated cards with links'],
      ['stats-section', 'mostly numbers'],
      ['content-section', 'a heading and paragraphs'],
      ['newsletter', 'a form with an email field'],
    ])
    // Scripts are parsed as data, never run.
    expect((window as unknown as { evil?: boolean }).evil).toBeUndefined()
  })

  it('builds page types, globals only when the site has their blocks, and tokens', () => {
    const files = [
      { path: 'index.html', text: home },
      { path: 'stories.html', text: home.replace('<h1>The coast, slowly</h1>', '<h2>All stories</h2>') },
    ]
    const plain = interpretDesign(files)
    expect(plain.blueprint.globals).toBeUndefined()
    expect(plain.blueprint.page_types.map((t) => [t.id, t.route])).toEqual([
      ['home', '/{lang}'],
      ['stories', '/{lang}/stories'],
    ])
    expect(plain.blueprint.page_types[0].slots!.map((s) => s.id)).toEqual(['hero', 'latest-stories', 'stats', 'content', 'newsletter'])
    // Without a top heading the first section is content, not a hero.
    expect(plain.blueprint.page_types[1].slots![0].blocks).toEqual(['content-section'])
    expect(plain.tokens).toEqual({ '--color-accent': '#c4281c', '--font-serif': '"Fraunces", serif' })
    const withChrome = interpretDesign(files, ['x:site-header', 'x:site-footer'])
    expect(withChrome.blueprint.globals).toEqual({ header: { block: 'x:site-header' }, footer: { block: 'x:site-footer' } })
    expect(withChrome.blueprint.page_types[0].uses).toEqual(['header', 'footer'])
  })

  it('repeats a slot for the same block in a row, and keeps a block in one slot', () => {
    const page = '<body><main><section><h2>A</h2><p>x</p></section><section><h2>B</h2><p>y</p></section><section><form><input type="email"></form></section><section><h2>C</h2><p>z</p></section></main></body>'
    const t = interpretDesign([{ path: 'p.html', text: page }]).blueprint.page_types[0]
    expect(t.slots).toEqual([
      { id: 'content', blocks: ['content-section'], min: 1 },
      { id: 'newsletter', blocks: ['newsletter'], min: 1, max: 1 },
    ])
  })

  it('reads stored and deflated ZIP entries and skips what is not text', async () => {
    const z = zip([
      { path: 'site/index.html', text: home, deflate: true },
      { path: 'site/styles.css', text: ':root{--space:4px}' },
      { path: 'site/logo.png', text: 'PNG' },
      { path: 'site/', text: '' },
    ])
    const { files, skipped } = await unzipText(z)
    expect(files.map((f) => f.path)).toEqual(['site/index.html', 'site/styles.css'])
    expect(files[0].text).toBe(home)
    expect(skipped).toEqual([{ path: 'site/logo.png', why: 'not HTML or CSS' }])
    const d = interpretDesign(files)
    expect(d.blueprint.page_types[0].id).toBe('home')
    expect(d.tokens['--space']).toBe('4px')
    await expect(unzipText(new TextEncoder().encode('not a zip'))).rejects.toThrow('not a ZIP')
  })

  it('reads tokens from :root only', () => {
    expect(tokensOf('a{--x:1} :root{ --y: 2px; --z:#fff }')).toEqual({ '--y': '2px', '--z': '#fff' })
  })
})

const PKG = resolve(process.cwd(), '../../crates/blueprint-wasm/pkg') + '/'

describe.skipIf(!existsSync(`${PKG}blueprint_wasm.js`))('the imported blueprint on the real checker', () => {
  it('checks clean in an empty site', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}blueprint_wasm.js`).href)) as {
      initSync(m: { module: BufferSource }): unknown
      checkBlueprint(bp: string, ctx: string): string
    }
    mod.initSync({ module: readFileSync(`${PKG}blueprint_wasm_bg.wasm`) })
    const d = interpretDesign([
      { path: 'index.html', text: home },
      { path: 'about.html', text: home },
    ])
    expect(JSON.parse(mod.checkBlueprint(JSON.stringify(d.blueprint), JSON.stringify({})))).toEqual([])
  })
})

