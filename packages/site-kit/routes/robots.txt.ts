/** `/robots.txt` pointing at the sitemap. */
import config from 'virtual:site-kit/config'
import { withBase } from '../src/resolve'

export function GET(): Response {
  const m = config.manifest
  const sitemap = m.baseUrl.replace(/\/+$/, '') + withBase(m.base, '/sitemap.xml')
  const body = ['User-agent: *', 'Allow: /', `Disallow: ${withBase(m.base, '/_kit/')}`, '', `Sitemap: ${sitemap}`, ''].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
