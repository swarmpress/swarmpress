import { chromium } from '@playwright/test'
const [,, url, out, ...args] = process.argv
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()) })
p.on('pageerror', e => logs.push('pageerror: ' + e.message))
await p.goto(url)
await p.waitForFunction(() => window.__simpress && window.__simpress.frames() > 30, null, { timeout: 60000 })
await p.waitForTimeout(1500)
await p.screenshot({ path: out })
console.log(await p.evaluate(() => window.__simpress.renderer), logs.slice(0, 8).join('\n'))
await b.close()
