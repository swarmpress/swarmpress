import type { SiteLinks } from './data-source'

/**
 * Links out of the game: the pull request of a draft and the published page.
 * Nothing here is a constant of one site. The repository and the public
 * address come from the data source (`SiteLinks`); a builder returns `null`
 * when a part is unknown or malformed, and the panel then shows plain text.
 */

const GITHUB = 'https://github.com'
/** `owner/name` as GitHub allows it; anything else never becomes a URL. */
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/
const SHA = /^[0-9a-f]{7,40}$/i

const repoOf = (site: SiteLinks) => {
  const repo = site.repo
  if (!repo || !REPO.test(repo)) return null
  const name = repo.slice(repo.indexOf('/') + 1)
  return name === '.' || name === '..' ? null : repo
}

export function repoUrl(site: SiteLinks): string | null {
  const repo = repoOf(site)
  return repo ? `${GITHUB}/${repo}` : null
}

export function pullRequestUrl(site: SiteLinks, pr: number): string | null {
  const base = repoUrl(site)
  return base && Number.isInteger(pr) && pr > 0 ? `${base}/pull/${pr}` : null
}

export function commitUrl(site: SiteLinks, sha: string): string | null {
  const base = repoUrl(site)
  return base && SHA.test(sha) ? `${base}/commit/${sha}` : null
}

/** `https://host[/prefix]` without a trailing slash; only http(s). */
function publicBase(site: SiteLinks): string | null {
  if (!site.publicBaseUrl) return null
  try {
    const u = new URL(site.publicBaseUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/**
 * The route of a page from its path in the site repository, by the site
 * layout the orchestrator writes (crates/agents/src/pipeline.rs `page_path`
 * and the `slug` it sets):
 *   content/pages/blog/{slug}.json     → /{lang}/blog/{slug}/
 *   content/pages/{lang}/{rest}.json   → /{lang}/{rest}/   (`index` is the folder itself)
 */
export function pageRoute(path: string, language = 'en'): string | null {
  const m = /^content\/pages\/(.+)\.json$/.exec(path)
  if (!m) return null
  const parts = m[1].split('/')
  if (parts.some((p) => !/^[a-z0-9][a-z0-9-]*$/.test(p))) return null
  const lang = /^[a-z]{2}$/.test(parts[0]) ? parts.shift()! : language
  if (parts[parts.length - 1] === 'index') parts.pop()
  return `/${[lang, ...parts].join('/')}/`
}

/**
 * The published page of an artifact path. HOOK: returns `null` until a data
 * source sets `SiteLinks.publicBaseUrl` (see data-source.ts); the session
 * knows the repository but not the site's public address yet.
 */
export function publishedPageUrl(site: SiteLinks, path: string | null | undefined): string | null {
  const base = publicBase(site)
  const route = path ? pageRoute(path, site.language || 'en') : null
  return base && route ? `${base}${route}` : null
}
