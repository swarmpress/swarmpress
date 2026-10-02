/** `/sitemap.xml` with hreflang alternates (only languages a page exists in). */
import { getRuntime } from '../src/runtime/index'
import { absoluteUrl } from '../src/resolve'
import { alternatesOf } from '../src/routes/plan'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function GET(): Response {
  const { site, plan } = getRuntime()
  const m = site.manifest
  const urls = plan.entries
    .filter((e) => e.kind !== 'not-found')
    .map((e) => {
      const alts = alternatesOf(plan, e, m.languages)
      const lastmod = e.page?.data.updated_at ?? e.page?.data.created_at
      return [
        '  <url>',
        `    <loc>${esc(absoluteUrl(m.baseUrl, m.base, e.path))}</loc>`,
        ...(typeof lastmod === 'string' && /^\d{4}-\d{2}-\d{2}/.test(lastmod) ? [`    <lastmod>${lastmod.slice(0, 10)}</lastmod>`] : []),
        ...(alts.length > 1
          ? alts.map((a) => `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${esc(absoluteUrl(m.baseUrl, m.base, a.path))}"/>`)
          : []),
        '  </url>',
      ].join('\n')
    })
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
